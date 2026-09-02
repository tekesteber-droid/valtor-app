// api/_lib/reportGenerator.js
//
// Renders the audit analysis into a McKinsey-grade PDF report using
// headless Chromium. Uses puppeteer-core + @sparticuz/chromium — NOT the
// full `puppeteer` package — because full puppeteer bundles its own ~300MB
// Chromium download, which would blow past Vercel's function size limit
// the same way the pdfjs-dist worker file did earlier in this project (see
// SESSION_HANDOFF: "pdfjs-dist worker file missing from bundle"). 
// @sparticuz/chromium ships a Vercel/AWS-Lambda-compiled binary sized for
// serverless specifically.
//
// This module is intentionally the ONLY place that imports Chromium — if
// PDF generation ever needs to move to a different renderer, this is the
// single file to change.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { buildReportHtml } from "./reportTemplate.js";

let browserPromise = null;

// Reuse the browser instance across warm invocations of the same
// serverless function — cold start is the expensive part (Chromium boot),
// not repeated page renders. If the function container is reused by
// Vercel for a subsequent request, this avoids paying the cold-start cost
// twice. If the browser has crashed/disconnected, get a fresh one.
async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.connected) return existing;
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  return browserPromise;
}

/**
 * Generate a PDF audit report buffer from an analysis payload.
 *
 * @param {object} analysis - The full analysis object as returned by
 *   /api/check-analysis (risk_score, recommendation, executive_summary,
 *   arithmetic_errors, contractual_traps, market_variance, etc.)
 * @param {object} meta - { fileName, generatedAt } — display-only metadata,
 *   not part of the analysis schema itself.
 * @returns {Promise<Buffer>} PDF file bytes.
 */
async function generateAuditPdf(analysis, meta = {}) {
  const html = buildReportHtml(analysis, {
    fileName: meta.fileName || null,
    generatedAt: meta.generatedAt || new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return pdfBuffer;
  } finally {
    // Close the page, not the browser — browser is reused across warm
    // invocations (see getBrowser above).
    await page.close();
  }
}

export { generateAuditPdf };
