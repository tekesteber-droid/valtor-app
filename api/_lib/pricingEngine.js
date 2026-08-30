// api/lib/pricingEngine.js
//
// Deterministic, structured pricing lookup against the official Addis Ababa
// Construction Works Bureau price book. This is NOT retrieval-augmented
// generation and it is NOT vector search — it is a plain in-memory index
// over a CSV, with rule-based matching and confidence scoring. The CSV is
// the source of truth: nothing here ever invents a price.
//
// Usage:
//   import { getPricingEngine } from "./pricingEngine.js";
//   const engine = await getPricingEngine();
//   const result = engine.match("20cm HCB wall", { unit: "m²" });

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { tokenize, tokenSimilarity, normalizeText } from "./textNormalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "data", "pricing_master.json");
const METADATA_PATH = path.join(__dirname, "..", "data", "pricing_metadata.json");

// Confidence thresholds for the token-similarity fallback match.
const MEDIUM_THRESHOLD = 0.55;
const LOW_THRESHOLD = 0.3;

class PricingEngine {
  constructor(records, metadata) {
    this.records = records.map((r) => ({
      itemNo: r.item_no || "",
      description: r.description || r.description_original || "",
      unit: r.unit || "",
      price: Number(String(r.price || '').replace(/,/g, '')) || 0,
      currency: r.currency || "ETB",
      priceType: r.price_type || "Direct Cost",
      category: r.category || "",
      subcategory: r.subcategory || "",
      section: r.section || "",
      remarks: r.remarks || "",
    }));
    this.metadata = metadata;

    // Indexes for O(1) exact-match lookups.
    this.byItemNo = new Map();
    this.byNormalizedDescription = new Map();
    for (const rec of this.records) {
      if (rec.itemNo) this.byItemNo.set(rec.itemNo.toLowerCase(), rec);
      const norm = normalizeText(rec.description);
      if (norm) {
        if (!this.byNormalizedDescription.has(norm)) {
          this.byNormalizedDescription.set(norm, rec);
        }
      }
    }
  }

  get referenceLabel() {
    if (!this.metadata) return "Official Pricing Database";
    return `${this.metadata.year} ${this.metadata.quarter} Construction Works ${this.metadata.price_type} Schedule`;
  }

  // Attempts to match a free-text BOQ description (optionally an explicit
  // item code) against the price book. Never returns an invented price —
  // if confidence is too low, referencePrice is null and match_type is
  // "No Match".
  match(description, { itemCode, unit } = {}) {
    // 1. Exact item-code match.
    if (itemCode) {
      const hit = this.byItemNo.get(String(itemCode).trim().toLowerCase());
      if (hit) {
        return this._toResult(hit, "High", "Exact (Item Code)", 1);
      }
    }

    // 2. Exact normalized-description match.
    const normalizedQuery = normalizeText(description);
    const exactHit = this.byNormalizedDescription.get(normalizedQuery);
    if (exactHit) {
      return this._toResult(exactHit, "High", "Exact (Description)", 1);
    }

    // 3. Token-similarity fallback (keyword / synonym / fuzzy match).
    let best = null;
    let bestScore = 0;
    for (const rec of this.records) {
      // Small boost when the unit matches, since it disambiguates items
      // that share vocabulary but measure different things (m² vs m³).
      let score = tokenSimilarity(description, rec.description);
      if (unit && rec.unit && unit.trim() === rec.unit.trim()) score += 0.05;
      if (score > bestScore) { bestScore = score; best = rec; }
    }

    if (best && bestScore >= MEDIUM_THRESHOLD) {
      return this._toResult(best, "Medium", "Keyword/Synonym Match", bestScore);
    }
    if (best && bestScore >= LOW_THRESHOLD) {
      return this._toResult(best, "Low", "Weak Similarity", bestScore);
    }

    // 4. No reliable match — unknown must remain unknown.
    return {
      matched: false,
      confidence: "Unknown",
      matchType: "No Match",
      matchScore: bestScore,
      referencePrice: null,
      referenceUnit: null,
      referenceDescription: null,
      referenceItemNo: null,
      referenceCategory: null,
      source: this.referenceLabel,
    };
  }

  _toResult(rec, confidence, matchType, score) {
    return {
      matched: true,
      confidence,
      matchType,
      matchScore: Number(score.toFixed(3)),
      referencePrice: rec.price,
      referenceUnit: rec.unit,
      referenceDescription: rec.description,
      referenceItemNo: rec.itemNo,
      referenceCategory: rec.category,
      source: this.referenceLabel,
    };
  }
}

let enginePromise = null;

// Singleton loader — the dataset is parsed once per server instance (cold
// start) and cached in memory for the lifetime of the process. Replacing
// pricing_master.json / pricing_metadata.json with a newer quarter's export
// is the only change required to refresh the dataset.
export function getPricingEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [dataText, metaText] = await Promise.all([
        readFile(DATA_PATH, "utf-8"),
        readFile(METADATA_PATH, "utf-8").catch(() => "{}"),
      ]);
      const records = JSON.parse(dataText);
      const metadata = JSON.parse(metaText);
      return new PricingEngine(records, metadata);
    })();
  }
  return enginePromise;
}

// Exposed for tests / tooling that want a fresh, uncached instance.
export function _buildEngineForTest(records, metadata) {
  return new PricingEngine(records, metadata);
}
