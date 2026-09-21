// api/check-analysis.js
import { createClient } from "@supabase/supabase-js";
import { getPricingEngine } from "./_lib/pricingEngine.js";
import { buildPricingEvidence, buildPricingReference } from "./_lib/pricingEvidence.js";
import { validateArithmetic } from "./_lib/arithmeticValidator.js";
import { computeComplianceRisk, computePricingRisk } from "./_lib/riskScoring.js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── AI provider configuration ─────────────────────────────────────────
// Groq's free tier caps ALL current models at 8,000 TPM (input + output
// combined) — confirmed directly from live 413 errors against both
// openai/gpt-oss-120b and qwen/qwen3.6-27b, despite the latter's much
// larger architectural context window; Groq's free-tier rate limit is a
// separate, lower ceiling than what the model itself supports. A real
// multi-document tender package (40k+ chars, ~11k+ tokens) will never fit
// in a single Groq free-tier call on any model — this isn't a truncation
// tuning problem, it's a hard capacity mismatch.
//
// Fix: pick the provider AFTER seeing how much text this specific request
// needs to send, not just by which key happens to be set. Small requests
// still prefer Groq (fastest, most headroom on RPD). Large ones route to
// OpenRouter, whose free `:free` model variants have materially higher
// per-request context ceilings. See resolveProviderChain() below — provider
// constants are now computed per-request, not at module load.
// 8000 TPM total, minus 6000 max_tokens reserved for output (reasoning
// models need real headroom to think AND answer — see reasoning_format
// note below), leaves ~2000 tokens for input. At ~3.5 chars/token that's
// roughly 7000 chars — deliberately conservative given how tight this
// margin already is.
const GROQ_SAFE_CHAR_BUDGET = 6000;

// Returns an ORDERED LIST of every configured provider, not a single pick.
// resolveProvider() (removed) used to return one provider and stop —
// meaning if that provider returned HTTP 200 with empty/malformed JSON
// (confirmed live, repeatedly, on openrouter/free), the whole audit died
// even though Cerebras and DeepSeek were configured and untried. The
// caller (callAiWithFallback, below) walks this list and only advances to
// the next entry when the current one fails — at the HTTP level (existing
// retry logic) OR at the content level (new).
function resolveProviderChain(estimatedInputChars) {
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
  const hasCerebras = Boolean(process.env.CEREBRAS_API_KEY);
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);

  const groq = hasGroq && {
    name: "groq",
    apiKey: process.env.GROQ_API_KEY,
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL || "qwen/qwen3.6-27b",
  };
  const openrouter = hasOpenRouter && {
    name: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    // OpenRouter's free-model roster churns weekly (models get delisted
    // or moved to paid with no notice — confirmed by direct testing in
    // this session: deepseek/deepseek-chat had no free variant at all,
    // and deepseek-chat-v3-0324:free was pulled between when this was
    // last checked and when it was actually called). Hardcoding any
    // specific :free slug is chasing a moving target.
    //
    // Fix: use openrouter/free — OpenRouter's own auto-router, which
    // picks a currently-available free model behind the scenes based on
    // what the request needs (long context, JSON mode, etc). Slightly
    // less predictable about which underlying model answers (visible in
    // the response's `model` field if you want to log it), but it keeps
    // working as the free lineup changes underneath it, instead of
    // needing a manual slug fix every few days. This provider is still
    // the least reliable link in the chain content-wise (confirmed live:
    // repeated empty/malformed 200 responses) — that's exactly why it no
    // longer gets to be the ONLY thing tried for large requests.
    model: process.env.OPENROUTER_MODEL || "openrouter/free",
  };
  const cerebras = hasCerebras && {
    name: "cerebras",
    apiKey: process.env.CEREBRAS_API_KEY,
    apiUrl: "https://api.cerebras.ai/v1/chat/completions",
    model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
  };
  const deepseek = hasDeepSeek && {
    name: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY,
    apiUrl: "https://api.deepseek.com/chat/completions",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  };

  const chain = [];
  // Groq first ONLY if this specific request fits its free-tier ceiling.
  if (groq && estimatedInputChars <= GROQ_SAFE_CHAR_BUDGET) chain.push(groq);
  if (openrouter) chain.push(openrouter);
  if (cerebras) chain.push(cerebras);
  if (deepseek) chain.push(deepseek);
  // Groq again, last resort, even when oversized for its own safe budget —
  // a fast, loud 413 is better than silently running out of providers
  // with nothing attempted and nothing logged.
  if (groq && estimatedInputChars > GROQ_SAFE_CHAR_BUDGET) chain.push(groq);

  return chain;
}

