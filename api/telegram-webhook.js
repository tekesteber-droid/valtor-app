// api/telegram-webhook.js
//
// The Telegram bot is a real lead-facing product surface, not a personal
// testing convenience.
//
// This file does no extraction or analysis of its own — all real logic
// stays in /api/extract-boq and /api/check-analysis, the same endpoints
// the web UI calls. This file's job is to drive the Telegram conversation
// flow and produce the short result. PDF generation happens in a SEPARATE
// function (api/generate-pdf-report.js) — see that file's header comment
// for why: Vercel's Hobby plan hard-caps function execution at 60s, and
// the full extract+analyze+PDF chain confirmed-live exceeds that as one
// request. This file triggers the PDF endpoint via a fire-and-forget
// fetch call once its own (already tight) work is done, rather than
// generating the PDF inline.
//
// ── On the retry-loop bug and how it's actually handled ────────────────
// Telegram redelivers a webhook update if it doesn't get a 200 response
// back within its own timeout. The extract+analyze portion alone can
// take 50s+ on a large BOQ (confirmed live: ~55s on a 115-item file) —
// close enough to Telegram's own delivery timeout that a retry is a real
// possibility even without the PDF step in the mix.
//
// A first attempt at fixing this tried to send res.status(200) BEFORE
// running the audit, then keep executing afterward — on the assumption
// that Vercel keeps a Node serverless function alive until pending async
// work drains. That assumption was wrong in practice: once the response
// was sent, the function's execution context froze immediately, so nothing
// after res.status(200).json(...) ever actually ran (confirmed live:
// /start acked cleanly in the logs, but the bot never replied).
//
// The actual fix here is simpler: run the full flow to completion before
// responding, and rely on update_id deduplication (below) to absorb
// Telegram's retries as safe no-ops instead of re-running the audit.

import { createClient } from "@supabase/supabase-js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_TELEGRAM_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// In-memory recent-update cache, per warm function instance. Best-effort
// first line of defense (cheap, no DB round trip) — the fast-ack fix
// itself is the durable fix; this is a secondary safety net.
const recentUpdateIds = new Set();
const MAX_RECENT_IDS = 500;

function seenRecently(updateId) {
  if (recentUpdateIds.has(updateId)) return true;
  recentUpdateIds.add(updateId);
  if (recentUpdateIds.size > MAX_RECENT_IDS) {
    const first = recentUpdateIds.values().next().value;
    recentUpdateIds.delete(first);
  }
  return false;
}

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
  return data.result;
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

async function getFileBuffer(fileId) {
  const fileInfoRes = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  const arrayBuffer = await fileRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), fileName: filePath.split("/").pop() };
}

// setMyCommands is what actually powers the "/" menu button and the
// command autocomplete list in the Telegram client — this IS the same
// mechanism BotFather's /setcommands flow uses under the hood. BotFather
// is a chat-based UI wrapper around this same Bot API call, not a
// separate "real" registration path. Nothing further needs to be
// configured in BotFather itself for the command menu to work.
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
  const email = process.env.TELEGRAM_BOT_SUPABASE_EMAIL;
  const password = process.env.TELEGRAM_BOT_SUPABASE_PASSWORD;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!email || !password) {
    throw new Error("TELEGRAM_BOT_SUPABASE_EMAIL / TELEGRAM_BOT_SUPABASE_PASSWORD not set.");
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
        "scope_gaps, recommendation (REQUIRED — must be exactly one of: PROCEED, " +
        "PROCEED_WITH_CAUTION, DECLINE — never omit this field), " +
        "and a brief executive_summary string.",
      userPrompt:
        `Audit this bid submission (${fileName}) and identify contractual risks and scope gaps.`,
      boqItems: extractData.boqItems,
      documentText: extractData.rawText || null,
      clauses: extractData.clauses || null,
      contractValue: null,
    }),
  });

  if (!analysisRes.ok) {
    const errBody = await analysisRes.json().catch(() => ({}));
    throw new Error(`${errBody.error || `check-analysis returned ${analysisRes.status}`}`);
  }

  const analysisData = await analysisRes.json();

  // Code-level fallback for a field the LLM sometimes omits (seen live:
  // a "successful" run with a valid risk_score but no recommendation
  // key at all). Better to derive a conservative default from the score
  // than show the contractor a bare "N/A" with no explanation.
  if (!analysisData.recommendation) {
    const score = analysisData.risk_score;
    analysisData.recommendation =
      score === null || score === undefined
        ? "PROCEED_WITH_CAUTION"
        : score >= 65
        ? "DECLINE"
        : score >= 35
        ? "PROCEED_WITH_CAUTION"
        : "PROCEED";
    analysisData._recommendation_inferred = true;
  }

  return { ok: true, extractData, analysisData };
}

