console.log("OPENROUTER_API_KEY present:", !!process.env.OPENROUTER_API_KEY, "| length:", process.env.OPENROUTER_API_KEY?.length);
// api/check-analysis.js
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── OpenRouter configuration ──────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

function calculateRiskScore(analysis) {
  let score = 50;
  (analysis.contractual_traps || []).forEach((trap) => {
    if (trap.severity === "CRITICAL") score += 10;
    else if (trap.severity === "HIGH") score += 5;
  });
  (analysis.arithmetic_errors || []).forEach((err) => {
    if (err.severity === "HIGH") score += 8;
    else if (err.severity === "MEDIUM") score += 4;
  });
  (analysis.market_variance || []).forEach((m) => {
    if (Math.abs(m.variance_pct) > 20) score += 3;
  });
  (analysis.scope_gaps || []).forEach(() => score += 5);
  if (analysis.recommendation === "DECLINE") score += 15;
  else if (analysis.recommendation === "PROCEED") score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
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
    const { systemPrompt, userPrompt } = req.body;
    if (!systemPrompt || !userPrompt) {
      return res.status(400).json({ error: "Missing systemPrompt or userPrompt." });
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://bidswift-ai.vercel.app", // update to your real deployed URL
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

    const risk_score = calculateRiskScore(analysis);
    return res.status(200).json({ ...analysis, risk_score });
  } catch (error) {
    console.error("OpenRouter API Failure:", error);
    return res.status(500).json({ error: "Failed to process audit analysis.", detail: error.message });
  }
}