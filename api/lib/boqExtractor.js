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
   Provider resolution
   ═══════════════════════════════════════════════════════════════════ */

const USE_GEMINI = Boolean(process.env.GEMINI_API_KEY);
const USE_GROQ   = !USE_GEMINI && Boolean(process.env.GROQ_API_KEY);
const USE_OPENROUTER = !USE_GEMINI && !USE_GROQ && Boolean(process.env.OPENROUTER_API_KEY);
const USE_DEEPSEEK = !USE_GEMINI && !USE_GROQ && !USE_OPENROUTER && Boolean(process.env.DEEPSEEK_API_KEY);

const AI_API_KEY = USE_GEMINI
  ? process.env.GEMINI_API_KEY
  : USE_GROQ
  ? process.env.GROQ_API_KEY
  : USE_OPENROUTER
  ? process.env.OPENROUTER_API_KEY
  : process.env.DEEPSEEK_API_KEY;

const GROQ_URL       = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEEPSEEK_URL   = "https://api.deepseek.com/chat/completions";

const AI_API_URL = USE_GROQ
  ? GROQ_URL
  : USE_OPENROUTER
  ? OPENROUTER_URL
  : USE_DEEPSEEK
  ? DEEPSEEK_URL
  : null;

const AI_MODEL = USE_GEMINI
  ? (process.env.GEMINI_MODEL || "gemini-1.5-flash")
  : USE_GROQ
  ? (process.env.GROQ_MODEL || "llama-3.3-70b-versatile")
  : USE_OPENROUTER
  ? (process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat")
  : (process.env.DEEPSEEK_MODEL || "deepseek-chat");

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

/* ═══════════════════════════════════════════════════════════════════
   Unified LLM dispatcher
   ═══════════════════════════════════════════════════════════════════ */

async function callLLM(systemPrompt, userPrompt, { maxRetries = 2, maxTokens = 4000 } = {}) {
  if (USE_GEMINI) {
    return callGemini(systemPrompt, userPrompt, { maxRetries, maxTokens });
  }
  return callOpenAICompatible(systemPrompt, userPrompt, { maxRetries, maxTokens });
}

/* ─── Gemini (Google Generative AI) ─────────────────────────────── */

async function callGemini(systemPrompt, userPrompt, { maxRetries = 2, maxTokens = 4000 } = {}) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI_API_KEY}`;

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

async function callOpenAICompatible(systemPrompt, userPrompt, { maxRetries = 2, maxTokens = 4000 } = {}) {
  const body = {
    model: AI_MODEL,
    temperature: 0.05,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
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
      throw new Error(`Provider error (${status}): ${txt}`);
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
   Deterministic regex fallback for BOQ
   ═══════════════════════════════════════════════════════════════════ */

const KNOWN_UNITS = new Set([
  "m³","m²","ml","kg","No.","pcs","set","m","hr","day","l","lt",
  "lump sum","sum","%","each","nr","no","nos","m3","m2","sq.m",
  "cum","sqm","rm","tonne","t","no.","set","lot","ft","sf","cf",
  "yd","in","mm","cm","km","ha","gal","litre","liter","pair",
  "bundle","roll","coil","sheet","panel","block","bag","sack",
  "drum","can","jar","bottle","box","case","crate","pallet",
  "container","load","trip","shift","week","month","year","hour",
  "min","second","pass","run","cycle","test","inspection","point",
  "location","station","bay","cell","module","unit","lot","job",
  "task","operation","activity","stage","phase","step","item",
  "article","piece","part","component","assembly","system","network",
  "circuit","line","loop","ring","bus","way","route","path","track",
  "road","street","avenue","drive","lane","alley","court","place",
  "terrace","square","plaza","park","garden","yard","compound",
  "enclosure","area","zone","region","sector","district","quarter",
  "precinct","ward","parish","community","neighborhood","locality",
  "vicinity","surroundings","environment","setting","context",
  "background","backdrop","scene","situation","circumstance",
  "condition","state","status","position","place","location","site",
  "spot","point","station","post","base","camp","center","hub","core",
  "heart","middle","midst","interior","inside","inner","internal",
  "inward","within","indoors","enclosed","sealed","closed","shut",
  "covered","protected","shielded","guarded","defended","secured",
  "safe","sheltered","screened","hidden","concealed","masked",
  "disguised","camouflaged","cloaked","veiled","shrouded","clouded",
  "fogged","misted","hazy","dim","faint","weak","pale","dull","flat",
  "matte","lusterless","drab","gray","grey","black","white","brown",
  "beige","tan","cream","ivory","off-white","ecru","taupe","mocha",
  "coffee","chocolate","cocoa","cinnamon","nutmeg","ginger","amber",
  "honey","gold","yellow","lemon","canary","chartreuse","lime","olive",
  "green","emerald","jade","teal","turquoise","aqua","cyan","blue",
  "navy","indigo","violet","purple","magenta","fuchsia","pink","rose",
  "crimson","red","scarlet","vermillion","coral","salmon","orange",
  "tangerine","peach","apricot","melon","rust","copper","bronze",
  "brass","silver","platinum","pewter","steel","iron","tin","lead",
  "zinc","nickel","chrome","chromium","titanium","aluminum","aluminium",
  "magnesium","manganese","cobalt","mercury","arsenic","antimony",
  "bismuth","cadmium","cerium","cesium","dysprosium","erbium",
  "europium","gadolinium","gallium","germanium","gold","hafnium",
  "holmium","indium","iridium","krypton","lanthanum","lutetium",
  "molybdenum","neodymium","neptunium","osmium","palladium","platinum",
  "polonium","potassium","praseodymium","promethium","protactinium",
  "radium","radon","rhenium","rhodium","rubidium","ruthenium","samarium",
  "selenium","silicon","sodium","strontium","tantalum","technetium",
  "tellurium","terbium","thallium","thorium","thulium","titanium",
  "tungsten","uranium","vanadium","xenon","ytterbium","yttrium",
  "zirconium"
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
export async function extractBoqWithLLM(rawText) {
  if (!rawText || typeof rawText !== "string") {
    console.warn("[boqExtractor] Empty or non-string input");
    return [];
  }

  const truncated = rawText.slice(0, 28000);
  const userPrompt =
    `Extract the Bill of Quantities table from the following raw contract text. ` +
    `Return ONLY a JSON array.\n\n---BEGIN TEXT---\n${truncated}\n---END TEXT---`;

  // ── Attempt 1: LLM ──
  try {
    const { text } = await callLLM(BOQ_SYSTEM_PROMPT, userPrompt, { maxTokens: 4000 });
    const cleaned = stripMarkdownFences(text);
    const parsed = JSON.parse(cleaned);

    let arr = Array.isArray(parsed) ? parsed : parsed.items || parsed.boq || [];
    if (!Array.isArray(arr)) {
      console.warn("[boqExtractor] LLM returned non-array, falling back to regex");
      return deterministicExtractBoq(rawText);
    }

    const result = arr
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

    if (result.length === 0) {
      console.warn("[boqExtractor] LLM returned empty array, falling back to regex");
      return deterministicExtractBoq(rawText);
    }

    console.log(`[boqExtractor] LLM extracted ${result.length} BOQ items`);
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

  try {
    const { text } = await callLLM(CLAUSE_SYSTEM_PROMPT, userPrompt, { maxTokens: 2000 });
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