function buildResultCaption(fileName, extractData, analysisData) {
  const riskLine =
    analysisData.risk_score === null || analysisData.risk_score === undefined
      ? "Risk score: N/A (insufficient evidence for a responsible score)"
      : `Risk score: *${analysisData.risk_score}/100*`;

  const rec = (analysisData.recommendation || "PROCEED_WITH_CAUTION").replace(/_/g, " ");
  const oneLiner = (analysisData.executive_summary || "").split(/(?<=[.!?])\s/)[0] || "";

  return (
    `*BidSwift Audit — ${fileName}*\n\n` +
    `${extractData.boqItems.length} BOQ item(s) analyzed\n` +
    `${riskLine}\n` +
    `Recommendation: *${rec}*\n\n` +
    (oneLiner ? `${oneLiner}\n\n` : "") +
    `Full forensic report follows shortly — every finding evidence-linked to source.`
  );
}

// The extract + analyze work, run to completion within THIS function's
// budget. PDF generation is deliberately NOT done here — see the
// trigger call at the end of this function and the header comment in
// generate-pdf-report.js for why.
async function processAuditInBackground(chatId, userId, doc, host) {
  let progressMsg;
  try {
    progressMsg = await sendMessage(chatId, `Received *${doc.file_name}* — starting audit...`);

    const { buffer, fileName } = await getFileBuffer(doc.file_id);
    const baseUrl = `https://${host}`;

    const progressCb = async (text) => {
      if (progressMsg?.message_id) {
        await editMessageText(chatId, progressMsg.message_id, text);
      }
    };

    const result = await runAudit(buffer, fileName, baseUrl, progressCb);

    if (!result.ok) {
      await editMessageText(chatId, progressMsg.message_id, result.summary);
      return;
    }

    const { extractData, analysisData } = result;
    const caption = buildResultCaption(fileName, extractData, analysisData);

    await editMessageText(chatId, progressMsg.message_id, caption);

    // Cache the analysis so the PDF-generation endpoint (a separate
    // function invocation, with its own fresh execution budget) can look
    // it up. See migrations/004_telegram_audit_cache.sql.
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
      // Log the FULL error object, not just .message — Supabase errors
      // carry .code, .details, .hint which are essential for telling a
      // genuine PostgREST schema-cache miss (code PGRST205) apart from a
      // connection failure, wrong project, or something else entirely.
      // Logging only .message was masking this during earlier debugging.
      console.error("[telegram-webhook] Failed to cache analysis for PDF generation:", JSON.stringify(cacheErr, null, 2));
      console.error("[telegram-webhook] Supabase client config check:", {
        urlSet: Boolean(process.env.VITE_SUPABASE_URL),
        urlPrefix: process.env.VITE_SUPABASE_URL?.slice(0, 30),
        keySet: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        keyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length,
      });
      await sendMessage(chatId, "Couldn't queue the full PDF report — the short summary above is still valid.");
      return;
    }

    await sendMessage(chatId, "📄 Generating the full forensic report — arriving in a moment...");

    // Fire-and-forget trigger to the standalone PDF-generation endpoint.
    // Deliberately NOT awaited: this function's own execution budget is
    // already mostly spent on extract+analyze (confirmed live: ~55s just
    // for that portion on a 115-item BOQ), and PDF generation via
    // Puppeteer/Chromium needs its own fresh 60s window, not whatever's
    // left of this one. If this fetch call itself fails to even fire
    // (network blip), the user still has their short result — the PDF is
    // additive, not the only output.
    fetch(`https://${host}/api/generate-pdf-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_TRIGGER_SECRET,
      },
      body: JSON.stringify({ cacheId: cacheRow.id }),
    }).catch((err) => {
      console.error("[telegram-webhook] Failed to trigger PDF generation:", err.message);
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
}


// ─── Request handler ────────────────────────────────────────────────────
//
// IMPORTANT — why this does NOT ack-then-continue:
// An earlier version of this file sent res.status(200) immediately and
// then kept executing (sendMessage calls, the audit, etc.) afterward,
// on the assumption that Vercel keeps a Node serverless function alive
// until pending async work drains. That assumption was wrong in practice
// — after the response was sent, the function's execution context froze
// immediately, so nothing after res.status(200).json(...) ever actually
// ran. Real symptom: /start acked with a clean 200 in the logs, but the
// bot never sent its reply.
//
// The fix: run the full flow to completion BEFORE responding, same as
// before this whole retry-loop investigation started. What actually
// solves the duplicate-audit problem is the update_id dedup check below
// — if Telegram retries a slow request, the retry's update_id has
// already been seen and is swallowed as a no-op instead of re-running
// the audit. maxDuration is set to 60s in vercel.json to give the full
// extract+analyze+PDF flow real headroom before Vercel itself would time
// the function out.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).json({ ok: true });
    return;
  }

  const update = req.body;

  if (update.update_id !== undefined) {
    if (seenRecently(update.update_id)) {
      console.warn(`[telegram-webhook] Ignored duplicate update_id ${update.update_id}`);
      res.status(200).json({ ok: true });
      return;
    }
  }

  const message = update.message;
  if (!message) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const userId = String(message.from?.id || "");

  if (ALLOWED_TELEGRAM_USER_IDS.length > 0 && !ALLOWED_TELEGRAM_USER_IDS.includes(userId)) {
    console.warn(`[telegram-webhook] Ignored message from non-allowlisted user ${userId}`);
    res.status(200).json({ ok: true });
    return;
  }

  await registerCommands();

  if (message.text === "/start") {
    await sendMessage(
      chatId,
      "*BidSwift AI* — pre-bid forensic audit for Ethiopian construction tenders.\n\n" +
      "Send me a BOQ/tender document (PDF or XLSX) and I'll check it for arithmetic errors, " +
      "contractual risk, scope gaps, and pricing deviation against the official government rate schedule. " +
      "You'll get a full PDF report automatically.\n\n" +
      "Use /audit to get started, or just send a file directly. Use /help for details on how the audit works."
    );
    res.status(200).json({ ok: true });
    return;
  }

  if (message.text === "/audit") {
    await sendMessage(chatId, "Send the BOQ/tender file now — PDF or XLSX.");
    res.status(200).json({ ok: true });
    return;
  }

  if (message.text === "/help") {
    await sendMessage(
      chatId,
      "*How it works*\n\n" +
      "1. Send a BOQ/tender document (PDF or XLSX)\n" +
      "2. BidSwift extracts every line item and cross-checks arithmetic, contract clauses, and pricing\n" +
      "3. You get a short summary and the complete forensic PDF automatically — every finding linked back to its source location\n\n" +
      "This is decision support, not a decision-maker — every finding is meant to be checked, not blindly trusted. " +
      "Pricing is benchmarked against a historical government rate schedule, not live market prices."
    );
    res.status(200).json({ ok: true });
    return;
  }

  const doc = message.document;
  if (!doc) {
    await sendMessage(chatId, "Send a PDF or XLSX file to audit, or use /help to see how this works.");
    res.status(200).json({ ok: true });
    return;
  }

  await processAuditInBackground(chatId, userId, doc, req.headers.host);
  res.status(200).json({ ok: true });
}