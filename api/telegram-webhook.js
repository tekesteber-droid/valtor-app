// api/telegram-webhook.js
//
// Personal-testing convenience layer only — NOT a product feature. This is
// a thin wrapper: it does no extraction or analysis of its own. It receives
// a document from Telegram, forwards it to the existing /api/extract-boq
// and /api/check-analysis endpoints (the same ones the web UI calls), and
// relays the result back as a Telegram message. All real logic stays in
// the endpoints already built and verified — this file must never grow
// its own copy of extraction/analysis logic.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Simple allowlist so this personal-testing bot doesn't become an open,
// unauthenticated public endpoint for anyone who finds the bot username.
// Set to your own Telegram numeric user ID (get it from @userinfobot).
const ALLOWED_TELEGRAM_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
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

// Calls the SAME internal endpoints the web UI uses — no duplicated logic.
async function runAudit(buffer, fileName, baseUrl) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), fileName);

  const extractRes = await fetch(`${baseUrl}/api/extract-boq`, {
    method: "POST",
    body: form,
  });
  const extractData = await extractRes.json();

  if (!extractData.boqItems || extractData.boqItems.length === 0) {
    return {
      summary: `Extraction returned 0 BOQ items.\n\n${extractData.warning || "No further detail available."}`,
      full: extractData,
    };
  }

  const analysisRes = await fetch(`${baseUrl}/api/check-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      boqItems: extractData.boqItems,
      contractValue: null, // Telegram flow has no form input for this —
      // see note below on this limitation.
      targetMargin: 15,
      clauseTerms: extractData.clauseTerms || null,
    }),
  });
  const analysisData = await analysisRes.json();

  const riskLine =
    analysisData.riskScore === null
      ? "Risk score: N/A (insufficient evidence coverage)"
      : `Risk score: ${analysisData.riskScore}/100`;

  const summary =
    `*BidSwift Audit — ${fileName}*\n\n` +
    `${extractData.boqItems.length} BOQ item(s) extracted\n` +
    `${riskLine}\n` +
    `Arithmetic exposure: ${analysisData.arithmeticExposure ?? "N/A"} ETB\n\n` +
    `Top signals:\n` +
    (analysisData.topRiskSignals || [])
      .slice(0, 3)
      .map((s) => `• ${s}`)
      .join("\n");

  return { summary, full: analysisData };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true }); // Telegram just needs 200 on GET pings.
  }

  const update = req.body;
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

  if (message.text === "/start") {
    await sendMessage(chatId, "BidSwift AI — send me a BOQ/tender PDF or XLSX and I'll run it through the audit pipeline.");
    return res.status(200).json({ ok: true });
  }

  const doc = message.document;
  if (!doc) {
    await sendMessage(chatId, "Send a PDF or XLSX file to audit.");
    return res.status(200).json({ ok: true });
  }

  try {
    await sendMessage(chatId, `Received ${doc.file_name} — running audit, this can take 20-30s...`);

    const { buffer, fileName } = await getFileBuffer(doc.file_id);

    // baseUrl must point at THIS SAME deployment so extract-boq/check-analysis
    // resolve correctly regardless of preview vs. production URL.
    const baseUrl = `https://${req.headers.host}`;
    const result = await runAudit(buffer, fileName, baseUrl);

    await sendMessage(chatId, result.summary);
  } catch (err) {
    console.error("[telegram-webhook] Audit failed:", err.message, err.stack);
    await sendMessage(chatId, `Audit failed: ${err.message}`);
  }

  return res.status(200).json({ ok: true });
}