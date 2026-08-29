// api/extract-boq.js
//
// Server-side document ingestion. Accepts a single uploaded file
// (multipart/form-data, field name "file") and returns:
//   - rawText: the actual extracted text (never a filename, never invented)
//   - boqItems: structured BOQ line items (LLM extraction w/ regex fallback,
//     or deterministic parsing for xlsx)
//   - clauses: key contract terms (LLM extraction)
//   - meta: extraction method, page count, warnings — surfaced to the user
//     so a scanned/unparseable PDF is reported honestly instead of silently
//     producing an empty audit.
//
// This endpoint is the fix for the fabrication bug: before this existed,
// PDF/DOCX uploads never reached the server, and the LLM analysis prompt
// was given only the filename. Every PDF/DOCX audit must now go through
// this endpoint before /api/check-analysis is called.

import { createClient } from "@supabase/supabase-js";
import busboy from "busboy";
import { extractPdfText } from "./lib/pdfExtractor.js";
import { extractDocxText } from "./lib/docxExtractor.js";
import { extractBoqFromXlsxBuffer, flattenXlsxToText } from "./lib/xlsxExtractor.js";
import { extractBoqWithLLM, extractClausesWithLLM } from "./lib/boqExtractor.js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel serverless functions need raw body access for multipart parsing —
// the default body parser would consume the stream before busboy sees it.
export const config = {
  api: { bodyParser: false },
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — generous for a tender PDF, cheap to enforce

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });

    let fileBuffer = null;
    let fileName = "";
    let mimeType = "";
    let truncated = false;

    bb.on("file", (_name, stream, info) => {
      fileName = info.filename || "";
      mimeType = info.mimeType || "";
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("limit", () => { truncated = true; });
      stream.on("close", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("error", reject);
    bb.on("close", () => {
      if (truncated) return reject(new Error(`File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit.`));
      if (!fileBuffer) return reject(new Error("No file was uploaded."));
      resolve({ fileBuffer, fileName, mimeType });
    });

    req.pipe(bb);
  });
}

function detectFileType(fileName, mimeType) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "docx" || mimeType.includes("wordprocessingml")) return "docx";
  if (["xlsx", "xls"].includes(ext) || mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel") return "xlsx";
  return "unsupported";
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
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
  }

  let fileBuffer, fileName, mimeType;
  try {
    ({ fileBuffer, fileName, mimeType } = await parseMultipart(req));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const fileType = detectFileType(fileName, mimeType);

  try {
    // ─── xlsx: deterministic first, LLM fallback for non-tabular sheets ──
    if (fileType === "xlsx") {
      const { items, sheetsWithData, warnings, skippedNonItemRows } = extractBoqFromXlsxBuffer(fileBuffer);

      if (items.length > 0) {
        // Clean tabular BOQ (like a standard "Description/Unit/Qty/Rate"
        // template) — deterministic parsing found real rows. No LLM call
        // needed; this path is free and fast.
        return res.status(200).json({
          fileName,
          fileType,
          rawText: null,
          boqItems: items,
          clauses: null,
          meta: {
            method: "deterministic-xlsx",
            sheetsWithData,
            warnings,
            skippedNonItemRows,
          },
        });
      }

      // Deterministic pass found nothing — this is common with real-world
      // Ethiopian BOQs, which are often laid out as narrative item
      // descriptions in their own rows with quantities/rates in nearby
      // rows or columns, rather than one clean header row naming every
      // field (confirmed directly against a real 18-sheet tender BOQ:
      // header keywords like "ITEM"/"SIZE"/"M3" don't match the
      // description/unit/qty/rate synonym list, and item numbers like
      // "1.01" live inside description text rather than their own
      // column). Rather than give up, flatten every sheet to plain text
      // and let the LLM extractor — the same one used for PDF/DOCX BOQs —
      // find items in it. This costs one LLM call instead of being free,
      // but only runs when the free deterministic path genuinely found
      // nothing.
      const flattenedText = flattenXlsxToText(fileBuffer);
      if (!flattenedText || !flattenedText.trim()) {
        return res.status(200).json({
          fileName,
          fileType,
          rawText: null,
          boqItems: [],
          clauses: null,
          meta: {
            method: "deterministic-xlsx-empty",
            sheetsWithData,
            warnings: [...warnings, "No cell data found in any sheet."],
            skippedNonItemRows,
          },
        });
      }

      const llmItems = await extractBoqWithLLM(flattenedText);

      return res.status(200).json({
        fileName,
        fileType,
        // The flattened sheet text is returned as rawText so
        // check-analysis.js can also ground clause/scope findings in it,
        // same as a PDF/DOCX document would provide.
        rawText: flattenedText,
        boqItems: llmItems,
        clauses: null, // xlsx BOQs don't carry contract clauses — no clause extraction attempted
        meta: {
          method: llmItems.length > 0 ? "llm-xlsx-fallback" : "llm-xlsx-fallback-empty",
          sheetsWithData,
          warnings: [
            ...warnings,
            llmItems.length > 0
              ? `No standard BOQ header row was found — ${llmItems.length} item(s) extracted by AI from the raw sheet contents instead. Review carefully.`
              : "No BOQ table detected by either standard parsing or AI extraction. Add line items manually below.",
          ],
          skippedNonItemRows,
        },
      });
    }

    // ─── pdf / docx: extract real text first, LLM structures it second ──
    let extraction;
    if (fileType === "pdf") {
      extraction = await extractPdfText(fileBuffer);
    } else if (fileType === "docx") {
      const text = await extractDocxText(fileBuffer);
      extraction = { text, method: "docx-mammoth", numPages: null, warning: null };
    } else {
      return res.status(400).json({
        error: `Unsupported file type "${fileName}". Upload a PDF, DOCX, or XLSX file.`,
      });
    }

    const rawText = extraction.text || "";

    if (!rawText.trim()) {
      // Honest failure — no filename-only fallback, no LLM call, nothing invented.
      return res.status(200).json({
        fileName,
        fileType,
        rawText: "",
        boqItems: [],
        clauses: null,
        meta: {
          method: extraction.method,
          numPages: extraction.numPages,
          warnings: [extraction.warning || "No extractable text found in this document. Add BOQ line items manually below."],
        },
      });
    }

    // Run BOQ and clause extraction in parallel — independent LLM calls
    // over the same source text, both grounded in what was actually
    // extracted above, never in the filename.
    const [boqItems, clauses] = await Promise.all([
      extractBoqWithLLM(rawText),
      extractClausesWithLLM(rawText),
    ]);

    return res.status(200).json({
      fileName,
      fileType,
      rawText,
      boqItems,
      clauses,
      meta: {
        method: extraction.method,
        numPages: extraction.numPages,
        warnings: extraction.warning ? [extraction.warning] : [],
      },
    });
  } catch (error) {
    console.error("[extract-boq] Extraction failed:", error);
    return res.status(500).json({
      error: "Failed to extract document content.",
      detail: error.message,
    });
  }
}