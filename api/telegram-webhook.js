// api/telegram-webhook.js
//
// The Telegram bot is a real lead-facing product surface, not a personal
// testing convenience (see SESSION_HANDOFF from 2026-08-30 for the
// original "personal testing only" scoping — that framing is now
// superseded, this file is designed as the primary UX for early leads).
//
// This file does no extraction or analysis of its own — all real logic
// stays in /api/extract-boq and /api/check-analysis, the same endpoints
// the web UI calls. This file's only jobs are: (1) drive a good Telegram
// conversation flow around those endpoints, and (2) generate/deliver the
// PDF report via reportGenerator.js.

import { createClient } from "@supabase/supabase-js";
import { generateAuditPdf } from "./_lib/reportGenerator.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Simple allowlist so this doesn't become an open, unauthenticated public
// endpoint for anyone who finds the bot username. Set to your own and
// pilot testers' Telegram numeric user IDs (get via @userinfobot).
const ALLOWED_TELEGRAM_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ─── Telegram API helpers ──────────────────────────────────────────────

async function sendMessage(chatId, text, opts = {}) {
  const body = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.result; // includes message_id, useful for editMessageText later
}

async function editMessageText(chatId, messageId, text, opts = {}) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: "Markdown" };
  if (opts.replyMarkup) body.reply_markup = opts.replyMarkup;
  await fetch(`${TELEGRAM_API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

async function answerCallbackQuery(callbackQueryId, text) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
  });
}

async function getFileBuffer(fileId) {
  const fileInfoRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  const arrayBuffer = await fileRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), fileName: filePath.split("/").pop() };
}

// One-time command registration. Cheap to call on every cold start —
// Telegram no-ops if the command list is unchanged. Not worth gating
// behind a "first run only" check for the API cost involved.
async function registerCommands() {
  await fetch(`${TELEGRAM_API}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "start", description: "What BidSwift AI does" },
        { command: "audit", description: "Upload a BOQ/tender to audit" },
        { command: "help", description: "How the audit and risk score work" },
      ],
    }),
  });
}

// ─── Auth to internal endpoints ────────────────────────────────────────

