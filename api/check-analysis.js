// api/check-analysis.js
import { createClient } from "@supabase/supabase-js";
import { getPricingEngine } from "./lib/pricingEngine.js";
import { buildPricingEvidence, buildPricingReference } from "./lib/pricingEvidence.js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── AI provider configuration ─────────────────────────────────────────
// Prefers Groq (GROQ_API_KEY) when present, since it has its own free tier
// with dedicated per-organization rate limits (not shared across users like
// OpenRouter's free tier). Falls back to OpenRouter (OPENROUTER_API_KEY),
// then to a direct DeepSeek key/endpoint if neither is set. All three are
// OpenAI-compatible chat-completions endpoints, so the request body shape
// stays identical regardless of which one is selected.
const USE_GROQ = Boolean(process.env.GROQ_API_KEY);
const USE_OPENROUTER = !USE_GROQ && Boolean(process.env.OPENROUTER_API_KEY);

const AI_API_KEY = USE_GROQ
  ? process.env.GROQ_API_KEY
  : USE_OPENROUTER
  ? process.env.OPENROUTER_API_KEY
  : process.env.DEEPSEEK_API_KEY;

const AI_API_URL = USE_GROQ
  ? "https://api.groq.com/openai/v1/chat/completions"
  : USE_OPENROUTER
  ? "https://openrouter.ai/api/v1/chat/completions"
  : "https://api.deepseek.com/chat/completions";

// OpenRouter model slugs are namespaced (e.g. "deepseek/deepseek-chat"),
// DeepSeek's own API and Groq both use the bare model name.
//
// NOTE (as of writing): Groq's free-tier default model llama-3.3-70b-versatile
// is deprecated with a shutdown date of 08/16/26 — Groq's recommended
// replacement is openai/gpt-oss-120b (or qwen/qwen3.6-27b). If you're reading
// this after that date, set GROQ_MODEL explicitly rather than relying on the
// fallback default below. See https://console.groq.com/docs/deprecations.
const AI_MODEL = USE_GROQ
  ? (process.env.GROQ_MODEL || "llama-3.3-70b-versatile")
  : USE_OPENROUTER
  ? (process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat")
  : (process.env.DEEPSEEK_MODEL || "deepseek-chat");

// ─── Deterministic risk score calculator ──────────────────────────────
function calculateRiskScore(analysis) {
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
    if (m.variance_pct != null && Math.abs(m.variance_pct) > 20) score += 3;
  });

  (analysis.scope_gaps || []).forEach(() => score += 5);

  if (analysis.recommendation === "DECLINE") score += 15;
  else if (analysis.recommendation === "PROCEED") score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Renders the deterministic pricing evidence into a compact block the LLM
// can read and reason over. The LLM is never asked to invent numbers here
// — only to explain commercial implications of numbers we already computed.
function formatEvidenceForPrompt(evidence) {
  if (!evidence.length) {
    return "No BOQ line items were submitted for pricing comparison. Do not fabricate a market_variance table.";
  }
  return evidence
    .map((e, i) => {
      if (!e.matched_reference_item_no && e.confidence === "Unknown") {
        return `${i + 1}. "${e.item}" — Reference unavailable (no reliable match in the official price book). Do not estimate a price for this item.`;
      }
      return (
        `${i + 1}. "${e.item}" — Tender price: ${e.tender_price ?? "n/a"} ETB/${e.unit || "unit"}; ` +
        `Reference price: ${e.reference_price} ETB/${e.unit || "unit"} (${e.match_type}, confidence: ${e.confidence}); ` +
        `Variance: ${e.variance_percent != null ? e.variance_percent + "%" : "n/a"}.`
      );
    })
    .join("\n");
}

