// api/extract-boq.js
//
// Server-side document ingestion. Accepts a single uploaded file
// (multipart/form-data, field name "file") and returns:
//   - rawText: the actual extracted text (never a filename, never invented)
//   - boqItems: structured BOQ line items (LLM extraction w/ regex fallback,
//     or deterministic parsing for xlsx)
//   - clauses: key contract terms (LLM extraction)
//   - meta: extraction method, page count, warnings — surfaced to the user
//     so a scanned/unparseable PDF is reported honestly instead of silently
//     producing an empty audit.
//
// This endpoint is the fix for the fabrication bug: before this existed,
// PDF/DOCX uploads never reached the server, and the LLM analysis prompt
// was given only the filename. Every PDF/DOCX audit must now go through
// this endpoint before /api/check-analysis is called.

import { createClient } from "@supabase/supabase-js";
import busboy from "busboy";
import { extractPdfText } from "./_lib/pdfExtractor.js";
import { extractDocxText } from "./_lib/docxExtractor.js";
import { extractBoqFromXlsxBuffer, flattenXlsxToText } from "./_lib/xlsxExtractor.js";
import { extractBoqWithLLM, extractClausesWithLLM } from "./_lib/boqExtractor.js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel serverless functions need raw body access for multipart parsing —
// the default body parser would consume the stream before busboy sees it.
export const config = {
  api: { bodyParser: false },
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — generous for a tender PDF, cheap to enforce

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });

    let fileBuffer = null;
    let fileName = "";
    let mimeType = "";
    let truncated = false;

    bb.on("file", (_name, stream, info) => {
      fileName = info.filename || "";
      mimeType = info.mimeType || "";
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("limit", () => { truncated = true; });
      stream.on("close", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("error", reject);
    bb.on("close", () => {
      if (truncated) return reject(new Error(`File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit.`));
      if (!fileBuffer) return reject(new Error("No file was uploaded."));
      resolve({ fileBuffer, fileName, mimeType });
    });

    req.pipe(bb);
  });
}

