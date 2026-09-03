// api/generate-pdf-report.js
//
// Standalone endpoint whose only job is: given a cached analysis result,
// render the PDF and deliver it to the originating Telegram chat.
//
// Why this exists as a separate function, not inline in
// telegram-webhook.js: on Vercel's Hobby plan, function execution is
// hard-capped at 60 seconds — maxDuration in vercel.json cannot raise
// this, Vercel silently enforces the cap regardless. The full chain
// (extract-boq → check-analysis LLM call → Puppeteer/Chromium PDF
// render → sendDocument) comfortably exceeds 60s end-to-end (confirmed
// live: "Vercel Runtime Timeout Error: Task timed out after 60 seconds",
// with the timeout landing mid-check-analysis, before PDF generation
// even started).
//
// Splitting into two phases gives each phase its own fresh 60s budget:
//   Phase 1 (telegram-webhook.js): extract + analyze + short message.
//   Phase 2 (this file): PDF render + delivery, triggered by phase 1 via
//     a fire-and-forget HTTP call — NOT awaited by phase 1, so phase 1's
//     own execution isn't held hostage by phase 2's duration.
//
// This endpoint is invoked internally, not by Telegram directly — it
// expects a shared-secret header (INTERNAL_TRIGGER_SECRET) rather than
// Telegram's own request shape, to prevent it from being callable by
// anyone who finds the URL.

import { createClient } from "@supabase/supabase-js";
import { generateAuditPdf } from "./_lib/reportGenerator.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function sendDocument(chatId, buffer, fileName, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([buffer], { type: "application/pdf" }), fileName);
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "Markdown");
  }
  const res = await fetch(`${TELEGRAM_API}/sendDocument`, { method: "POST", body: form });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`sendDocument failed (${res.status}): ${txt.slice(0, 200)}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Shared-secret check — this endpoint is triggered internally by
  // telegram-webhook.js, not by Telegram itself, so it doesn't get
  // Telegram's own request validation. Without this, anyone who found
  // the URL could ask this function to burn PDF-generation compute on
  // arbitrary cache row IDs.
  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_TRIGGER_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { cacheId } = req.body || {};
  if (!cacheId) {
    return res.status(400).json({ error: "Missing cacheId" });
  }

  // Respond to the trigger immediately — the caller (telegram-webhook.js)
  // already didn't wait for this, but if it or anything else ever does,
  // there's no reason to hold the connection open while the PDF renders.
  res.status(202).json({ ok: true, status: "processing" });

  let chatId;
  try {
    const { data: row, error } = await supabaseAdmin
      .from("telegram_audit_cache")
      .select("analysis, file_name, project_name, telegram_chat_id")
      .eq("id", cacheId)
      .single();

    if (error || !row) {
      console.error(`[generate-pdf-report] Cache row not found for id ${cacheId}:`, error?.message);
      return;
    }

    chatId = row.telegram_chat_id;

    const pdfBuffer = await generateAuditPdf(row.analysis, {
      fileName: row.file_name,
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    });

    const pdfName = `BidSwift-Audit-${(row.project_name || row.file_name || "report").replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;

    await sendDocument(chatId, pdfBuffer, pdfName, "📄 Full forensic audit report — findings evidence-linked to source.");
  } catch (err) {
    console.error("[generate-pdf-report] PDF generation/delivery failed:", err.message, err.stack);
    if (chatId) {
      await sendMessage(chatId, `Couldn't generate the full PDF report: ${err.message}. The short summary above is still valid — you can request the PDF again if needed.`).catch(() => {});
    }
  }
}