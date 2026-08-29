/**
 * api/lib/boqExtractor.js
 *
 * LLM-powered extraction for Ethiopian construction contract documents.
 * Supports Gemini (Google) and Groq (OpenAI-compatible) with automatic
 * provider selection via environment variables.
 *
 * Exports:
 *   - extractBoqWithLLM(rawText)     → Array<BoqItem>
 *   - extractClausesWithLLM(rawText) → ClauseObject
 */

/* ═══════════════════════════════════════════════════════════════════
   Provider resolution — size-aware, mirrors api/check-analysis.js
   ═══════════════════════════════════════════════════════════════════ */

// Groq's free tier caps ALL current models at 8,000 TPM (input + output
// combined) — confirmed directly in this codebase (see check-analysis.js).
// A correctly-anchored BOQ extraction window (extractBoqWindow below) is
// often 20,000+ chars of dense table data, which blows straight past that
// ceiling regardless of what maxTokens is requested for output — Groq
// truncates the response mid-generation, which breaks the JSON and forces
// a fallback to the much weaker regex extractor. This was the actual cause
// of "Unterminated string in JSON" errors seen in testing, not an output
// token-budget problem as first assumed.
const GROQ_SAFE_CHAR_BUDGET = 6000;

function resolveBoqProvider(estimatedInputChars) {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);

  // Gemini has a large context window regardless of request size, so it's
  // always safe when configured.
  if (hasGemini) {
    return {
      isGemini: true,
      name: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    };
  }
  // Groq only if this specific request actually fits its free-tier
  // ceiling — otherwise skip straight to a provider that can hold it.
  if (hasGroq && estimatedInputChars <= GROQ_SAFE_CHAR_BUDGET) {
    return {
      isGemini: false,
      name: "groq",
      apiKey: process.env.GROQ_API_KEY,
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    };
  }
  if (hasOpenRouter) {
    return {
      isGemini: false,
      name: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      apiUrl: "https://openrouter.ai/api/v1/chat/completions",
      model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat",
    };
  }
  if (hasGroq) {
    // Groq key exists but the request is too large for its free tier —
    // attempt anyway (will likely truncate) rather than silently failing
    // with no provider at all.
    return {
      isGemini: false,
      name: "groq",
      apiKey: process.env.GROQ_API_KEY,
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    };
  }
  return {
    isGemini: false,
    name: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY,
    apiUrl: "https://api.deepseek.com/chat/completions",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════════════════════ */

function parseNumber(val) {
  if (val == null) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  const cleaned = String(val).replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function stripMarkdownFences(text) {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Long tender PDFs bury the actual priced BOQ table under pages of legal
// boilerplate, personnel bios, and financial-standing tables. A flat
// slice(0, N) risks truncating before the real table starts, leaving the
// LLM to invent structure from prose instead.
//
// Naive phrase-anchoring on "Bill of Quantities" alone is NOT reliable:
// the phrase also appears in a table-of-contents entry (before the real
// table) and in a repeated "...duly authorized to sign the Bill of
// Quantities..." signature line under every subsequent page (after the
// real table). Neither "first match" nor "last match" is consistently
// correct — it depends on the document.
//
// The reliable signal is different: real BOQ line items are numbered like
// "1.01", "2.02", "9.4" on their own line, immediately followed by a
// description and then unit/qty/rate numbers. So: find every "Bill of
// Quantities" occurrence, and for each, check whether an item-numbered row
// appears shortly afterward (within ~2000 chars — enough to skip a
// "Place and Date / Procurement Reference / To:" letterhead block but not
// so far that we'd wander into an unrelated section). The first occurrence
// that satisfies this is the real table heading.
const ITEM_ROW_RE = /\n\s*\d{1,2}\.\d{2}[a-z]?\s/i;

function extractBoqWindow(rawText, maxChars) {
  const phraseRe = /bill\s+of\s+quantities/gi;
  const lookaheadWindow = 2000;

  let start = -1;
  let match;
  while ((match = phraseRe.exec(rawText)) !== null) {
    const from = match.index;
    const nearby = rawText.slice(from, from + lookaheadWindow);
    if (ITEM_ROW_RE.test(nearby)) {
      start = from;
      break;
    }
  }

  // Fallback: no phrase match had a nearby item row (unusual document
  // structure) — try the item-row pattern directly, anywhere in the text.
  if (start === -1) {
    const direct = rawText.search(ITEM_ROW_RE);
    start = direct !== -1 ? direct : 0;
  }

  return rawText.slice(start, start + maxChars);
}

/* ═══════════════════════════════════════════════════════════════════
   Unified LLM dispatcher
   ═══════════════════════════════════════════════════════════════════ */

async function callLLM(provider, systemPrompt, userPrompt, { maxRetries = 2, maxTokens = 4000 } = {}) {
  if (provider.isGemini) {
    return callGemini(provider, systemPrompt, userPrompt, { maxRetries, maxTokens });
  }
  return callOpenAICompatible(provider, systemPrompt, userPrompt, { maxRetries, maxTokens });
}

/* ─── Gemini (Google Generative AI) ─────────────────────────────── */

async function callGemini(provider, systemPrompt, userPrompt, { maxRetries = 2, maxTokens = 4000 } = {}) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      return { text };
    }

    const status = res.status;
    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt === maxRetries) {
      const txt = await res.text();
      throw new Error(`Gemini error (${status}): ${txt}`);
    }

    let wait = 1000 * 2 ** attempt;
    const ra = res.headers.get("retry-after");
    if (ra && !Number.isNaN(Number(ra))) wait = Math.max(wait, Number(ra) * 1000);
    await sleep(Math.min(wait, 15000));
  }
  throw new Error("Gemini retry loop exited unexpectedly");
}

