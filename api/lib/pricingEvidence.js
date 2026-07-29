// api/lib/pricingEvidence.js
//
// Converts BOQ line items into the structured pricing-comparison evidence
// consumed by both the LLM (for narrative explanation) and the frontend
// (for the Market Rate Calibration table). All numbers here come from the
// pricing engine or the user's own BOQ input — never from the LLM.

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function ruleBasedRecommendation(confidence, variancePercent) {
  if (confidence === "Unknown") {
    return "Reference unavailable — no reliable match in the official price book. Validate with a current supplier quotation.";
  }
  if (variancePercent > 15) return "Significantly above reference — investigate for overpricing.";
  if (variancePercent > 5) return "Above reference — review recommended.";
  if (variancePercent < -15) return "Significantly below reference — verify quality and scope assumptions.";
  if (variancePercent < -5) return "Below reference — confirm scope is fully inclusive.";
  return "Within expected range.";
}

// boqItems: [{ description, unit, qty, tender_price, item_no?, category? }]
export function buildPricingEvidence(engine, boqItems) {
  return (boqItems || [])
    .filter((item) => item && item.description)
    .map((item) => {
      const match = engine.match(item.description, {
        itemCode: item.item_no,
        unit: item.unit,
      });

      const tenderPrice = Number(item.tender_price) || null;
      let variancePercent = null;
      if (match.matched && tenderPrice != null && match.referencePrice) {
        variancePercent = round(
          ((tenderPrice - match.referencePrice) / match.referencePrice) * 100
        );
      }

      return {
        item: item.description,
        item_no: item.item_no || null,
        category: match.referenceCategory || item.category || "Uncategorized",
        unit: item.unit || match.referenceUnit || "",
        tender_price: tenderPrice,
        reference_price: match.matched ? match.referencePrice : null,
        // legacy field names kept for the existing UI (our_rate/market_rate)
        our_rate: tenderPrice,
        market_rate: match.matched ? match.referencePrice : null,
        variance_percent: variancePercent,
        variance_pct: variancePercent, // legacy alias
        confidence: match.confidence,
        match_type: match.matchType,
        match_score: match.matchScore,
        matched_reference_description: match.referenceDescription,
        matched_reference_item_no: match.referenceItemNo,
        reference: match.source,
        source: match.source,
        recommendation: ruleBasedRecommendation(match.confidence, variancePercent ?? 0),
        note: match.matched
          ? `Matched "${match.referenceDescription}" (${match.matchType}, item ${match.referenceItemNo || "n/a"})`
          : "Reference unavailable",
      };
    });
}

export function buildPricingReference(engine) {
  const meta = engine.metadata || {};
  return {
    source_document: meta.title || "Construction Works Price Book",
    issuer: meta.issuer || null,
    publication_period: [meta.year, meta.quarter].filter(Boolean).join(" "),
    publication_date: meta.publication_date || null,
    price_type: meta.price_type || "Direct Cost",
    coverage: "Addis Ababa",
    currency: meta.currency || "ETB",
    overhead_percentage: meta.overhead_percentage ?? null,
    profit_percentage: meta.profit_percentage ?? null,
    disclaimer:
      "Market comparisons in this report are based on the official " +
      `${meta.year || ""} ${meta.quarter || ""} Construction Works ${meta.price_type || "Direct Cost"} schedule ` +
      `published by the ${meta.issuer || "Addis Ababa City Administration Design and Construction Works Bureau"}. ` +
      "These values are intended solely as a benchmark for comparative analysis and consistency checking. " +
      "They do not represent current market prices and may not reflect recent fluctuations in material, labor, " +
      "equipment, logistics, taxes, inflation, foreign exchange, or regional supply conditions. Users should " +
      "validate significant pricing decisions with current supplier quotations, market surveys, and " +
      "project-specific cost estimates before making commercial or contractual decisions.",
  };
}