async function getServiceAuthToken() {
  // extract-boq.js requires a Bearer token validated via
  // supabaseAdmin.auth.getUser(token) — designed for real logged-in
  // browser sessions, which this bot has none of. Authenticates as a
  // dedicated service user via Supabase's password grant instead of
  // weakening the real auth boundary on extract-boq.js.
  const email = process.env.TELEGRAM_BOT_SUPABASE_EMAIL;
  const password = process.env.TELEGRAM_BOT_SUPABASE_PASSWORD;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!email || !password) {
    throw new Error(
      "TELEGRAM_BOT_SUPABASE_EMAIL / TELEGRAM_BOT_SUPABASE_PASSWORD not set — see getServiceAuthToken() comment."
    );
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase auth failed for service bot user (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token;
}

// ─── Core audit flow ────────────────────────────────────────────────────

// Calls the SAME internal endpoints the web UI uses — no duplicated
// extraction/analysis logic. progressCb lets the caller show staged
// status updates in Telegram while this runs, mirroring the web UI's
// LOADING_STEPS in audit.tsx.
async function runAudit(buffer, fileName, baseUrl, progressCb) {
  const authToken = await getServiceAuthToken();

  const form = new FormData();
  form.append("file", new Blob([buffer]), fileName);

  await progressCb?.("Parsing source document...");

  const extractRes = await fetch(`${baseUrl}/api/extract-boq`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: form,
  });

  if (!extractRes.ok) {
    const errBody = await extractRes.json().catch(() => ({}));
    throw new Error(`extract-boq returned ${extractRes.status}: ${errBody.error || "unknown error"}`);
  }

  const extractData = await extractRes.json();

  if (!extractData.boqItems || extractData.boqItems.length === 0) {
    return {
      ok: false,
      summary: `No BOQ line items could be extracted from *${fileName}*.\n\n${extractData.warning || extractData.meta?.warnings?.join(" ") || "The document may be scanned/unreadable, or not a BOQ format BidSwift currently supports."}`,
    };
  }

  await progressCb?.(`${extractData.boqItems.length} BOQ item(s) extracted. Running compliance + risk analysis...`);

  const analysisRes = await fetch(`${baseUrl}/api/check-analysis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      systemPrompt:
        "You are a forensic bid auditor for Ethiopian construction tenders. " +
        "Analyze the supplied BOQ and document text for contractual risk, scope gaps, " +
        "and compliance issues. Return a JSON object with fields: contractual_traps, " +
        "scope_gaps, recommendation (one of PROCEED, PROCEED_WITH_CAUTION, DECLINE), " +
        "and a brief executive_summary string.",
      userPrompt:
        `Audit this bid submission (${fileName}) and identify contractual risks and scope gaps.`,
      boqItems: extractData.boqItems,
      documentText: extractData.rawText || null,
      clauses: extractData.clauses || null,
      // No form input in the Telegram flow to collect a stated contract
      // total — the grand-total-mismatch check therefore doesn't run via
      // this path. Per-line arithmetic checks still do. Known, accepted
      // gap versus the web UI (see SESSION_HANDOFF).
      contractValue: null,
    }),
  });

  if (!analysisRes.ok) {
    const errBody = await analysisRes.json().catch(() => ({}));
    // check-analysis.js now returns 502 with a real message for
    // unsalvageable provider responses (see the JSON-parse hardening
    // added alongside this bot rewrite) instead of a bare 500 — surface
    // that message directly so a retry suggestion actually makes sense.
    throw new Error(`${errBody.error || `check-analysis returned ${analysisRes.status}`}`);
  }

  const analysisData = await analysisRes.json();
  return { ok: true, extractData, analysisData };
}

function buildShortMessage(fileName, extractData, analysisData) {
  const riskLine =
    analysisData.risk_score === null || analysisData.risk_score === undefined
      ? "Risk score: N/A (insufficient evidence for a responsible score)"
      : `Risk score: *${analysisData.risk_score}/100*`;

  const rec = (analysisData.recommendation || "N/A").replace(/_/g, " ");
  const oneLiner = (analysisData.executive_summary || "").split(/(?<=[.!?])\s/)[0] || "";

  return (
    `*BidSwift Audit — ${fileName}*\n\n` +
    `${extractData.boqItems.length} BOQ item(s) analyzed\n` +
    `${riskLine}\n` +
    `Recommendation: *${rec}*\n\n` +
    (oneLiner ? `${oneLiner}\n\n` : "") +
    `Tap below for the full forensic report — findings, contractual risk register, and pricing variance, ` +
    `evidence-linked to source.`
  );
}

// ─── Request handler ────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true }); // Telegram GET pings just need a 200.
  }

  const update = req.body;

  // ── Callback query: "View Full Report" button tap ──────────────────
  if (update.callback_query) {
    const cq = update.callback_query;
    const userId = String(cq.from?.id || "");
    if (ALLOWED_TELEGRAM_USER_IDS.length > 0 && !ALLOWED_TELEGRAM_USER_IDS.includes(userId)) {
      await answerCallbackQuery(cq.id, "Not authorized.");
      return res.status(200).json({ ok: true });
    }

    const chatId = cq.message.chat.id;
    const data = cq.data || "";
    const match = data.match(/^report:(.+)$/);

    if (!match) {
      await answerCallbackQuery(cq.id);
      return res.status(200).json({ ok: true });
    }

    const cacheId = match[1];
    await answerCallbackQuery(cq.id, "Generating PDF...");

    try {
      const { data: row, error } = await supabaseAdmin
        .from("telegram_audit_cache")
        .select("analysis, file_name, project_name")
        .eq("id", cacheId)
        .single();

      if (error || !row) {
        await sendMessage(chatId, "This report has expired — please re-run the audit to get a fresh one.");
        return res.status(200).json({ ok: true });
      }

      const pdfBuffer = await generateAuditPdf(row.analysis, {
        fileName: row.file_name,
        generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
      });

      const pdfName = `BidSwift-Audit-${(row.project_name || row.file_name || "report").replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
      await sendDocument(chatId, pdfBuffer, pdfName, "📄 Full forensic audit report — findings evidence-linked to source.");
    } catch (err) {
      console.error("[telegram-webhook] PDF generation failed:", err.message, err.stack);
      await sendMessage(chatId, `Couldn't generate the PDF report: ${err.message}. Please try again.`);
    }

    return res.status(200).json({ ok: true });
  }

  // ── Regular message ─────────────────────────────────────────────────
  const message = update.message;
  if (!message) return res.status(200).json({ ok: true });

  const chatId = message.chat.id;
  const userId = String(message.from?.id || "");

  if (ALLOWED_TELEGRAM_USER_IDS.length > 0 && !ALLOWED_TELEGRAM_USER_IDS.includes(userId)) {
    // Silently ignore rather than reply — don't confirm to strangers that
    // this bot exists and is listening.
    console.warn(`[telegram-webhook] Ignored message from non-allowlisted user ${userId}`);
    return res.status(200).json({ ok: true });
  }

  await registerCommands();

  if (message.text === "/start") {
    await sendMessage(
      chatId,
      "*BidSwift AI* — pre-bid forensic audit for Ethiopian construction tenders.\n\n" +
      "Send me a BOQ/tender document (PDF or XLSX) and I'll check it for arithmetic errors, " +
      "contractual risk, scope gaps, and pricing deviation against the official government rate schedule.\n\n" +
      "Use /audit to get started, or just send a file directly. Use /help for details on how the audit works."
    );
    return res.status(200).json({ ok: true });
  }

  if (message.text === "/audit") {
    await sendMessage(chatId, "Send the BOQ/tender file now — PDF or XLSX.");
    return res.status(200).json({ ok: true });
  }

  if (message.text === "/help") {
    await sendMessage(
      chatId,
      "*How it works*\n\n" +
      "1. Send a BOQ/tender document (PDF or XLSX)\n" +
      "2. BidSwift extracts every line item and cross-checks arithmetic, contract clauses, and pricing\n" +
      "3. You get a risk score, a recommendation (Proceed / Proceed with Caution / Decline), and a short summary\n" +
      "4. Tap *View Full Report* for the complete forensic PDF — every finding linked back to its source location\n\n" +
      "This is decision support, not a decision-maker — every finding is meant to be checked, not blindly trusted. " +
      "Pricing is benchmarked against a historical government rate schedule, not live market prices."
    );
    return res.status(200).json({ ok: true });
  }

  const doc = message.document;
  if (!doc) {
    await sendMessage(chatId, "Send a PDF or XLSX file to audit, or use /help to see how this works.");
    return res.status(200).json({ ok: true });
  }

  // ── File received — run the audit with staged progress updates ─────
  let progressMsg;
  try {
    progressMsg = await sendMessage(chatId, `Received *${doc.file_name}* — starting audit...`);

    const { buffer, fileName } = await getFileBuffer(doc.file_id);
    const baseUrl = `https://${req.headers.host}`;

    const progressCb = async (text) => {
      if (progressMsg?.message_id) {
        await editMessageText(chatId, progressMsg.message_id, text);
      }
    };

    const result = await runAudit(buffer, fileName, baseUrl, progressCb);

    if (!result.ok) {
      await editMessageText(chatId, progressMsg.message_id, result.summary);
      return res.status(200).json({ ok: true });
    }

    const { extractData, analysisData } = result;
    const shortMessage = buildShortMessage(fileName, extractData, analysisData);

    // Cache the full analysis so the "View Full Report" button (a
    // separate webhook request with no access to this closure's data)
    // can look it back up. See migrations/004_telegram_audit_cache.sql.
    const { data: cacheRow, error: cacheErr } = await supabaseAdmin
      .from("telegram_audit_cache")
      .insert({
        telegram_chat_id: String(chatId),
        telegram_user_id: userId,
        file_name: fileName,
        project_name: analysisData.project_name || fileName,
        analysis: analysisData,
      })
      .select("id")
      .single();

    if (cacheErr || !cacheRow) {
      console.error("[telegram-webhook] Failed to cache analysis for PDF button:", cacheErr?.message);
      // Degrade gracefully — still deliver the short result, just without
      // the PDF button, rather than losing the whole audit result.
      await editMessageText(chatId, progressMsg.message_id, shortMessage);
      return res.status(200).json({ ok: true });
    }

    await editMessageText(chatId, progressMsg.message_id, shortMessage, {
      replyMarkup: {
        inline_keyboard: [[{ text: "📄 View Full Report (PDF)", callback_data: `report:${cacheRow.id}` }]],
      },
    });
  } catch (err) {
    console.error("[telegram-webhook] Audit failed:", err.message, err.stack);
    const failMsg = `Audit failed: ${err.message}\n\nPlease try again — if this keeps happening, the file may need a different format.`;
    if (progressMsg?.message_id) {
      await editMessageText(chatId, progressMsg.message_id, failMsg);
    } else {
      await sendMessage(chatId, failMsg);
    }
  }

  return res.status(200).json({ ok: true });
}
