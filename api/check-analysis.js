// api/check-analysis.js
import { createClient } from "@supabase/supabase-js";
import { getPricingEngine } from "./_lib/pricingEngine.js";
import { buildPricingEvidence, buildPricingReference } from "./_lib/pricingEvidence.js";
import { validateArithmetic } from "./_lib/arithmeticValidator.js";

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
// per-request context ceilings. See resolveProvider() below — provider
// constants are now computed per-request, not at module load.
// 8000 TPM total, minus 6000 max_tokens reserved for output (reasoning
// models need real headroom to think AND answer — see reasoning_format
// note below), leaves ~2000 tokens for input. At ~3.5 chars/token that's
// roughly 7000 chars — deliberately conservative given how tight this
// margin already is.
const GROQ_SAFE_CHAR_BUDGET = 6000;

function resolveProvider(estimatedInputChars) {
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
  const hasCerebras = Boolean(process.env.CEREBRAS_API_KEY);
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);

  // Groq only if the request actually fits its free-tier TPM ceiling —
  // otherwise skip straight to a provider that can hold the whole document.
  if (hasGroq && estimatedInputChars <= GROQ_SAFE_CHAR_BUDGET) {
    return {
      name: "groq",
      apiKey: process.env.GROQ_API_KEY,
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || "qwen/qwen3.6-27b",
    };
  }
  if (hasOpenRouter) {
    return {
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
      // needing a manual slug fix every few days.
      model: process.env.OPENROUTER_MODEL || "openrouter/free",
    };
  }
  if (hasCerebras) {
    return {
      name: "cerebras",
      apiKey: process.env.CEREBRAS_API_KEY,
      apiUrl: "https://api.cerebras.ai/v1/chat/completions",
      model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
    };
  }
  if (hasGroq) {
    // Groq key exists but the request is too large for its free tier —
    // fall through to it anyway only if nothing else is configured, so
    // there's still an attempt (which will 413) rather than a silent
    // "no provider configured" failure with no actionable error.
    return {
      name: "groq",
      apiKey: process.env.GROQ_API_KEY,
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || "qwen/qwen3.6-27b",
    };
  }
  return {
    name: "deepseek",
    apiKey: process.env.DEEPSEEK_API_KEY,
    apiUrl: "https://api.deepseek.com/chat/completions",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  };
}