// ─── Deterministic risk scores (Option C: Compliance Risk + Pricing Risk) ──
// Replaces the old single additive calculateRiskScore(), which: (a) gave
// scope_gaps a flat +5 with zero severity weighting, (b) used
// Math.abs(variance_percent) > 20, conflating underbidding and overbidding
// into one signal, and (c) could overshoot 100 before clamping (confirmed
// live: a real bid scored 194 raw), destroying discriminating power between
// "messy but fine" and "actually high risk." See api/_lib/riskScoring.js
// for the noisy-OR combination logic and full rationale.
//
// Preserves the same null-when-no-evidence contract as the old function:
// returns null — not a fabricated midpoint — when there isn't enough
// grounded evidence to score responsibly.
function computeRiskScores(analysis, { hasDocumentText, evidenceCount, totalBidPrice }) {
  if (!hasDocumentText && evidenceCount === 0) {
    return { compliance_risk_score: null, pricing_risk_score: null, risk_score: null };
  }

  const compliance = computeComplianceRisk(analysis, { totalBidPrice });
  const pricing = computePricingRisk(analysis, totalBidPrice);

  return {
    compliance_risk_score: compliance,
    pricing_risk_score: pricing,
    // TEMPORARY bridge for existing consumers (PDF template, Telegram
    // message, frontend) that still expect a single risk_score number.
    // This is deliberately max(), not an average — one severely risky
    // dimension should not be diluted by the other being clean, and
    // averaging would silently reintroduce the exact blended-score problem
    // this redesign exists to remove. DELETE this field once the PDF
    // template and Telegram message are updated to show both scores
    // explicitly — that update is separate, out-of-scope work, tracked
    // independently, not done as part of this change.
    risk_score: Math.max(compliance.score, pricing.score),
  };
}

// Renders the deterministic pricing evidence into a compact block the LLM
// can read and reason over. The LLM is never asked to invent numbers here
// — only to explain commercial implications of numbers we already computed.
// Caps how many BOQ items' pricing evidence actually reaches the LLM
// prompt. With a real 96+ item BOQ (confirmed directly: a real tender
// package produced 96 deterministic + LLM-extracted items across 18
// sheets), sending every item's evidence line blew the total request
// past 261K chars — 4x+ over free-tier context ceilings. The deterministic
// market_variance data for ALL items is still computed and returned to
// the frontend in full (see analysis.market_variance below) — this cap
// only limits what the LLM itself reads in the prompt for narrative
// synthesis. The LLM's job here is prose commentary on notable variances,
// not enumerating every line item (the frontend already has the full
// table).
const MAX_PRICING_EVIDENCE_LINES = 40;

function formatPricingEvidenceForPrompt(evidence) {
  if (!evidence.length) {
    return "No BOQ line items were submitted for pricing comparison. Do not fabricate a market_variance table.";
  }
  const truncated = evidence.length > MAX_PRICING_EVIDENCE_LINES;
  const toFormat = truncated ? evidence.slice(0, MAX_PRICING_EVIDENCE_LINES) : evidence;
  const lines = toFormat.map((e, i) => {
    if (e.reference_price == null) {
      return `${i + 1}. "${e.item}" — Reference unavailable (no reliable match in the official price book). Do not estimate a price for this item.`;
    }
    return (
      `${i + 1}. "${e.item}" — Tender price: ${e.tender_price ?? "n/a"}ETB/${e.unit || "unit"}; ` +
      `Reference price: ${e.reference_price} ETB/${e.unit || "unit"} (${e.match_type}, confidence: ${e.confidence}); ` +
      `Variance: ${e.variance_percent != null ? e.variance_percent + "%" : "n/a"}.`
    );
  });
  if (truncated) {
    lines.push(
      `... and ${evidence.length - MAX_PRICING_EVIDENCE_LINES} more item(s) — not shown here to fit the prompt, ` +
      `but ALL items' full pricing comparison is included in the final market_variance output regardless. ` +
      `Do not claim only ${MAX_PRICING_EVIDENCE_LINES} items were priced.`
    );
  }
  return lines.join("\n");
}

