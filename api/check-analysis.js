// api/check-analysis.js
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

// ─── Security config ────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_REQUESTS = 5;
const MAX_PROMPT_CHARS = 60000; // covers a large BoQ; adjust if your bid packages run bigger
const IS_PROD = process.env.VERCEL_ENV === "production";

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

function calculateRiskScore(analysis) {
  const marketVariance = analysis.market_variance || [];

  // Pricing data coverage: what fraction of BOQ items actually got a real
  // reference-price match, vs. "Reference unavailable" placeholders. This
  // is the deterministic signal check-analysis.js already computes via
  // pricingEvidence.js (match.matched / confidence) — we're just reading it
  // here rather than trusting the qualitative LLM findings alone.
  const totalItems = marketVariance.length;
  const matchedItems = marketVariance.filter(
    (m) => m.reference_price != null && m.variance_pct != null
  ).length;
  const pricingCoverage = totalItems > 0 ? matchedItems / totalItems : 0;

  let score = 50; // baseline

  (analysis.contractual_traps || []).forEach((trap) => {
    if (trap.severity === "CRITICAL") score += 10;
    else if (trap.severity === "HIGH") score += 5;
  });

  (analysis.arithmetic_errors || []).forEach((err) => {
    if (err.severity === "HIGH") score += 8;
    else if (err.severity === "MEDIUM") score += 4;
  });

  marketVariance.forEach((m) => {
    if (m.variance_pct != null && Math.abs(m.variance_pct) > 20) score += 3;
  });

  (analysis.scope_gaps || []).forEach(() => score += 5);

  if (analysis.recommendation === "DECLINE") score += 15;
  else if (analysis.recommendation === "PROCEED") score -= 10;

  const rawScore = Math.max(0, Math.min(100, Math.round(score)));

  // Never present a confident numeric risk score when we have little or no
  // verified pricing evidence to back it — the qualitative findings above
  // (contractual traps, scope gaps) don't require priced BOQ data, so a
  // high score built almost entirely from them while pricing coverage is
  // near zero would look identical to — and be indistinguishable from — a
  // genuinely well-priced, low-risk bid we simply couldn't verify. That is
  // exactly the "hallucinated figure delivered with confidence" failure
  // mode this product exists to prevent. See 02_DUE_DILIGENCE_FINDINGS.md,
  // CTO lens.
  let dataConfidence;
  if (totalItems === 0) {
    dataConfidence = "none"; // no BOQ items at all — nothing to score
  } else if (pricingCoverage < 0.2) {
    dataConfidence = "low"; // <20% of items priced — score is unreliable
  } else if (pricingCoverage < 0.6) {
    dataConfidence = "medium";
  } else {
    dataConfidence = "high";
  }

  return {
    // null (not a number) when we don't have enough real pricing data to
    // stand behind a numeric score — the frontend must treat this as "show
    // an insufficient-data state," not "render 0" or fall back to a default.
    score: dataConfidence === "none" || dataConfidence === "low" ? null : rawScore,
    dataConfidence,
    pricingCoverage: Math.round(pricingCoverage * 100),
    pricedItemCount: matchedItems,
    totalItemCount: totalItems,
  };
}
export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
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
  const userId = userData.user.id;

  // ─── Rate limit check ──────────────────────────────────────────────
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error: rateError } = await supabaseAdmin
    .from("api_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", "check-analysis")
    .gte("created_at", windowStart);

  if (rateError) {
    console.error("Rate limit check failed (failing open):", rateError);
  } else if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX_REQUESTS} audits per ${RATE_LIMIT_WINDOW_MINUTES} minutes. Try again shortly.`,
    });
  }

  // Log this attempt before the expensive call, so concurrent bursts are capped.
  await supabaseAdmin.from("api_rate_limits").insert({ user_id: userId, endpoint: "check-analysis" });

  try {
    const { systemPrompt, userPrompt } = req.body || {};
    if (!systemPrompt || !userPrompt) {
      return res.status(400).json({ error: "Missing systemPrompt or userPrompt." });
    }
    if (typeof systemPrompt !== "string" || typeof userPrompt !== "string") {
      return res.status(400).json({ error: "systemPrompt and userPrompt must be strings." });
    }
    if (systemPrompt.length > MAX_PROMPT_CHARS || userPrompt.length > MAX_PROMPT_CHARS) {
      return res.status(413).json({ error: `Prompt too large. Max ${MAX_PROMPT_CHARS} characters per field.` });
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": ALLOWED_ORIGIN,
        "X-Title": "BidSwift AI",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.15,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    let raw = data.choices?.[0]?.message?.content || "{}";
    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const analysis = JSON.parse(raw);

    analysis.contractual_traps = Array.isArray(analysis.contractual_traps) ? analysis.contractual_traps : [];
    analysis.arithmetic_errors = Array.isArray(analysis.arithmetic_errors) ? analysis.arithmetic_errors : [];
    analysis.market_variance = Array.isArray(analysis.market_variance) ? analysis.market_variance : [];
    analysis.scope_gaps = Array.isArray(analysis.scope_gaps) ? analysis.scope_gaps : [];

    // Compute the risk score deterministically. calculateRiskScore now
    // returns an object, not a bare number — score is null when pricing
    // coverage is too thin to stand behind a confident numeric verdict.
    const riskResult = calculateRiskScore(analysis);

    const responsePayload = {
      ...analysis,
      risk_score: riskResult.score, // may be null — frontend must handle this
      data_confidence: riskResult.dataConfidence, // "none" | "low" | "medium" | "high"
      pricing_coverage_percent: riskResult.pricingCoverage,
      priced_item_count: riskResult.pricedItemCount,
      total_item_count: riskResult.totalItemCount,
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("OpenRouter API Failure:", error);
    return res.status(500).json({
      error: "Failed to process audit analysis.",
      ...(IS_PROD ? {} : { detail: error.message }),
    });
  }
}