/* ─── OpenAI-compatible (Groq / OpenRouter / DeepSeek) ──────────── */

async function callOpenAICompatible(provider, systemPrompt, userPrompt, { maxRetries = 2, maxTokens = 4000 } = {}) {
  const body = {
    model: provider.model,
    temperature: 0.05,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(provider.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        "HTTP-Referer": process.env.PUBLIC_APP_URL || "https://bidswift.ai",
        "X-Title": "BidSwift AI",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "{}";
      return { text };
    }

    const status = res.status;
    const retryable = status === 429 || status === 502 || status === 503;
    if (!retryable || attempt === maxRetries) {
      const txt = await res.text();
      throw new Error(`Provider (${provider.name}/${provider.model}) error (${status}): ${txt}`);
    }

    let wait = 1000 * 2 ** attempt;
    const ra = res.headers.get("retry-after");
    if (ra && !Number.isNaN(Number(ra))) wait = Math.max(wait, Number(ra) * 1000);
    await sleep(Math.min(wait, 15000));
  }
  throw new Error("OpenAI-compatible retry loop exited unexpectedly");
}

/* ═══════════════════════════════════════════════════════════════════
   System prompts
   ═══════════════════════════════════════════════════════════════════ */

const BOQ_SYSTEM_PROMPT = `You are a deterministic data-extraction engine. Your sole task is to parse Priced Bill of Quantities (BOQ) tables from Ethiopian construction contract PDFs and return a single JSON array.

EXTRACTION RULES:
1. Locate the table with columns: ITEM NO, DESCRIPTION, UNIT, QUANTITY, UNIT PRICE, TOTAL AMOUNT. Accept variants like "Item No", "Desc", "Qty", "Rate", "Amount", "Unit Price", "Total".
2. Return a JSON array of objects with keys: itemNo, description, unit, quantity, unitPrice, total.
3. itemNo: string. Preserve exact formatting (e.g., "1.1", "2.2.1", "2.4a").
4. description: string. Merge multi-line descriptions into one line. Remove extra whitespace. Keep technical terms intact (concrete grades, dimensions, materials).
5. unit: string. Normalize to standard symbols: m³, m², ml, kg, No., pcs, set, m, hr, day, %, lump sum.
6. quantity, unitPrice, total: numbers. Remove comma thousand separators. Do not include currency symbols.
7. If a table spans pages, merge into one array.
8. Skip summary rows, VAT lines, header rows, and blank lines.
9. Return ONLY the JSON array. No markdown, no explanation.`;

const CLAUSE_SYSTEM_PROMPT = `You are a contract-clause extraction engine for FIDIC-based Ethiopian construction contracts.
Extract key terms from the "Special Conditions of Contract" or "Particular Conditions" section.

Return a single JSON object with these keys:
- performanceBond (string or null)
- advancePayment (string or null)  
- retentionMoney (string or null)
- liquidatedDamages (string or null)
- priceAdjustment (string or null)
- governingLaw (string or null)
- defectsLiabilityPeriod (string or null)

RULES:
1. Extract exact text as stated. Preserve percentages and dates.
2. If explicitly "Not Applicable", return that exact string.
3. If absent, return null.
4. Return ONLY the JSON object. No markdown, no explanation.`;

