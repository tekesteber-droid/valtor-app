// api/lib/textNormalize.js
// Pure text-normalization helpers used by the deterministic pricing engine.
// No external deps — keeps the pricing service cheap to load at cold start.

const STOPWORDS = new Set([
  "the", "of", "a", "an", "in", "on", "for", "with", "and", "or", "to",
  "at", "by", "including", "incl", "etc", "works", "work",
]);

// Normalizes free text for comparison:
// - lowercase
// - unify unit shorthand spacing (20 cm -> 20cm)
// - strip punctuation except size tokens like 20cm, 1:2:4, m2/m3
// - collapse whitespace
export function normalizeText(input) {
  if (!input) return "";
  let s = String(input).toLowerCase();
  s = s.replace(/[²³]/g, (m) => (m === "²" ? "2" : "3"));
  s = s.replace(/(\d+)\s+(cm|mm|m|kg|lt|l)\b/g, "$1$2"); // "20 cm" -> "20cm"
  s = s.replace(/[^a-z0-9:.\s]/g, " "); // strip punctuation, keep ratios like 1:2:4
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Very light singularizer — good enough for construction-item nouns
// ("blocks" -> "block", "walls" -> "wall"); avoids over-stemming short words.
function singularize(token) {
  if (token.length > 3 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

// Light verb stemming so "demolish" and "demolishing" are recognized as the
// same concept. Deliberately conservative (only strips "-ing" on longer
// words) to avoid collapsing legitimate nouns like "roofing"/"flooring"
// into forms that no longer appear anywhere else in the price book.
function stem(token) {
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  return token;
}

export function tokenize(input) {
  const normalized = normalizeText(input);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter(Boolean)
    .map(singularize)
    .map(stem)
    .filter((t) => !STOPWORDS.has(t));
}

// Jaccard similarity over token sets, with a bonus for shared numeric/size
// tokens (e.g. "20cm", "1:2:4") since those are highly discriminative for
// construction line items (wall thickness, concrete mix ratio, pipe size).
export function tokenSimilarity(a, b) {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  let sizeBonusMatches = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersection += 1;
      if (/\d/.test(t)) sizeBonusMatches += 1;
    }
  }
  const union = tokensA.size + tokensB.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;
  const bonus = Math.min(0.15, sizeBonusMatches * 0.05);
  return Math.min(1, jaccard + bonus);
}
