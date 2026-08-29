// api/lib/xlsxExtractor.js
//
// Server-side .xlsx/.xls → structured BOQ line items. This is a port of the
// header-detection heuristic that used to live client-side in audit.tsx,
// moved here so xlsx, PDF, and DOCX uploads all resolve to the same fixed
// output schema through one endpoint (api/extract-boq.js) instead of xlsx
// being special-cased in the browser while PDF/DOCX get nothing.
//
// Deliberately NOT configurable column mapping — the header-keyword scan
// below picks the columns automatically. If a sheet's headers don't match
// any known keyword, that sheet is skipped and reported in `warnings`; the
// caller falls back to LLM extraction over flattenText()'s output rather
// than asking the user to map columns by hand.
//
// Confirmed against a real 18-sheet Ethiopian tender BOQ that this
// deterministic pass cannot parse: many real BOQs are laid out as
// narrative item descriptions in their own rows/cells ("1.01 site clear",
// "cad area including appron,ditch") with quantities in nearby cells,
// rather than one row naming Description/Unit/Qty/Rate columns. That's
// not a bug in the detection logic — it's a genuinely different, common
// real-world layout that column-header scanning can't reasonably handle.
// See flattenText() below for the fallback path.

import * as XLSX from "xlsx";

// Keyword→column mapping. Order matters: keys are checked in this order,
// and a cell only fills the FIRST unfilled key it matches — so "itemNo"
// must be checked before "description" (both a bare "ITEM" header column
// and a full "DESCRIPTION" column contain the substring "item"; without
// this ordering, "ITEM" would incorrectly claim the description slot in
// real BOQs that use "ITEM" as the item-number column header, as
// confirmed directly against a real tender file's "ITEM | DESCRIPTION |
// UNIT | QTY | RATE | AMOUNT" header row).
const BOQ_HEADER_KEYWORDS = {
  itemNo: ["itemno", "code", "sno", "item"],
  description: ["description", "particular"],
  unit: ["unit", "uom"],
  qty: ["qty", "quantity"],
  rate: ["rate", "unitprice", "unitrate", "price"],
};

function cleanNumber(val) {
  if (val === undefined || val === null || val === "") return undefined;
  const cleaned = String(val).replace(/[^0-9.\-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function findHeaderRow(aoa) {
  const scanLimit = Math.min(aoa.length, 15);
  for (let r = 0; r < scanLimit; r++) {
    const row = aoa[r] || [];
    const cols = {};
    row.forEach((cell, c) => {
      const norm = String(cell ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (!norm) return;
      for (const [key, candidates] of Object.entries(BOQ_HEADER_KEYWORDS)) {
        if (cols[key] === undefined && candidates.some((cand) => norm.includes(cand))) {
          cols[key] = c;
        }
      }
    });

    // A real header row needs a description column plus at least one of
    // unit/qty/rate, AND those columns must be genuinely distinct cells —
    // not the same single cell matching multiple keyword categories at
    // once. That "one cell, many matches" pattern is the signature of a
    // false positive on a prose sentence (confirmed directly against a
    // real BOQ: a PREAMBLE clause containing the words "item", "price",
    // and "rate" in running text matched description+rate+itemNo all on
    // the same cell, producing garbage extracted "items" from legal text,
    // not BOQ data). Requiring the matched columns to be at least 2
    // distinct column indices filters this out while still accepting
    // genuine header rows, where each keyword naturally lands in its own
    // column.
    const distinctCols = new Set(Object.values(cols));
    if (
      cols.description !== undefined &&
      (cols.unit !== undefined || cols.qty !== undefined || cols.rate !== undefined) &&
      distinctCols.size >= 2
    ) {
      return { rowIdx: r, cols };
    }
  }
  return null;
}

/**
 * Deterministic extraction: scans every sheet for a clean header row
 * (Description/Unit/Qty/Rate or synonyms) within the first 15 rows, then
 * reads structured rows beneath it. Fast, free, no LLM call — but only
 * works on spreadsheets laid out with an explicit column-header row.
 *
 * @param {Buffer} buffer
 * @returns {{ items: Array, sheetsWithData: string[], warnings: string[], skippedNonItemRows: number, skippedSheetNames: string[] }}
 */
export function extractBoqFromXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });

  const items = [];
  const sheetsWithData = [];
  const warnings = [];
  const skippedSheetNames = [];
  let skippedNonItemRows = 0;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    if (!aoa.length) continue; // genuinely empty sheet — not "skipped", nothing to attempt

    const header = findHeaderRow(aoa);
    if (!header) {
      warnings.push(`"${sheetName}": no description/unit/qty/rate header found in the first ${Math.min(aoa.length, 15)} rows — skipped.`);
      skippedSheetNames.push(sheetName);
      continue;
    }

    const { rowIdx, cols } = header;
    let rowsFromSheet = 0;
    for (let r = rowIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const description = String(row[cols.description] ?? "").trim();
      if (!description) continue;

      const qty = cols.qty !== undefined ? cleanNumber(row[cols.qty]) : undefined;
      const tender_price = cols.rate !== undefined ? cleanNumber(row[cols.rate]) : undefined;

      // Skip prose/preamble rows (BOQ preambles, instructions) that share a
      // sheet with real priced items but aren't line items themselves.
      const looksLikeProse = description.length > 160 || /\.\s+\w/.test(description);
      const hasNumericData = (qty !== undefined && qty > 0) || (tender_price !== undefined && tender_price > 0);
      if (!hasNumericData || looksLikeProse) {
        skippedNonItemRows++;
        continue;
      }

      items.push({
        item_no: cols.itemNo !== undefined ? String(row[cols.itemNo] ?? "").trim() : undefined,
        description,
        unit: cols.unit !== undefined ? String(row[cols.unit] ?? "").trim() : "",
        qty,
        tender_price,
      });
      rowsFromSheet++;
    }
    if (rowsFromSheet > 0) {
      sheetsWithData.push(`${sheetName} (${rowsFromSheet})`);
    } else {
      // A header row was found but every row under it was filtered out
      // (unpriced/zero-value rows, or all prose) — e.g. "Bill Nr.1
      // Mobilization" in a real tender file, where every line item had a
      // blank rate. Worth a real LLM attempt too, same as sheets with no
      // header at all — the items may just be laid out differently than
      // this deterministic pass expects, not genuinely absent.
      warnings.push(`"${sheetName}": header row found but no priced data rows under it.`);
      skippedSheetNames.push(sheetName);
    }
  }

  return { items, sheetsWithData, warnings, skippedNonItemRows, skippedSheetNames };
}