/* ═══════════════════════════════════════════════════════════════════
   Plausibility gate — catches rows extracted from non-BOQ prose
   ═══════════════════════════════════════════════════════════════════ */

// A real Ethiopian construction BOQ line item has a bounded unit price and
// quantity. Rows outside these bounds are almost always the LLM picking up
// numbers from non-BOQ prose (legal boilerplate, financial-standing tables,
// personnel data, registration numbers) rather than an actual BOQ row.
const MAX_PLAUSIBLE_UNIT_PRICE = 500000; // ETB — generous ceiling per unit
const MAX_PLAUSIBLE_QUANTITY = 1000000;

function isPlausibleBoqRow(r) {
  if (r.unitPrice < 0 || r.unitPrice > MAX_PLAUSIBLE_UNIT_PRICE) return false;
  if (r.quantity < 0 || r.quantity > MAX_PLAUSIBLE_QUANTITY) return false;
  if (!r.unit || r.unit.length > 15) return false;
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
   Deterministic regex fallback for BOQ
   ═══════════════════════════════════════════════════════════════════ */

// Real construction/BOQ units only. (Previously this set had accreted
// hundreds of unrelated English words — colors, chemical elements, abstract
// nouns like "circumstance" and "hidden" — almost certainly from an earlier
// LLM-assisted edit that over-generated. That pollution didn't cause the
// row-fabrication bug directly since KNOWN_UNITS only labels a token as a
// unit, it doesn't gate row acceptance, but it made unit-detection in the
// regex fallback noisy and untrustworthy. Kept tight and audited by hand.)
const KNOWN_UNITS = new Set([
  "m³","m²","ml","kg","No.","pcs","set","m","hr","day","l","lt",
  "lump sum","sum","%","each","nr","no","nos","m3","m2","sq.m",
  "cum","sqm","rm","tonne","t","no.","lot","ft","sf","cf",
  "yd","in","mm","cm","km","ha","gal","litre","liter","pair",
  "bundle","roll","coil","sheet","panel","block","bag","sack",
  "drum","can","jar","bottle","box","case","crate","pallet",
  "container","load","trip","shift","week","month","year","hour",
]);

/**
 * Parses BOQ tables using line-item regex heuristics.
 * Handles multi-line descriptions by buffering lines until the next item number.
 */
function deterministicExtractBoq(rawText) {
  if (!rawText || typeof rawText !== "string") return [];

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const items = [];
  const skipRe = /^(ITEM\s*NO|DESCRIPTION|UNIT|QUANTITY|UNIT\s*PRICE|TOTAL|PAGE|SECTION|BILL\s*OF|PRICED\s*BILL|SUMMARY|NOTE|VAT|GRAND\s*TOTAL|SUB\s*TOTAL|CONTRACT\s*PRICE|AMOUNT|\d+\s*of\s*\d+$)/i;

  let buffer = null; // { itemNo: string, lines: string[] }

  function flushBuffer() {
    if (!buffer) return;

    const fullText = buffer.lines.join(" ");
    const tokens = fullText.split(/\s+/);

    let quantity = null;
    let unitPrice = null;
    let total = null;
    let unit = null;
    let descEndIdx = -1;

    // Walk backwards: expect total → unitPrice → quantity → unit
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i].replace(/,/g, "");
      const num = Number(t);

      if (!Number.isNaN(num) && t !== "" && Number.isFinite(num)) {
        if (total === null) {
          total = num;
        } else if (unitPrice === null) {
          unitPrice = num;
        } else if (quantity === null) {
          quantity = num;
          descEndIdx = i - 1;

          if (i > 0) {
            const cand = tokens[i - 1];
            if (KNOWN_UNITS.has(cand.toLowerCase()) || KNOWN_UNITS.has(cand)) {
              unit = cand;
              descEndIdx = i - 2;
            }
          }
          break;
        }
      }
    }

    const hasNumbers = quantity !== null && unitPrice !== null && total !== null;
    const description = hasNumbers
      ? tokens.slice(0, descEndIdx + 1).join(" ")
      : fullText;

    items.push({
      itemNo: buffer.itemNo,
      description,
      unit: unit || "",
      quantity: quantity || 0,
      unitPrice: unitPrice || 0,
      total: total || 0,
    });

    buffer = null;
  }

  for (const rawLine of lines) {
    // Normalise pipe-separated tables: "1.1 | Desc | m3 | …" → "1.1  Desc  m3  …"
    const line = rawLine.replace(/\s*\|\s*/g, " ").trim();
    if (!line || skipRe.test(line)) continue;

    // Item numbers like 1.1, 2.2.1, 2.4a, 4.a
    const itemMatch = line.match(/^([1-9]\d*(?:\.\d+)+[a-z]?|[1-9]\.[a-z])\s+(.+)/i);
    if (itemMatch) {
      flushBuffer();
      buffer = { itemNo: itemMatch[1], lines: [itemMatch[2]] };
    } else if (buffer) {
      buffer.lines.push(line);
    }
  }

  flushBuffer();

  return items
    .filter(
      (i) =>
        i.description.length > 2 &&
        (i.quantity !== 0 || i.unitPrice !== 0 || i.total !== 0)
    )
    .map((i) => ({
      ...i,
      description: i.description.replace(/\s+/g, " ").trim(),
    }));
}

