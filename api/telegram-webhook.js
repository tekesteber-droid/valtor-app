// api/_lib/pdfExtractor.js
//
// Server-side PDF → raw text extraction, with a scanned-document fallback.
//
// Strategy (cheapest/fastest first):
//   1. pdf-parse — works for text-native PDFs (the majority of tender docs
//      produced from Word/Excel/InDesign). Free, local, no API call.
//   2. If pdf-parse yields near-zero text (a scanned/image-only PDF), fall
//      back to rasterizing each page with pdfjs-dist + @napi-rs/canvas and
//      running Gemini vision OCR on the page images. This is slower and
//      costs an API call per page, so it is a fallback, not the default.
//
// This module NEVER invents document content — it either returns text that
// came from the PDF's embedded text layer, or text that came back from
// Gemini's vision OCR of the actual rendered page. If both fail, it returns
// an empty string and a clear status the caller can surface to the user.

import { readFile } from "fs/promises";

// Below this many extracted characters per page (on average), we treat the
// PDF as scanned/image-only rather than text-native. Real tender PDFs with
// actual embedded text comfortably clear this threshold; a scanned page run
// through pdf-parse typically yields stray OCR artifacts from an embedded
// low-quality text layer (or nothing at all) — well under this bar.
const MIN_CHARS_PER_PAGE = 40;

// Hard cap on pages sent to Gemini vision OCR per document. Tender PDFs can
// run 50-100+ pages including boilerplate (SPD terms, drawings, forms) that
// don't contain BOQ/clause data — but we don't know which pages matter until
// we've looked. Capping keeps worst-case latency/cost bounded on the free
// tier; raise this once a paid Gemini tier is in place.
const MAX_OCR_PAGES = 25;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-1.5-flash";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ═══════════════════════════════════════════════════════════════════
   Stage 1 — text-native extraction via pdf-parse
   ═══════════════════════════════════════════════════════════════════ */

async function extractWithPdfParse(buffer) {
  // pdf-parse v2 exports a PDFParse class rather than a bare function.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy?.();

  const text = result?.text || "";
  const numPages = result?.total ?? result?.numpages ?? result?.numPages ?? 1;
  return { text, numPages };
}

/* ═══════════════════════════════════════════════════════════════════
   Stage 2 — scanned-PDF fallback: rasterize pages, OCR via Gemini vision
   ═══════════════════════════════════════════════════════════════════ */

async function renderPageToPng(pdfDocument, pageNumber, scale = 2.0) {
  // pdfjs-dist's legacy Node build works without a browser DOM, but still
  // needs a canvas implementation — @napi-rs/canvas is the serverless-safe
  // choice (prebuilt binary, no native compilation step at deploy time,
  // unlike node-canvas which needs Cairo installed on the build image).
  const { createCanvas } = await import("@napi-rs/canvas");

  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toBuffer("image/png");
}

async function callGeminiVisionOcr(pngBuffer, pageLabel) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Transcribe ALL visible text on this scanned document page exactly as it appears, " +
              "including every row of any table (preserve column order left-to-right). This is a " +
              "page from an Ethiopian construction tender document — it may contain a Bill of " +
              "Quantities table, contract clauses, or general tender text. Do not summarize, do not " +
              "translate, do not omit rows for brevity. If the page is blank or unreadable, return " +
              "an empty string. Return plain text only — no markdown formatting, no commentary.",
          },
          { inline_data: { mime_type: "image/png", data: pngBuffer.toString("base64") } },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 4000 },
  };

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    const status = res.status;
    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt === maxRetries) {
      const txt = await res.text();
      console.error(`[pdfExtractor] Gemini OCR failed on ${pageLabel} (${status}): ${txt.slice(0, 300)}`);
      return ""; // Don't fail the whole document over one bad page.
    }

    const wait = Math.min(1000 * 2 ** attempt, 15000);
    await sleep(wait);
  }
  return "";
}