// Sheet-name patterns that are never BOQ line-item tables regardless of
// what their cell content looks like — cover pages, legal preambles, and
// roll-up summary sheets. Excluded from flattenXlsxToText() so the LLM's
// limited context budget goes toward sheets that might actually contain
// unparsed line items, not boilerplate that was already confirmed (by a
// human reading the actual file during this fix) to contain none.
const NON_BOQ_SHEET_PATTERN = /cover\s*page|preamble|grand\s*summary|^\s*summary\s*$/i;

// Cap on how much flattened text is generated — a real 18-sheet workbook
// can render to hundreds of thousands of characters, most of it repeated
// project-header boilerplate ("United Nations Office for Project
// Services", "BILLS OF QUANTITIES", etc. on every sheet). check-analysis.js
// applies its own char cap before the LLM call anyway, but capping here
// too avoids doing wasted work rendering sheets that will just be
// truncated later, and avoids the LLM extraction call itself timing out
// on pathologically large workbooks.
const MAX_FLATTEN_CHARS = 50000;

/**
 * Renders sheets as plain, tab-separated text — a fallback representation
 * for when extractBoqFromXlsxBuffer() finds no clean header row on some
 * sheets. This text is fed to boqExtractor.js's extractBoqWithLLM(), the
 * same LLM-based extraction already used for PDF/DOCX documents, so
 * narrative-style BOQs (item descriptions and quantities in freeform rows
 * rather than a labeled table) get a real extraction attempt instead of
 * silently producing zero items.
 *
 * Deliberately unopinionated about structure: every non-empty cell in
 * every row is joined with tabs, blank rows are skipped, and a sheet-name
 * header line separates sheets. The LLM is the one making sense of the
 * layout, not this function — this just gets the raw cell content in
 * front of it in a roughly readable form.
 *
 * @param {Buffer} buffer
 * @param {{ onlySheets?: string[] }} [options] — if provided, ONLY these
 *   sheet names are flattened (used to scope the LLM call to sheets the
 *   deterministic pass actually couldn't parse, rather than re-sending
 *   already-successful sheets or wasting budget on cover pages/preambles/
 *   summaries — confirmed necessary directly: an unscoped full-workbook
 *   flatten put cover-page and legal-preamble text ahead of real BOQ
 *   content within the char cap, degrading extraction quality). Sheets
 *   matching NON_BOQ_SHEET_PATTERN are always excluded regardless of
 *   this list, since they're never line-item tables.
 * @returns {string}
 */
export function flattenXlsxToText(buffer, { onlySheets = null } = {}) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts = [];
  let totalChars = 0;

  const targetSheets = onlySheets
    ? wb.SheetNames.filter((name) => onlySheets.includes(name))
    : wb.SheetNames;

  for (const sheetName of targetSheets) {
    if (totalChars >= MAX_FLATTEN_CHARS) break;
    if (NON_BOQ_SHEET_PATTERN.test(sheetName)) continue;

    const sheet = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    if (!aoa.length) continue;

    const sheetLines = [`--- Sheet: ${sheetName} ---`];
    for (const row of aoa) {
      const cells = (row || [])
        .map((c) => (c === null || c === undefined ? "" : String(c).trim()))
        .filter(Boolean);
      if (cells.length === 0) continue; // skip fully blank rows
      sheetLines.push(cells.join("\t"));
    }

    if (sheetLines.length <= 1) continue; // sheet had no non-empty rows at all

    const sheetText = sheetLines.join("\n");
    parts.push(sheetText);
    totalChars += sheetText.length;
  }

  return parts.join("\n\n").slice(0, MAX_FLATTEN_CHARS);
}