// Retries transient AI-provider failures (rate limits, brief upstream
// outages) with backoff. Honors a Retry-After header (sent by all three
// providers — OpenRouter, DeepSeek, and Groq — on 429 responses) or
// OpenRouter's error.metadata.retry_after_seconds when present, otherwise
// falls back to exponential backoff. Non-retryable errors (4xx other than
// 429) throw immediately — no point retrying a bad request or auth failure.
async function callAiProviderWithRetry(requestBody, { maxRetries = 3, capMs = 15000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
        // OpenRouter attribution headers — harmless no-ops on DeepSeek direct
        // and on Groq (both simply ignore unrecognized headers).
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
      throw new Error(`AI provider error (${status}): ${errorText}`);
    }

    let waitMs = 1000 * 2 ** attempt; // exponential backoff fallback
    const headerRetry = response.headers.get("retry-after");
    if (headerRetry && !Number.isNaN(Number(headerRetry))) {
      waitMs = Math.max(waitMs, Number(headerRetry) * 1000);
    }
    try {
      const parsed = JSON.parse(errorText);
      // OpenRouter-specific field — a no-op for Groq/DeepSeek error bodies,
      // which don't have this shape and so leave waitMs untouched.
      const s = parsed?.error?.metadata?.retry_after_seconds;
      if (s) waitMs = Math.max(waitMs, Math.ceil(s * 1000));
    } catch {
      // errorText wasn't JSON — fine, we already have a backoff value.
    }
    waitMs = Math.min(waitMs, capMs);

    console.warn(`AI provider returned ${status}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
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
    const { systemPrompt, userPrompt, boqItems } = req.body;

    if (!systemPrompt || !userPrompt) {
      return res.status(400).json({ error: "Missing systemPrompt or userPrompt." });
    }

    // ─── Structured pricing lookup (deterministic, not LLM-generated) ────
    const engine = await getPricingEngine();
    const pricingEvidence = buildPricingEvidence(engine, boqItems);
    const pricingReference = buildPricingReference(engine);

    const evidenceBlock = formatEvidenceForPrompt(pricingEvidence);

    const groundedSystemPrompt =
      `${systemPrompt}\n\n` +
      `PRICING RULE — READ CAREFULLY:\n` +
      `You will be given verified pricing evidence for this bid's BOQ items, sourced from the ` +
      `official ${pricingReference.publication_period} Construction Works ${pricingReference.price_type} schedule. ` +
      `Do NOT output a "market_variance" field — it will be discarded and replaced with the ` +
      `verified evidence below. Do not invent, estimate, or restate different prices anywhere in your response. ` +
      `Where an item is marked "Reference unavailable", say so plainly rather than guessing.`;

    const groundedUserPrompt =
      `${userPrompt}\n\n` +
      `VERIFIED PRICING EVIDENCE (source of truth — do not alter these figures):\n${evidenceBlock}`;

    // ─── Call the AI provider (Groq, OpenRouter, or DeepSeek direct) ─────
    const response = await callAiProviderWithRetry({
      model: AI_MODEL,
      temperature: 0.15,
      max_tokens: 4000,
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
    const analysis = JSON.parse(raw);

    // Ensure arrays exist
    analysis.contractual_traps = Array.isArray(analysis.contractual_traps) ? analysis.contractual_traps : [];
    analysis.arithmetic_errors = Array.isArray(analysis.arithmetic_errors) ? analysis.arithmetic_errors : [];
    analysis.scope_gaps = Array.isArray(analysis.scope_gaps) ? analysis.scope_gaps : [];

    // Market pricing is NEVER taken from the LLM — always the deterministic
    // evidence computed above, regardless of what (if anything) the model
    // tried to put in a market_variance field.
    analysis.market_variance = pricingEvidence;
    analysis.pricing_reference = pricingReference;

    // Compute the risk score deterministically
    const risk_score = calculateRiskScore(analysis);

    const responsePayload = {
      ...analysis,
      risk_score,
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("AI provider call failed:", error);
    return res.status(500).json({ error: "Failed to process audit analysis.", detail: error.message });
  }
}