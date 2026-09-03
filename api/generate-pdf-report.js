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
// live: "Vercel Runtime Timeout Error: Task timed out after 60 seconds").
//
// Splitting into two phases gives each phase its own fresh 60s budget:
//   Phase 1 (telegram-webhook.js): extract + analyze + short message.
//   Phase 2 (this file): PDF render + delivery, triggered by phase 1 via
//     a fire-and-forget HTTP call — NOT awaited by phase 1, so phase 1's
//     own execution isn't held hostage by phase 2's duration.
//
// This function runs to completion before responding (does NOT ack
// early). An earlier version tried res.status(202) immediately followed
// by continued execution, on the assumption that Vercel keeps a function
// alive after the response is sent — confirmed wrong via the Vercel
// dashboard logs: a clean 202 was recorded, then nothing after it, ever.
// Since this endpoint's only caller (telegram-webhook.js) already treats
// the trigger call as fire-and-forget and doesn't wait on the response
// anyway, there's no real benefit to acking early — only the cost of the
// function silently dying mid-render, which is what was actually
// happening.
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

  const secret = req.headers["x-internal-secret"];
  if (!secret || secret !== process.env.INTERNAL_TRIGGER_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { cacheId } = req.body || {};
  if (!cacheId) {
    return res.status(400).json({ error: "Missing cacheId" });
  }

  // IMPORTANT — do NOT respond early here.
  // An earlier version of this handler sent res.status(202) immediately,
  // then tried to keep running (the Supabase lookup, Puppeteer launch,
  // PDF render, sendDocument) afterward — the same "ack then continue"
  // pattern that already broke telegram-webhook.js once this session on
  // the assumption that Vercel keeps a function alive after the response
  // is sent. Confirmed wrong again here: the dashboard log showed a
  // clean 202 response and then NOTHING after it — no success log, no
  // error log, no crash trace. The execution context froze the instant
  // the response was sent, before the Supabase lookup even ran.
  //
  // The fix is the same as before: run everything to completion, then
  // respond. This function is only ever invoked internally via a
  // fire-and-forget fetch from telegram-webhook.js (which doesn't await
  // the response anyway), so there's no real caller waiting on a fast
  // ack — nothing is lost by responding last instead of first.
  let chatId;
  try {
    const { data: row, error } = await supabaseAdmin
      .from("telegram_audit_cache")
      .select("analysis, file_name, project_name, telegram_chat_id")
      .eq("id", cacheId)
      .single();

    if (error || !row) {
      console.error(`[generate-pdf-report] Cache row not found for id ${cacheId}:`, error?.message);
      return res.status(404).json({ error: "Cache row not found" });
    }

    chatId = row.telegram_chat_id;

    console.log(`[generate-pdf-report] Starting PDF generation for chat ${chatId}, cache ${cacheId}...`);

    const pdfBuffer = await generateAuditPdf(row.analysis, {
      fileName: row.file_name,
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    });

    console.log(`[generate-pdf-report] PDF generated (${pdfBuffer.length} bytes), sending to Telegram...`);

    const pdfName = `BidSwift-Audit-${(row.project_name || row.file_name || "report").replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;

    await sendDocument(chatId, pdfBuffer, pdfName, "📄 Full forensic audit report — findings evidence-linked to source.");

    console.log(`[generate-pdf-report] PDF delivered successfully to chat ${chatId}.`);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[generate-pdf-report] PDF generation/delivery failed:", err.message, err.stack);
    if (chatId) {
      await sendMessage(chatId, `Couldn't generate the full PDF report: ${err.message}. The short summary above is still valid — you can request the PDF again if needed.`).catch(() => {});
    }
    return res.status(500).json({ error: err.message });
  }
}