// Renders the deterministic arithmetic findings the same way — the LLM is
// told what was actually found by math, not asked to invent its own.
function formatArithmeticEvidenceForPrompt(errors) {
  if (!errors.length) {
    return "No arithmetic discrepancies were found in the extracted BOQ line items (or no BOQ was extractable). Do not invent arithmetic_errors.";
  }
  return errors
    .map((e, i) => `${i + 1}. [${e.severity}] ${e.location}: ${e.description}`)
    .join("\n");
}

// Renders extracted contract clauses (from extractClausesWithLLM(), via
// extract-boq.js) as evidence. A null here means "not found in the text
// that was searched" — it is extraction-gap evidence, NOT proof the
// clause is absent from the tender (GCC/SCC clauses routinely live in a
// separate employer-issued document the bidder's own proposal never
// restates). See grounding rule 7 in groundedSystemPrompt below for how
// the synthesis model is instructed to treat this.
function formatClauseEvidenceForPrompt(clauses) {
  if (!clauses) {
    return "No contract clause data was extracted (no document text was supplied, or clause extraction was not run). Do not invent FIDIC clause references or contractual_traps not grounded in the document text below.";
  }
  const lines = Object.entries(clauses).map(
    ([key, val]) => `${key}: ${val === null
      ? "not found in the analyzed document(s) — this is NOT evidence the clause is " +
        "absent from the tender; it commonly lives in a separate Conditions of Contract " +
        "document not included in this analysis"
      : val}`
  );
  return (
    "The following clauses were searched for in the submitted document text. A 'not found' " +
    "result is an extraction gap, not proof of absence — see grounding rule 7. Only discuss " +
    "contractual_traps that reference these extracted values or explicit text in the " +
    "DOCUMENT TEXT section below — do not invent clause numbers or terms the document does " +
    "not contain:\n" + lines.join("\n")
  );
}