// ─── Deterministic risk score calculator ──────────────────────────────
// Returns null — not a fabricated midpoint — when there isn't enough
// grounded evidence to score responsibly. "Enough evidence" here means:
// real document text was supplied, AND at least some pricing or arithmetic
// evidence was computed from it.
function calculateRiskScore(analysis, { hasDocumentText, evidenceCount }) {
  if (!hasDocumentText && evidenceCount === 0) {
    return null;
  }

  let score = 50; // baseline

  (analysis.contractual_traps || []).forEach((trap) => {
    if (trap.severity === "CRITICAL") score += 10;
    else if (trap.severity === "HIGH") score += 5;
  });

  (analysis.arithmetic_errors || []).forEach((err) => {
    if (err.severity === "HIGH") score += 8;
    else if (err.severity === "MEDIUM") score += 4;
  });

  (analysis.market_variance || []).forEach((m) => {
    if (m.variance_percent != null && Math.abs(m.variance_percent) > 20) score += 3;
  });

  (analysis.scope_gaps || []).forEach(() => score += 5);

  if (analysis.recommendation === "DECLINE") score += 15;
  else if (analysis.recommendation === "PROCEED") score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
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
      `${i + 1}. "${e.item}" — Tender price: ${e.tender_price ?? "n/a"} ETB/${e.unit || "unit"}; ` +
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

// Renders extracted contract clauses (from clauseExtractor.js, via
// extract-boq.js) as evidence. If a clause is null, the document simply
// didn't state it — the LLM must say so rather than invent FIDIC language.
function formatClauseEvidenceForPrompt(clauses) {
  if (!clauses) {
    return "No contract clause data was extracted (no document text was supplied, or clause extraction was not run). Do not invent FIDIC clause references or contractual_traps not grounded in the document text below.";
  }
  const lines = Object.entries(clauses).map(
    ([key, val]) => `${key}: ${val === null ? "not stated in the document" : val}`
  );
  return (
    "The following clauses were extracted directly from the submitted document text. " +
    "Only discuss contractual_traps that reference these extracted values or explicit " +
    "text in the DOCUMENT TEXT section below — do not invent clause numbers or terms " +
    "the document does not contain:\n" + lines.join("\n")
  );
}

// Retries transient AI-provider failures (rate limits, brief upstream
// outages) with backoff. Honors a Retry-After header (sent by Groq,
// OpenRouter, Cerebras, and DeepSeek on 429 responses) or OpenRouter's
// error.metadata.retry_after_seconds when present, otherwise falls back to
// exponential backoff. Non-retryable errors (4xx other than 429) throw
// immediately — no point retrying a bad request or auth failure.
//
// `provider` is the object returned by resolveProvider() — passed in per
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

    // ─── Normalize BOQ item field names ───────────────────────────────
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

    // ─── Deterministic arithmetic check (never LLM-generated) ────────────
    const arithmeticErrors = validateArithmetic(boqItems, contractValue ?? null);
    const arithmeticEvidenceBlock = formatArithmeticEvidenceForPrompt(arithmeticErrors);

    // ─── Extracted clause evidence (from the document, not invented) ─────
    const clauseEvidenceBlock = formatClauseEvidenceForPrompt(clauses || null);

    // ─── Real document text, or an explicit statement that none exists ───
    // This replaces the old behavior of silently prompting on the filename
    // alone. If no text was extracted, the LLM is told so directly and
    // instructed not to fill the gap with invented specifics.
    //
    // A hard 60,000-char ceiling always applies regardless of provider —
    // this is a sanity cap against runaway request sizes, not the primary
    // sizing mechanism. The primary mechanism is resolveProvider() below,
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
      `be sacrificed to make room for narrative text.`;

    const groundedUserPrompt =
      `${userPrompt}\n\n` +
      `DOCUMENT TEXT (the actual submitted document — ground all clause/scope findings here):\n${documentTextBlock}\n\n` +
      `VERIFIED PRICING EVIDENCE (source of truth — do not alter these figures):\n${pricingEvidenceBlock}\n\n` +
      `VERIFIED ARITHMETIC EVIDENCE (source of truth — do not alter these figures):\n${arithmeticEvidenceBlock}\n\n` +
      `EXTRACTED CONTRACT CLAUSES:\n${clauseEvidenceBlock}`;

    // ─── Pick a provider based on this request's actual size ─────────────
    // See resolveProvider() above — Groq only if it fits Groq's real free-
    // tier 8,000 TPM ceiling; otherwise OpenRouter/Cerebras/DeepSeek, whose
    // free tiers hold much larger single requests.
    const estimatedInputChars = groundedSystemPrompt.length + groundedUserPrompt.length;
    const provider = resolveProvider(estimatedInputChars);
    console.log(`[check-analysis] Using ${provider.name}/${provider.model} for ~${estimatedInputChars} input chars (~${Math.round(estimatedInputChars / 3.5)} est. tokens)`);

    // ─── Call the AI provider ──────────────────────────────────────────
    const response = await callAiProviderWithRetry(provider, {
      model: provider.model,
      temperature: 0.15,
      // qwen/qwen3.6-27b (Groq's default here) is a reasoning model — it
      // "thinks" before answering. reasoning_format: "hidden" drops the
      // thinking output entirely rather than just separating it into a
      // field ("parsed" still counts thinking against max_tokens and can
      // leave zero budget for the actual JSON answer — confirmed directly:
      // "parsed" alone still produced the same empty-content 400 this
      // session). "hidden" + a larger max_tokens budget is the actual fix.
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
    });

    const data = await response.json();

    // Extract the LLM's JSON from the response
    let raw = data.choices?.[0]?.message?.content || "{}";
    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();

    // Defensive parse — some free-tier/routed models (confirmed live on
    // openrouter/free) ignore response_format:{type:"json_object"} and
    // return conversational prose ("Here's the analysis...") instead of
    // raw JSON, despite the explicit instruction. Rather than let that
    // crash the whole audit with an uncaught 500, try to salvage the
    // first {...} block from the response before giving up. This mirrors
    // the same salvage philosophy as parseJsonWithTruncationSalvage() in
    // boqExtractor.js — a malformed provider response should degrade
    // gracefully, not take down the endpoint.
    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch (parseErr) {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          analysis = JSON.parse(jsonMatch[0]);
          console.warn(`[check-analysis] Provider ${provider.name}/${provider.model} ignored response_format — salvaged JSON from prose wrapper.`);
        } catch (salvageErr) {
          console.error(`[check-analysis] JSON salvage also failed: ${salvageErr.message}`);
        }
      }
      if (!analysis) {
        // Genuinely unrecoverable — return a real 502 (bad upstream
        // response) instead of a bare crash, so callers (web UI, bot)
        // can show "please retry" instead of a silent failure.
        console.error(`[check-analysis] Provider ${provider.name}/${provider.model} returned non-JSON, unsalvageable: "${raw.slice(0, 120)}..."`);
        return res.status(502).json({
          error: "AI provider returned an invalid response. Please retry the audit.",
          detail: `Provider ${provider.name} did not return valid JSON.`,
        });
      }
    }

    // Ensure arrays exist
    analysis.contractual_traps = Array.isArray(analysis.contractual_traps) ? analysis.contractual_traps : [];
    analysis.scope_gaps = Array.isArray(analysis.scope_gaps) ? analysis.scope_gaps : [];

    // Market pricing and arithmetic errors are NEVER taken from the LLM —
    // always the deterministic evidence computed above, regardless of what
    // (if anything) the model tried to put in those fields.
    analysis.market_variance = pricingEvidence;
    analysis.pricing_reference = pricingReference;
    analysis.arithmetic_errors = arithmeticErrors;

    // Compute the risk score deterministically. Returns null — not a
    // fabricated midpoint — if there wasn't enough grounded evidence to
    // score responsibly (see calculateRiskScore above).
    const evidenceCount = pricingEvidence.length + arithmeticErrors.length;
    const risk_score = calculateRiskScore(analysis, { hasDocumentText, evidenceCount });

    const responsePayload = {
      ...analysis,
      risk_score,
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