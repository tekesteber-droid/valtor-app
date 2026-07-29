# BidSwift AI — Deterministic Pricing Engine Integration

## 1. What actually changed vs. what the original prompt assumed

Before touching anything I read through the whole repo. Two things matter for how this was implemented:

- **There was no existing BOQ extraction pipeline.** `audit.tsx` uploaded files only as
  filenames (`files.map(f => f.name).join(", ")`) — file *contents* were never sent to the
  backend, and `market_variance` was 100% LLM-invented (the old system prompt literally said
  *"market_variance MUST contain 4-6 specific line items with actual ETB rates"*). There was
  nothing to "replace LLM pricing with grounded pricing" for, in the strict sense — the grounding
  input (real BOQ line items) didn't exist yet either.
- So this implementation adds **two things**, not one: (a) the deterministic pricing engine you
  asked for, and (b) a minimal, honest way to get structured BOQ line items into that engine
  (manual entry table + best-effort `.xlsx` auto-parse). Full PDF/DOCX BOQ extraction (OCR/layout
  parsing) is a separate, larger feature and is out of scope here — flagged below under Future Work.

## 2. Architecture

```
BOQ line items (manual entry or .xlsx auto-parse, client-side)
        │
        ▼
POST /api/check-analysis  { systemPrompt, userPrompt, boqItems }
        │
        ▼
getPricingEngine()  ── singleton, loads api/data/pricing_master.csv once per
        │               server instance, builds in-memory indexes
        ▼
buildPricingEvidence(engine, boqItems)
        │  exact item-code match → exact description match → token-similarity
        │  fallback → "Unknown / Reference unavailable" if nothing clears the
        │  low-confidence floor. NEVER fabricates a price.
        ▼
Evidence formatted into the DeepSeek prompt as read-only "verified pricing
evidence" — the model is explicitly told not to output market_variance
        │
        ▼
DeepSeek response parsed → market_variance is OVERWRITTEN with the
deterministic evidence regardless of what the model returned
        │
        ▼
Response payload: { ...analysis, market_variance, pricing_reference, risk_score }
```

The key invariant: **numbers in `market_variance` never come from the LLM.** The LLM only
ever sees pricing data after it's been computed, and its own `market_variance` output (if any)
is discarded server-side.

## 3. New files

| File | Purpose |
|---|---|
| `api/data/pricing_master.csv` | The price book. Swap this file to update the dataset. |
| `api/data/pricing_metadata.json` | Source/quarter/disclaimer metadata. |
| `api/lib/textNormalize.js` | Normalization, light stemming, Jaccard token similarity. |
| `api/lib/pricingEngine.js` | CSV loader (singleton/cached), indexing, `match()`. |
| `api/lib/pricingEvidence.js` | Turns BOQ items → structured `market_variance` evidence + builds the disclaimer/reference block. |
| `scripts/test-pricing-engine.mjs` | Exact/fuzzy/no-match/perf tests. Run with `node scripts/test-pricing-engine.mjs`. |

## 4. Modified files

| File | Change |
|---|---|
| `api/check-analysis.js` | Loads the pricing engine, computes evidence from `boqItems`, grounds the DeepSeek prompt, overwrites `market_variance` with deterministic evidence, attaches `pricing_reference`. |
| `src/routes/_authenticated/audit.tsx` | Adds a manual BOQ line-item table + best-effort `.xlsx` auto-extraction (via the `xlsx` package already in `package.json`); sends `boqItems` to the API; system prompt no longer asks the LLM to invent pricing; Market Calibration section now shows confidence badges, match type, and the Pricing Reference Notice disclaimer; "Reference unavailable" renders explicitly instead of a fabricated number. |