// Retries transient AI-provider failures (rate limits, brief upstream
// outages) with backoff. Honors a Retry-After header (sent by Groq,
// OpenRouter, Cerebras, and DeepSeek on 429 responses) or OpenRouter's
// error.metadata.retry_after_seconds when present, otherwise falls back to
// exponential backoff. Non-retryable errors (4xx other than 429) throw
// immediately — no point retrying a bad request or auth failure.
//
// `provider` is the object returned by resolveProviderChain() — passed in per
// call rather than read from a module-level constant, since which
// provider to use now depends on this specific request's document size.
async function callAiProviderWithRetry(provider, requestBody, { maxRetries = 3, capMs = 15000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(provider.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        // OpenRouter attribution headers — harmless no-ops on the other
        // three providers, which simply ignore unrecognized headers.
        "HTTP-Referer": process.env.PUBLIC_APP_URL || "https://bidswift.ai",
        "X-Title": "BidSwift AI",
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) return response;

    const status = response.status;
    const errorText = await response.text();
    const retryable = status === 429 || status === 502 || status === 503;

    if (!retryable || attempt === maxRetries) {
      throw new Error(`AI provider (${provider.name}/${provider.model}) error (${status}): ${errorText}`);
    }

    let waitMs = 1000 * 2 ** attempt; // exponential backoff fallback
    const headerRetry = response.headers.get("retry-after");
    if (headerRetry && !Number.isNaN(Number(headerRetry))) {
      waitMs = Math.max(waitMs, Number(headerRetry) * 1000);
    }
    try {
      const parsed = JSON.parse(errorText);
      // OpenRouter-specific field — a no-op for Groq/Cerebras/DeepSeek
      // error bodies, which don't have this shape and so leave waitMs
      // untouched.
      const s = parsed?.error?.metadata?.retry_after_seconds;
      if (s) waitMs = Math.max(waitMs, Math.ceil(s * 1000));
    } catch {
      // errorText wasn't JSON — fine, we already have a backoff value.
    }
    waitMs = Math.min(waitMs, capMs);

    console.warn(`AI provider (${provider.name}) returned ${status}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  // Unreachable — the loop always returns or throws — but keeps TS/linters happy.
  throw new Error("AI provider retry loop exited unexpectedly.");
}

// Content-level validation, split out of the old inline handler logic so it
// can run once per provider attempt instead of once total. Same salvage
// philosophy as parseJsonWithTruncationSalvage() in boqExtractor.js: try
// the raw parse, then try to pull the first {...} block out of a prose
// wrapper, and only give up if neither works.
function tryParseAnalysisJson(raw, providerLabel) {
  if (raw.length < 50) {
    return { ok: false, reason: `empty_response (${raw.length} chars)` };
  }
  try {
    return { ok: true, analysis: JSON.parse(raw) };
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const analysis = JSON.parse(jsonMatch[0]);
        console.warn(`[check-analysis] ${providerLabel} ignored response_format — salvaged JSON from prose wrapper.`);
        return { ok: true, analysis };
      } catch (salvageErr) {
        return { ok: false, reason: `unsalvageable_json: ${salvageErr.message}` };
      }
    }
    return { ok: false, reason: "unsalvageable_json: no {...} block found" };
  }
}

// Vercel Hobby plan hard-caps a serverless function at 60s — confirmed
// live, not overridable (see 09_TECHNICAL_ROADMAP.md / project constraints).
// This deadline leaves real headroom after the AI call returns for
// arithmetic validation, risk scoring, and response serialization, so a
// mid-chain fallback attempt doesn't just trade "empty audit" for "silent
// platform timeout with nothing in the logs."
const AI_CALL_DEADLINE_MS = 42000;

// Walks resolveProviderChain() in order. Two distinct failure modes cause
// a fall-through to the next provider:
//   1. HTTP-level failure — callAiProviderWithRetry() throws (non-retryable
//      status, or retries exhausted).
//   2. Content-level failure — the call "succeeds" (HTTP 200) but the body
//      is empty or unparseable JSON even after salvage. This is the case
//      the old code did NOT handle: it just failed the whole audit.
// Only throws once every provider in the chain has been tried and failed,
// or the time deadline is hit — the caller gets one clear error either way,
// with a full attempts[] trail for logging/debugging.
async function callAiWithFallback(estimatedInputChars, baseRequestBody) {
  const chain = resolveProviderChain(estimatedInputChars);
  if (!chain.length) {
    throw new Error("No AI provider is configured (no API keys present).");
  }

  const startedAt = Date.now();
  const attempts = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const remainingMs = AI_CALL_DEADLINE_MS - (Date.now() - startedAt);
    if (remainingMs <= 1500) {
      attempts.push(`${provider.name}: skipped (time budget exhausted)`);
      break;
    }

    console.log(`[check-analysis] Attempt ${i + 1}/${chain.length}: ${provider.name}/${provider.model} for ~${estimatedInputChars} input chars (~${Math.round(estimatedInputChars / 3.5)} est. tokens)`);

    let raw = "";
    try {
      const response = await callAiProviderWithRetry(
        provider,
        { ...baseRequestBody, model: provider.model },
        // Full retry budget only for the FIRST provider tried. Once we're
        // already falling back, spend less time per provider so the whole
        // chain actually gets a turn before the deadline above hits.
        { maxRetries: i === 0 ? 3 : 1, capMs: Math.max(1000, Math.min(15000, remainingMs)) }
      );
      const data = await response.json();
      raw = (data.choices?.[0]?.message?.content || "").replace(/```json/g, "").replace(/```/g, "").trim();
    } catch (httpErr) {
      console.error(`[check-analysis] ${provider.name} failed at HTTP level: ${httpErr.message}`);
      attempts.push(`${provider.name}: http_error — ${httpErr.message}`);
      continue;
    }

    console.log(`[check-analysis] ${provider.name}/${provider.model} returned ${raw.length} chars. Preview: "${raw.slice(0, 150)}"`);

    const parsed = tryParseAnalysisJson(raw, `${provider.name}/${provider.model}`);
    if (parsed.ok) {
      return { provider, analysis: parsed.analysis, raw };
    }

    console.error(`[check-analysis] ${provider.name}/${provider.model} content invalid — ${parsed.reason}. Falling through to next provider.`);
    attempts.push(`${provider.name}: ${parsed.reason}`);
  }

  throw Object.assign(
    new Error("All configured AI providers failed or returned invalid content."),
    { attempts }
  );
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
  if (!token) {
    return res.status(401).json({ error: "Missing authorization token." });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
  }

  try {
    const { systemPrompt, userPrompt, boqItems: rawBoqItems, documentText, clauses, contractValue } = req.body;

    if (!systemPrompt || !userPrompt) {
      return res.status(400).json({ error: "Missing systemPrompt or userPrompt." });
    }

    // ─── Normalize BOQ item field names ─────────────────────────────
    // boqExtractor.js emits { itemNo, unitPrice, ... } (camelCase).
    // pricingEvidence.js and validateArithmetic() below read
    // { item_no, tender_price, ... } (snake_case). Without this
    // normalization step, item.item_no and item.tender_price are
    // undefined for every real extracted item — silently producing an
    // empty Item # / Bid Rate / Variance column across the entire
    // market_variance table, with no error anywhere in the pipeline
    // (confirmed live: a real 115-item BOQ produced a fully-populated
    // Benchmark Rate column but an entirely empty Bid Rate / Variance
    // column in the generated report). Accepts either shape so this is
    // safe regardless of which extractor path (LLM vs. deterministic
    // regex fallback) produced the item.
    const boqItems = (rawBoqItems || []).map((item) => ({
      ...item,
      item_no: item.item_no ?? item.itemNo ?? null,
      tender_price: item.tender_price ?? item.unitPrice ?? item.unit_price ?? null,
    }));

    // ─── Structured pricing lookup (deterministic, not LLM-generated) ────
    const engine = await getPricingEngine();
    const pricingEvidence = buildPricingEvidence(engine, boqItems);
    const pricingReference = buildPricingReference(engine);
    const pricingEvidenceBlock = formatPricingEvidenceForPrompt(pricingEvidence);

    // ─── Deterministic arithmetic check (never LLM-generated) ──────────
    const arithmeticErrors = validateArithmetic(boqItems, contractValue ?? null);
    const arithmeticEvidenceBlock = formatArithmeticEvidenceForPrompt(arithmeticErrors);

    // ─── Extracted clause evidence (from the document, not invented) ────
    const clauseEvidenceBlock = formatClauseEvidenceForPrompt(clauses || null);

    // ─── Real document text, or an explicit statement that none exists ───
    // This replaces the old behavior of silently prompting on the filename
    // alone. If no text was extracted, the LLM is told so directly and
    // instructed not to fill the gap with invented specifics.
    //
    // A hard 60,000-char ceiling always applies regardless of provider —
    // this is a sanity cap against runaway request sizes, not the primary
    // sizing mechanism. The primary mechanism is resolveProviderChain() below,
    // which picks a provider whose free-tier context can actually hold
    // this specific request rather than truncating a real multi-document
    // tender package down to fit Groq's fixed 8,000 TPM ceiling.
    // Lowered from 60,000 after a real multi-document tender package (10
    // files: PDFs, DOCX, and a 13-sheet xlsx BOQ) produced a 261,457-char
    // total request — 4x+ over even OpenRouter's generous free-tier
    // ceiling, degrading the response quality rather than erroring
    // outright. 25,000 chars (~7,000 tokens) leaves real room for the
    // pricing/arithmetic/clause evidence blocks and system prompt
    // alongside it. This is a genuine information-loss tradeoff on very
    // large document sets, not just a safety margin — if audits on large
    // packages start missing real findings, the fix is upgrading to a
    // paid tier with a bigger context window, not raising this number
    // indefinitely; free-tier providers cannot hold an entire 10-document
    // tender package in one call, full stop.
    const HARD_CHAR_CEILING = Number(process.env.MAX_DOCUMENT_CHARS) || 25000;
    const hasDocumentText = Boolean(documentText && documentText.trim().length > 0);
    const documentTextBlock = hasDocumentText
      ? documentText.slice(0, HARD_CHAR_CEILING)
      : "NO DOCUMENT TEXT WAS EXTRACTED. Either no file was uploaded, or extraction failed. " +
        "Do not describe, quote, or reference any specific clause, section, or content as if " +
        "it came from a document — none was supplied. Base your response only on the project " +
        "metadata (name, type, value, margin) and the verified evidence blocks below.";

    const groundedSystemPrompt =
      `${systemPrompt}\n\n` +
      `GROUNDING RULES — READ CAREFULLY:\n` +
      `1. PRICING: You will be given verified pricing evidence for this bid's BOQ items, sourced from the ` +
      `official ${pricingReference.publication_period} Construction Works ${pricingReference.price_type} schedule. ` +
      `Do NOT output a "market_variance" field — it will be discarded and replaced with the verified evidence ` +
      `below. Do not invent, estimate, or restate different prices anywhere in your response.\n` +
      `2. ARITHMETIC: You will be given verified arithmetic findings computed directly from the extracted BOQ. ` +
      `Do NOT output your own "arithmetic_errors" — they will be discarded and replaced with the verified findings ` +
      `below. If none are listed, report zero arithmetic errors — do not invent any.\n` +
      `3. CONTRACT CLAUSES: Only reference clauses, FIDIC sub-clause numbers, or contractual terms that are either ` +
      `(a) explicitly present in the DOCUMENT TEXT provided below, or (b) listed in the extracted clause evidence. ` +
      `If the document text does not contain a clause, do not invent one to fill a category — return fewer items ` +
      `or an empty array instead.\n` +
      `4. If no document text was supplied, do not describe specific document content — say plainly that no ` +
      `document was available for clause/scope analysis, and limit findings to what the metadata and pricing/` +
      `arithmetic evidence actually support.\n` +
      `5. It is correct and expected to return an empty array for any finding category where the evidence does ` +
      `not support a real finding. An empty array is not a failure — a fabricated finding is.\n` +
      `6. OUTPUT FIELD ORDER — this matters and is not optional: place all structured/array fields ` +
      `(contractual_traps, scope_gaps, key_risks, methodology_strengths, methodology_weaknesses) FIRST in the ` +
      `JSON object, and place long-form prose fields (executive_summary, technical_critique, ` +
      `financial_risk_summary) LAST. Do this because if the response is cut off by a token limit before ` +
      `finishing, a truncated prose paragraph is recoverable, but an array that gets cut off after "contractual_` +
      `traps": [ produces a bid audit with silently missing findings next to a summary that describes findings ` +
      `the array doesn't contain — a genuine, previously-confirmed failure mode. Structured findings must never ` +
      `be sacrificed to make room for narrative text.\n` +
      `7. GCC/SCC CLAUSES — read before flagging a "missing clause": a bidder's own Technical/Financial ` +
      `Proposal is NOT the document where General or Special Conditions of Contract terms (Liquidated Damages, ` +
      `Retention Money, Price Adjustment, Defects Liability Period, Performance Bond) are expected to appear ` +
      `verbatim — those live in the employer's own Standard Bidding Documents, a separate document the bidder ` +
      `is not required to restate. A "not found" result for one of these in the extracted clause evidence means ` +
      `there is NO EVIDENCE EITHER WAY — never generate a contractual_traps finding on that basis alone. ` +
      `Separately: if the DOCUMENT TEXT contains the bidder accepting the bidding documents "in their entirety," ` +
      `"without reservation," or similar blanket-acceptance language, treat all GCC/SCC-level clauses as covered ` +
      `by that acceptance and suppress those findings entirely, regardless of what the clause evidence shows.\n\n` +
      // Explicit schema — this block is defined HERE, in check-analysis.js
      // itself, rather than left to whatever loose field-name list a
      // given caller's systemPrompt happens to mention. Confirmed live:
      // without an explicit per-field shape, the model has produced (a)
      // a completely empty technical_critique with no error or warning,
      // and (b) every contractual_traps[].clause_type set to the same
      // generic literal string "Contractual risk" instead of a real,
      // distinct title per finding — both are schema-ambiguity failures,
      // not extraction failures, and both are fixed by specifying the
      // shape precisely instead of relying on the model to infer it.
      `REQUIRED JSON SCHEMA — every field below is required unless noted. Do not omit technical_critique ` +
      `even if brief; a short but real critique is required, an empty string is not acceptable:\n` +
      `{\n` +
      `  "recommendation": "PROCEED" | "PROCEED_WITH_CAUTION" | "DECLINE",\n` +
      `  "contractual_traps": [\n` +
      `    {\n` +
      `      "clause_type": "A short, SPECIFIC title naming what this finding is about — e.g. ` +
      `'Missing Liquidated Damages Clause' or 'Understated Foundation Pricing'. NEVER use the generic ` +
      `literal string \\"Contractual risk\\" as this value — that is a placeholder, not a title.",\n` +
      `      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",\n` +
      `      "fidic_ref": "FIDIC sub-clause number if one is genuinely referenced in the document text, else omit this field entirely",\n` +
      `      "description": "1-3 sentences explaining the specific finding, citing concrete figures/clauses from the evidence provided",\n` +
      `      "recommendation": "1 sentence: the concrete action this finding calls for"\n` +
      `    }\n` +
      `  ],\n` +
      `  "scope_gaps": [\n` +
      `    { "missing_element": "what's missing", "risk_impact": "why it matters", "estimated_cost_etb": number or null }\n` +
      `  ],\n` +
      `  "key_risks": ["short bullet-point risk statements, distinct from contractual_traps — high-level, not per-clause"],\n` +
      `  "methodology_strengths": ["short bullet points on what the bid does well"],\n` +
      `  "methodology_weaknesses": ["short bullet points on where the bid's methodology falls short"],\n` +
      `  "executive_summary": "3-5 sentence overview a decision-maker reads first — the verdict and why",\n` +
      `  "technical_critique": "REQUIRED, 2-4 sentences. Evaluate the bid's technical/methodological approach specifically — ` +
      `not a repeat of executive_summary. If there is genuinely nothing technical to critique beyond what's already ` +
      `covered, say so explicitly (e.g. 'No technical methodology beyond standard BOQ pricing was submitted for review') ` +
      `rather than leaving this field empty.",\n` +
      `  "financial_risk_summary": "2-3 sentences on financial exposure specifically, distinct from contractual/technical findings"\n` +
      `}`;

    const groundedUserPrompt =
      `${userPrompt}\n\n` +
      `DOCUMENT TEXT (the actual submitted document — ground all clause/scope findings here):\n${documentTextBlock}\n\n` +
      `VERIFIED PRICING EVIDENCE (source of truth — do not alter these figures):\n${pricingEvidenceBlock}\n\n` +
      `VERIFIED ARITHMETIC EVIDENCE (source of truth — do not alter these figures):\n${arithmeticEvidenceBlock}\n\n` +
      `EXTRACTED CONTRACT CLAUSES:\n${clauseEvidenceBlock}`;

    // ─── Call the AI provider, falling through the whole chain on either
    // HTTP-level failure OR content-level failure (empty/malformed JSON) ──
    // See resolveProviderChain()/callAiWithFallback() above. Groq gets tried
    // first only if this request fits its free-tier ceiling; if whichever
    // provider answers returns HTTP 200 with garbage, this now moves to the
    // next configured provider instead of failing the whole audit — the gap
    // that let repeated openrouter/free empty responses kill real audits.
    const estimatedInputChars = groundedSystemPrompt.length + groundedUserPrompt.length;

    let provider, analysis, raw;
    try {
      ({ provider, analysis, raw } = await callAiWithFallback(estimatedInputChars, {
        temperature: 0.15,
        // qwen/qwen3.6-27b (Groq's default here) is a reasoning model — it
        // "thinks" before answering. reasoning_format: "hidden" drops the
        // thinking output entirely rather than just separating it into a
        // field ("parsed" still counts thinking against max_tokens and can
        // leave zero budget for the actual JSON answer — confirmed directly:
        // "parsed" alone still produced the same empty-content 400 this
        // session). "hidden" + a larger max_tokens budget is the actual fix.
        // NOTE: non-Groq providers ignore an unrecognized field, so this is
        // safe to send unconditionally down the whole chain.
        reasoning_format: "hidden",
        // Raised from 6000 after a confirmed-live failure: a 115-item BOQ
        // audit produced a rich, correct executive_summary and
        // technical_critique (verbose prose fields) but completely empty
        // contractual_traps and scope_gaps arrays — despite the executive
        // summary explicitly describing findings that belonged in those
        // arrays (missing defects liability/retention/LD clauses, absent
        // electrical scope). Root cause: prose fields consumed the token
        // budget before the model reached the structured arrays later in
        // the JSON object. Combined with the field-ordering instruction
        // above (structured fields first, prose last), this gives real
        // headroom so a cutoff — if it still happens — truncates prose,
        // not findings.
        max_tokens: Number(process.env.AI_MAX_OUTPUT_TOKENS) || 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: groundedSystemPrompt },
          { role: "user", content: groundedUserPrompt },
        ],
      }));
      console.log(`[check-analysis] Audit succeeded via ${provider.name}/${provider.model} (${raw.length} chars)`);
    } catch (fallbackErr) {
      // Genuinely unrecoverable — every configured provider either failed
      // at the HTTP level or returned empty/unparseable content. Return a
      // real 502 (bad upstream response) instead of a bare crash, with the
      // full per-provider attempts trail so this is debuggable from logs
      // alone rather than needing to reproduce it live.
      console.error(`[check-analysis] AI fallback chain exhausted: ${fallbackErr.attempts?.join(" | ") || fallbackErr.message}`);
      return res.status(502).json({
        error: "AI provider returned an invalid response. Please retry the audit.",
        detail: fallbackErr.attempts?.join("; ") || fallbackErr.message,
      });
    }

    // Ensure arrays exist
    analysis.contractual_traps = Array.isArray(analysis.contractual_traps) ? analysis.contractual_traps : [];
    analysis.scope_gaps = Array.isArray(analysis.scope_gaps) ? analysis.scope_gaps : [];

    // technical_critique is now explicitly required by the schema above,
    // but a model can still omit it even when the rest of the audit is
    // solid (confirmed live: a run with a real executive_summary and 4
    // real contractual_traps still had a blank technical_critique — not
    // severe enough to trigger the whole-response empty-content block
    // below, but severe enough to render as a broken-looking blank
    // section header in the PDF with nothing under it). An honest
    // placeholder is better than silent blankness here.
    if (!analysis.technical_critique || analysis.technical_critique.trim().length < 10) {
      analysis.technical_critique =
        "No distinct technical critique was returned for this submission beyond what is covered in the " +
        "executive summary and contractual risk register above.";
      analysis._technical_critique_inferred = true;
    }

    // Real visibility into what the model actually returned. Previously
    // a "successful" JSON.parse with genuinely empty/near-empty content
    // (empty executive_summary, empty technical_critique, empty arrays)
    // produced ZERO log output — no error, no warning — because it never
    // hit the parse-failure or salvage branches above. Confirmed live:
    // a full audit run produced a completely blank Executive Summary and
    // Technical Critique with no findings in either register, and
    // nothing in the logs indicated anything had gone wrong. This log
    // line exists so that failure mode is now visible.
    const summaryLen = (analysis.executive_summary || "").length;
    const critiqueLen = (analysis.technical_critique || "").length;
    console.log(
      `[check-analysis] Response content check: executive_summary=${summaryLen} chars, ` +
      `technical_critique=${critiqueLen} chars, contractual_traps=${analysis.contractual_traps.length}, ` +
      `scope_gaps=${analysis.scope_gaps.length}, recommendation=${analysis.recommendation || "MISSING"}`
    );
    if (summaryLen < 20 && critiqueLen < 20 && analysis.contractual_traps.length === 0 && analysis.scope_gaps.length === 0) {
      // This was previously a warn-only log — the response still shipped
      // through as a "successful" audit despite being functionally empty.
      // Confirmed live: this exact condition produced a real PDF sent to
      // a real user with a blank Executive Summary, blank Technical
      // Critique, and "none found" in every findings section — which
      // reads as a broken product, not a clean bill of health. A
      // response this thin is far more likely to be a low-effort/refused
      // completion from the free-tier provider than a genuine "nothing
      // to report" result on a 115-item real-world tender document.
      // Blocking here and returning 502 lets the caller (web UI, bot)
      // retry — usually against a different routed model — rather than
      // silently deliver an empty deliverable that looks complete.
      console.error(
        `[check-analysis] BLOCKED: parsed successfully but nearly all content fields are empty — ` +
        `refusing to treat this as a valid audit. Provider: ${provider.name}/${provider.model}. ` +
        `Raw response (first 300 chars): "${raw.slice(0, 300)}"`
      );
      return res.status(502).json({
        error: "AI provider returned an unusually thin response for this document. Please retry the audit.",
        detail: `Provider ${provider.name} returned a parseable but near-empty analysis (summary=${summaryLen} chars, critique=${critiqueLen} chars, 0 contractual traps, 0 scope gaps).`,
      });
    }

    // Market pricing and arithmetic errors are NEVER taken from the LLM —
    // always the deterministic evidence computed above, regardless of what
    // (if anything) the model tried to put in those fields.
    analysis.market_variance = pricingEvidence;
    analysis.pricing_reference = pricingReference;
    analysis.arithmetic_errors = arithmeticErrors;

    // Compute the risk scores deterministically. Returns null — not a
    // fabricated midpoint — if there wasn't enough grounded evidence to
    // score responsibly (see computeRiskScores above).
    const evidenceCount = pricingEvidence.length + arithmeticErrors.length;
    const { compliance_risk_score, pricing_risk_score, risk_score } = computeRiskScores(analysis, {
      hasDocumentText,
      evidenceCount,
      totalBidPrice: contractValue ?? null,
    });

    const responsePayload = {
      ...analysis,
      // TEMPORARY bridge field — see computeRiskScores() comment above.
      // Prefer compliance_risk_score / pricing_risk_score below for any
      // new consumer.
      risk_score,
      compliance_risk_score,
      pricing_risk_score,
      grounding: {
        has_document_text: hasDocumentText,
        document_char_count: hasDocumentText ? documentText.length : 0,
        pricing_evidence_count: pricingEvidence.length,
        arithmetic_findings_count: arithmeticErrors.length,
      },
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("AI provider call failed:", error);
    return res.status(500).json({ error: "Failed to process audit analysis.", detail: error.message });
  }
}