function detectFileType(fileName, mimeType) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "docx" || mimeType.includes("wordprocessingml")) return "docx";
  if (["xlsx", "xls"].includes(ext) || mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel") return "xlsx";
  return "unsupported";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization token." });
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
  }

  let fileBuffer, fileName, mimeType;
  try {
    ({ fileBuffer, fileName, mimeType } = await parseMultipart(req));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const fileType = detectFileType(fileName, mimeType);

  try {
    // ─── xlsx: deterministic first, LLM fallback for non-tabular sheets ──
    if (fileType === "xlsx") {
      const { items, sheetsWithData, warnings, skippedNonItemRows, skippedSheetNames } =
        extractBoqFromXlsxBuffer(fileBuffer);

      // Real tenders are commonly a MIX: some sheets have a clean header
      // row (deterministic pass handles these for free), others are
      // narrative-layout and get skipped (need the LLM fallback). The old
      // logic here returned immediately on ANY deterministic items being
      // found, which meant a file with 5 good sheets and 3 narrative
      // sheets would silently never attempt the narrative ones — this is
      // very likely the direct cause of results looking "half right, half
      // missing/wrong": some real items present, others never attempted.
      //
      // Fixed: only skip the LLM fallback entirely if there are no
      // skipped sheets left to try it on. Otherwise, run the LLM fallback
      // scoped ONLY to the sheets the deterministic pass couldn't parse —
      // not the whole workbook (see flattenXlsxToText's sheetNames param
      // below) — so cover pages, preambles, and summaries never enter the
      // LLM's input at all, and the LLM's output is merged with the
      // deterministic items rather than replacing them.
      if (skippedSheetNames.length === 0) {
        return res.status(200).json({
          fileName,
          fileType,
          rawText: null,
          boqItems: items,
          clauses: null,
          meta: {
            method: "deterministic-xlsx",
            sheetsWithData,
            warnings,
            skippedNonItemRows,
          },
        });
      }

      // Deterministic pass found nothing (or found some, but other sheets
      // remain unparsed) — this is common with real-world Ethiopian BOQs,
      // which are often laid out as narrative item descriptions in their
      // own rows with quantities/rates in nearby rows or columns, rather
      // than one clean header row naming every field (confirmed directly
      // against a real 18-sheet tender BOQ). Rather than give up on those
      // specific sheets, flatten ONLY the skipped sheets to plain text —
      // never cover pages, preambles, or sheets already handled
      // deterministically, which would waste the char budget and dilute
      // the LLM's attention with irrelevant boilerplate (confirmed
      // directly: a full-workbook flatten put "United Nations Office for
      // Project Services" cover-page text and PREAMBLE legal prose ahead
      // of actual narrative BOQ content within the 50,000-char cap).
      const flattenedText = flattenXlsxToText(fileBuffer, { onlySheets: skippedSheetNames });
      if (!flattenedText || !flattenedText.trim()) {
        // Deterministic pass may still have found real items on OTHER
        // sheets even though the skipped ones had no extractable text —
        // return those rather than an empty array.
        return res.status(200).json({
          fileName,
          fileType,
          rawText: null,
          boqItems: items,
          clauses: null,
          meta: {
            method: items.length > 0 ? "deterministic-xlsx-partial" : "deterministic-xlsx-empty",
            sheetsWithData,
            warnings: [...warnings, "No cell data found in the remaining sheets."],
            skippedNonItemRows,
          },
        });
      }

      const llmItems = await extractBoqWithLLM(flattenedText);

      // Merge: deterministic items (free, high-confidence, from clean
      // header-row sheets) plus LLM items (from narrative-layout sheets
      // the deterministic pass couldn't parse). Neither replaces the
      // other — a real tender file is genuinely a mix of both layouts.
      const allItems = [...items, ...llmItems];

      return res.status(200).json({
        fileName,
        fileType,
        // The flattened sheet text (skipped sheets only) is returned as
        // rawText so check-analysis.js can also ground clause/scope
        // findings in it, same as a PDF/DOCX document would provide.
        rawText: flattenedText,
        boqItems: allItems,
        clauses: null, // xlsx BOQs don't carry contract clauses — no clause extraction attempted
        meta: {
          method: llmItems.length > 0 ? "deterministic-plus-llm-xlsx" : "deterministic-xlsx-partial",
          sheetsWithData,
          warnings: [
            ...warnings,
            llmItems.length > 0
              ? `${items.length} item(s) from standard sheets + ${llmItems.length} item(s) AI-extracted from ${skippedSheetNames.length} narrative-layout sheet(s) (${skippedSheetNames.join(", ")}). Review AI-extracted items carefully.`
              : `${items.length} item(s) from standard sheets. No items could be extracted from the remaining ${skippedSheetNames.length} sheet(s) even with AI assistance — add manually if needed.`,
          ],
          skippedNonItemRows,
        },
      });
    }

    // ─── pdf / docx: extract real text first, LLM structures it second ──
    let extraction;
    if (fileType === "pdf") {
      extraction = await extractPdfText(fileBuffer);
    } else if (fileType === "docx") {
      const text = await extractDocxText(fileBuffer);
      extraction = { text, method: "docx-mammoth", numPages: null, warning: null };
    } else {
      return res.status(400).json({
        error: `Unsupported file type "${fileName}". Upload a PDF, DOCX, or XLSX file.`,
      });
    }

    const rawText = extraction.text || "";

    if (!rawText.trim()) {
      // Honest failure — no filename-only fallback, no LLM call, nothing invented.
      return res.status(200).json({
        fileName,
        fileType,
        rawText: "",
        boqItems: [],
        clauses: null,
        meta: {
          method: extraction.method,
          numPages: extraction.numPages,
          warnings: [extraction.warning || "No extractable text found in this document. Add BOQ line items manually below."],
        },
      });
    }

    // Run BOQ and clause extraction in parallel — independent LLM calls
    // over the same source text, both grounded in what was actually
    // extracted above, never in the filename.
    const [boqItems, clauses] = await Promise.all([
      extractBoqWithLLM(rawText),
      extractClausesWithLLM(rawText),
    ]);

    return res.status(200).json({
      fileName,
      fileType,
      rawText,
      boqItems,
      clauses,
      meta: {
        method: extraction.method,
        numPages: extraction.numPages,
        warnings: extraction.warning ? [extraction.warning] : [],
      },
    });
  } catch (error) {
    console.error("[extract-boq] Extraction failed:", error);
    return res.status(500).json({
      error: "Failed to extract document content.",
      detail: error.message,
    });
  }
}