async function extractWithOcrFallback(buffer) {
  if (!GEMINI_API_KEY) {
    return {
      text: "",
      numPages: 0,
      ocrUsed: false,
      warning: "Document appears to be scanned/image-based, and no GEMINI_API_KEY is configured for OCR fallback.",
    };
  }

  // pdfjs-dist's legacy build is the one meant for Node (no DOM APIs).
  // It does a strict instanceof/type check on `data` — a Node Buffer,
  // despite being a Uint8Array subclass at runtime, is rejected with
  // "Please provide binary data as Uint8Array, rather than Buffer."
  // Wrapping in a plain Uint8Array view (no copy — same underlying memory)
  // satisfies the check without any real cost.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const uint8Data = buffer instanceof Uint8Array && buffer.constructor === Uint8Array
    ? buffer
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Data });
  const pdfDocument = await loadingTask.promise;

  const totalPages = pdfDocument.numPages;
  const pagesToProcess = Math.min(totalPages, MAX_OCR_PAGES);
  const truncated = totalPages > MAX_OCR_PAGES;

  const pageTexts = [];
  for (let i = 1; i <= pagesToProcess; i++) {
    const png = await renderPageToPng(pdfDocument, i);
    const pageText = await callGeminiVisionOcr(png, `page ${i}/${totalPages}`);
    if (pageText.trim()) pageTexts.push(`--- Page ${i} ---\n${pageText.trim()}`);
  }

  return {
    text: pageTexts.join("\n\n"),
    numPages: totalPages,
    ocrUsed: true,
    warning: truncated
      ? `Document has ${totalPages} pages; only the first ${MAX_OCR_PAGES} were OCR'd. Re-upload a trimmed extract if key content is beyond page ${MAX_OCR_PAGES}.`
      : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Public entry point
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Extracts raw text from a PDF buffer, using OCR only if the text layer is
 * absent or negligible (i.e. the PDF is scanned/image-based).
 *
 * @param {Buffer} buffer — raw PDF file bytes
 * @returns {Promise<{ text: string, method: "text-layer"|"ocr"|"none", numPages: number, warning: string|null }>}
 */
export async function extractPdfText(buffer) {
  let textLayerResult;
  try {
    textLayerResult = await extractWithPdfParse(buffer);
  } catch (err) {
    // This error was previously swallowed silently — the caller only ever
    // saw the downstream OCR fallback's failure, never the real reason
    // pdf-parse itself failed on a text-native PDF in production. Surface
    // it so a genuine pdf-parse regression isn't masked by an OCR error
    // for a document that never should have needed OCR in the first place.
    console.error("[pdfExtractor] pdf-parse failed:", err.message, err.stack);
    textLayerResult = { text: "", numPages: 0 };
  }

  const { text, numPages } = textLayerResult;
  const avgCharsPerPage = numPages > 0 ? text.length / numPages : text.length;

  if (avgCharsPerPage >= MIN_CHARS_PER_PAGE) {
    return { text, method: "text-layer", numPages, warning: null };
  }

  // Text layer is empty or negligible — likely a scanned document. Fall
  // back to OCR rather than silently returning near-nothing.
  console.log(`[pdfExtractor] Text layer yielded ${Math.round(avgCharsPerPage)} chars/page — falling back to OCR`);
  try {
    const ocrResult = await extractWithOcrFallback(buffer);
    if (ocrResult.text.trim()) {
      return { text: ocrResult.text, method: "ocr", numPages: ocrResult.numPages, warning: ocrResult.warning };
    }
    return {
      text: "",
      method: "none",
      numPages,
      warning: ocrResult.warning || "Could not extract readable text from this PDF, even via OCR.",
    };
  } catch (err) {
    console.error("[pdfExtractor] OCR fallback failed:", err.message, err.stack);
    return {
      text,
      method: "none",
      numPages,
      warning: `This looks like a scanned PDF and OCR extraction failed (${err.message}). Add BOQ line items manually below.`,
    };
  }
}

// Exposed for local/manual testing (scripts/test-pdf-extraction.mjs).
export const __internal = { extractWithPdfParse, extractWithOcrFallback };