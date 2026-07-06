// api/check-analysis.js
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    const chatCompletion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.15,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    });

    let raw = chatCompletion.choices[0]?.message?.content || "{}";
    
    // FIX: Strip markdown formatting so JSON.parse doesn't crash
    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const analysis = JSON.parse(raw);
    return res.status(200).json(analysis);

  } catch (error) {
    console.error("Groq API Failure:", error);
    return res.status(500).json({ error: "Failed to process audit analysis.", detail: error.message });
  }
}