`src/types/audit.ts` was **not** modified — it doesn't match what `audit.tsx` actually uses today
(it's missing `market_variance`/`contractual_traps`/etc. entirely), so it appears to already be
stale/unused. Flagging rather than fixing, since resolving that mismatch wasn't part of this task
and touching it risks an unrelated regression.

## 5. Response schema (actual shape returned by `/api/check-analysis`)

```json
{
  "market_variance": [
    {
      "item": "Demolishing the lamera wall",
      "item_no": "1.1.1",
      "category": "Demolition",
      "unit": "m²",
      "tender_price": 200,
      "reference_price": 172.41,
      "our_rate": 200,
      "market_rate": 172.41,
      "variance_percent": 16.0,
      "variance_pct": 16.0,
      "confidence": "High",
      "match_type": "Exact (Description)",
      "match_score": 1,
      "reference": "2018 E.C. (Ethiopian Calendar) 4th Quarter Construction Works Direct Cost Schedule",
      "recommendation": "Significantly above reference — investigate for overpricing."
    }
  ],
  "pricing_reference": {
    "source_document": "2018 4th Quarter (Direct Cost Only) Construction Works Price Book",
    "issuer": "Addis Ababa City Administration Design And Construction Works Bureau",
    "publication_period": "2018 E.C. (Ethiopian Calendar) 4th Quarter",
    "price_type": "Direct Cost",
    "coverage": "Addis Ababa",
    "disclaimer": "Market comparisons in this report are based on the official ... schedule ..."
  }
}
```

`our_rate`/`market_rate`/`variance_pct` are kept as aliases alongside the new field names so the
existing `calculateRiskScore()` logic in `check-analysis.js` and any other consumer of the old
shape keeps working unchanged.

## 6. Confidence levels

| Level | Meaning |
|---|---|
| High | Exact item-code match, or exact normalized-description match |
| Medium | Token-similarity score ≥ 0.55 (strong keyword/synonym overlap) |
| Low | Token-similarity score 0.30–0.55 (weak similarity — shown but flagged) |
| Unknown | Below 0.30 — `reference_price` is `null`, UI renders "Reference unavailable" |

Thresholds live at the top of `api/lib/pricingEngine.js` (`MEDIUM_THRESHOLD`, `LOW_THRESHOLD`) if
they need tuning against a larger, real dataset — the current 322-row sample is small enough that
these were tuned by hand against the test cases in `scripts/test-pricing-engine.mjs`, not against
a large labeled set.

## 7. Migration notes

1. Drop `api/lib/`, `api/data/`, and `scripts/test-pricing-engine.mjs` into the repo.
2. Replace `api/check-analysis.js` with the updated version.
3. Replace `src/routes/_authenticated/audit.tsx` with the updated version.
4. No new npm dependencies were introduced — the CSV parser is hand-rolled (small file, avoids a
   dependency), and BOQ `.xlsx` extraction reuses the `xlsx` package already in `package.json`.
5. No env vars, migrations, or Supabase schema changes required. `pricing_reference` is stored as
   part of `analysis` in `audits.analysis` (JSON column) the same way `market_variance` already was.
6. To refresh the dataset for a new quarter: replace `api/data/pricing_master.csv` and
   `api/data/pricing_metadata.json` with the new export using the same column names. No code
   changes needed unless the schema itself changes.

## 8. Testing strategy

- **Exact match** — item-code lookup, exact normalized-description lookup.
- **Fuzzy/keyword match** — plural/singular, verb-form stemming ("demolish" vs "demolishing"),
  case-insensitivity, word-order independence via token Jaccard similarity.
- **No-match** — unrelated text must return `confidence: "Unknown"` and `referencePrice: null`,
  never a guessed number.
- **Evidence-builder invariants** — unmatched BOQ items produce `reference_price: null`; matched
  items compute `variance_percent` correctly from `(tender - reference) / reference`.
- **Performance** — 500 repeated lookups against the in-memory index complete in well under a
  second, confirming the CSV is parsed once (at cold start) and not per-request.

Run: `node scripts/test-pricing-engine.mjs` (no build step or npm install required — it only
imports the new ESM modules directly).

Not covered by the automated tests (would need a real deployment/browser to verify): the `.xlsx`
BOQ auto-extraction column-detection heuristics, and the end-to-end UI rendering of the disclaimer
and confidence badges — those were verified by code review and by balancing the modified `.tsx`
file's syntax, not by running the Vite dev server (no network access in this environment to
install `node_modules`).

## 9. Future work (explicitly out of scope here)

- Real BOQ extraction from PDF/DOCX tender documents (would need a text/layout extraction library
  server-side — nothing in the current stack does this yet).
- Synonym/keyword columns in the CSV itself (the uploaded `pricing_master.csv` doesn't have
  `keywords`/`synonyms` columns despite the metadata schema mentioning them) — if a future export
  includes them, `pricingEngine.js` should check those before falling back to token similarity.
- Multiple pricing sources / quarters loaded simultaneously (current engine is a single-dataset
  singleton; swapping in versioned datasets by year would need a small refactor to key the cache
  by dataset id).
