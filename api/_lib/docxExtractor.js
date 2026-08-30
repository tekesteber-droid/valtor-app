// api/lib/docxExtractor.js
//
// Server-side .docx → raw text extraction. Tender documents are commonly
// distributed as Word files (Special Conditions of Contract, sometimes the
// BOQ itself). Today these silently fall through to "add rows manually" —
// this closes that gap using mammoth, which reads the DOCX XML directly
// (no LibreOffice/Word binary dependency, so it's serverless-safe).
//
// Tables in the DOCX are rendered as pipe-delimited rows so the same
// downstream LLM extraction prompt (boqExtractor.js) — which already
// understands pipe-separated tables from the xlsx path — can parse them
// without a separate code path.

export async function extractDocxText(buffer) {
  const mammoth = await import("mammoth");

  // extractRawText loses table structure; convertToHtml keeps <table> tags,
  // which we can walk to preserve row/column structure — critical for BOQ
  // tables where column position IS the meaning (qty vs. rate vs. total).
  const { value: html } = await mammoth.convertToHtml({ buffer });

  return htmlTablesAndTextToPlainText(html);
}

// Minimal, dependency-free HTML → text walker. We don't need a full DOM
// parser here — mammoth's output is simple, well-formed HTML (p, table,
// tr, td, h1-h6, ul/li) and we only need to (a) preserve table rows as
// pipe-delimited lines and (b) keep paragraph text on its own lines.
function htmlTablesAndTextToPlainText(html) {
  let working = html;

  // Convert each <tr>...</tr> into one pipe-delimited line.
  working = working.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, rowHtml) => {
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      stripTags(m[1]).trim()
    );
    return cells.join(" | ") + "\n";
  });

  // Paragraph and heading tags become line breaks.
  working = working.replace(/<\/(p|h[1-6]|li)>/gi, "\n");
  working = working.replace(/<br\s*\/?>/gi, "\n");

  const text = stripTags(working);

  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