/* ═══════════════════════════════════════════════════════════════════
   BOQ extraction  →  LLM first, regex fallback
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Extracts structured BOQ items from raw PDF text.
 *
 * @param {string} rawText — text extracted from PDF (e.g. pdf-parse output)
 * @returns {Promise<Array<{itemNo:string, description:string, unit:string, quantity:number, unitPrice:number, total:number}>>}
 */
// A response cut off by a token ceiling is usually a syntactically valid
// JSON array up to the last COMPLETE element, with one final element left
// half-written (e.g. an unterminated string or number, as seen directly in
// testing: "Unterminated fractional number in JSON at position 19293").
// Rather than discard the entire response — losing 20+ correctly-extracted
// rows because the 21st was cut off mid-number — walk backward from the
// failure point to the last complete "},{" boundary and close the array
// there. This only ever salvages complete, well-formed rows; a half-written
// row is dropped, never guessed at or completed.
function parseJsonWithTruncationSalvage(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    // Only attempt salvage on a top-level array — objects (e.g. the clause
    // extractor's response shape) don't have a safe row-boundary to cut at.
    const trimmed = text.trim();
    if (!trimmed.startsWith("[")) return null;

    const lastCompleteBoundary = trimmed.lastIndexOf("},");
    if (lastCompleteBoundary === -1) return null;

    const salvaged = trimmed.slice(0, lastCompleteBoundary + 1) + "]";
    try {
      const parsedArr = JSON.parse(salvaged);
      console.warn(
        `[boqExtractor] LLM output was truncated (${err.message}) — salvaged ${parsedArr.length} complete row(s) before the cutoff, dropped the incomplete trailing row.`
      );
      return parsedArr;
    } catch {
      return null; // Salvage attempt itself didn't parse — give up cleanly.
    }
  }
}


export async function extractBoqWithLLM(rawText) {
  if (!rawText || typeof rawText !== "string") {
    console.warn("[boqExtractor] Empty or non-string input");
    return [];
  }

  // 20000 rather than 28000: keeps more requests within reach of Groq's
  // free-tier ceiling (see GROQ_SAFE_CHAR_BUDGET / resolveBoqProvider
  // above) before falling through to OpenRouter, while still comfortably
  // covering a real single-BOQ table (the Group 2 test case's actual
  // table body is well under this).
  const truncated = extractBoqWindow(rawText, 20000);
  const userPrompt =
    `Extract the Bill of Quantities table from the following raw contract text. ` +
    `Return ONLY a JSON array.\n\n---BEGIN TEXT---\n${truncated}\n---END TEXT---`;

  const provider = resolveBoqProvider(BOQ_SYSTEM_PROMPT.length + userPrompt.length);
  console.log(`[boqExtractor] Using ${provider.name}/${provider.model} for BOQ extraction (~${userPrompt.length} prompt chars)`);

  // ── Attempt 1: LLM ──
  try {
    // maxTokens raised 4000 → 8000 → 12000: testing against a real ~23-row
    // Ethiopian BOQ (Group 2 Construction G+1 building) showed the model
    // correctly attempting to enumerate the FULL table — including items
    // near the end of the extraction window (item 9.10 of 9.12) — and
    // still hitting the ceiling mid-row. This is not a runaway/garbage
    // output; the JSON array output for a complete, description-heavy BOQ
    // table with 20-30 rows genuinely needs this much room. Combined with
    // resolveBoqProvider() above, which routes off Groq entirely once the
    // request is too big for its fixed 8,000 TPM ceiling regardless of
    // maxTokens requested.
    const { text } = await callLLM(provider, BOQ_SYSTEM_PROMPT, userPrompt, { maxTokens: 12000 });
    const cleaned = stripMarkdownFences(text);
    const parsed = parseJsonWithTruncationSalvage(cleaned);
    if (parsed === null) {
      console.warn("[boqExtractor] LLM output unparseable even after salvage attempt, falling back to regex");
      return deterministicExtractBoq(rawText);
    }

    let arr = Array.isArray(parsed) ? parsed : parsed.items || parsed.boq || [];
    if (!Array.isArray(arr)) {
      console.warn("[boqExtractor] LLM returned non-array, falling back to regex");
      return deterministicExtractBoq(rawText);
    }

    const mapped = arr
      .filter((r) => r && (r.itemNo != null || r.item_no != null || r.description))
      .map((r) => ({
        itemNo: String(r.itemNo || r.item_no || ""),
        description: String(r.description || "")
          .replace(/\s+/g, " ")
          .trim(),
        unit: String(r.unit || "").trim(),
        quantity: parseNumber(r.quantity),
        unitPrice: parseNumber(r.unitPrice || r.unit_price),
        total: parseNumber(r.total),
      }))
      .filter(
        (r) =>
          r.description && (r.quantity !== 0 || r.unitPrice !== 0 || r.total !== 0)
      );

    const result = mapped.filter(isPlausibleBoqRow);
    const rejected = mapped.length - result.length;
    if (rejected > 0) {
      console.warn(
        `[boqExtractor] Rejected ${rejected} implausible row(s) (unit price/qty out of range or missing unit) — likely extracted from non-BOQ text.`
      );
    }

    if (result.length === 0) {
      console.warn("[boqExtractor] No plausible BOQ items after filtering, falling back to regex");
      return deterministicExtractBoq(rawText);
    }

    console.log(`[boqExtractor] LLM extracted ${result.length} plausible BOQ items (${rejected} rejected)`);
    return result;
  } catch (err) {
    console.error("[boqExtractor] LLM failed, using regex fallback:", err.message);
    return deterministicExtractBoq(rawText);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Clause extraction  →  LLM only (text is too unstructured for regex)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Extracts key contractual terms from raw contract text.
 *
 * @param {string} rawText
 * @returns {Promise<{
 *   performanceBond: string|null,
 *   advancePayment: string|null,
 *   retentionMoney: string|null,
 *   liquidatedDamages: string|null,
 *   priceAdjustment: string|null,
 *   governingLaw: string|null,
 *   defectsLiabilityPeriod: string|null
 * }>}
 */
export async function extractClausesWithLLM(rawText) {
  if (!rawText || typeof rawText !== "string") {
    console.warn("[clauseExtractor] Empty or non-string input");
    return emptyClauses();
  }

  const truncated = rawText.slice(0, 24000);
  const userPrompt =
    `Extract the contractual terms from the following construction contract text. ` +
    `Return ONLY the JSON object.\n\n---BEGIN TEXT---\n${truncated}\n---END TEXT---`;

  const provider = resolveBoqProvider(CLAUSE_SYSTEM_PROMPT.length + userPrompt.length);
  console.log(`[clauseExtractor] Using ${provider.name}/${provider.model} for clause extraction (~${userPrompt.length} prompt chars)`);

  try {
    const { text } = await callLLM(provider, CLAUSE_SYSTEM_PROMPT, userPrompt, { maxTokens: 2000 });
    const cleaned = stripMarkdownFences(text);
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      console.warn("[clauseExtractor] LLM returned array instead of object");
      return emptyClauses();
    }

    return {
      performanceBond: normalizeClause(parsed.performanceBond),
      advancePayment: normalizeClause(parsed.advancePayment),
      retentionMoney: normalizeClause(parsed.retentionMoney),
      liquidatedDamages: normalizeClause(parsed.liquidatedDamages),
      priceAdjustment: normalizeClause(parsed.priceAdjustment),
      governingLaw: normalizeClause(parsed.governingLaw),
      defectsLiabilityPeriod: normalizeClause(parsed.defectsLiabilityPeriod),
    };
  } catch (err) {
    console.error("[clauseExtractor] Extraction failed:", err.message);
    return emptyClauses();
  }
}

function emptyClauses() {
  return {
    performanceBond: null,
    advancePayment: null,
    retentionMoney: null,
    liquidatedDamages: null,
    priceAdjustment: null,
    governingLaw: null,
    defectsLiabilityPeriod: null,
  };
}

function normalizeClause(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined")
    return null;
  return s;
}