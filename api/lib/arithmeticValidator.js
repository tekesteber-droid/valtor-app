// api/lib/arithmeticValidator.js
//
// Deterministic arithmetic checking over BOQ line items. No LLM involved —
// every finding here is a plain multiplication/addition check against the
// numbers the user's own document actually contains. This exists because
// the LLM prompt in check-analysis.js was previously asked to invent
// "arithmetic_errors" with no source data to check them against; this
// module gives it real errors to report instead, or none if there aren't any.
//
// Usage:
//   import { validateArithmetic } from "./arithmeticValidator.js";
//   const errors = validateArithmetic(boqItems);

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Tolerance for float/rounding noise in real-world BOQs (e.g. rates quoted
// to 2dp but totals rounded to the nearest birr). Anything past this is a
// genuine discrepancy, not rounding.
const ABS_TOLERANCE_ETB = 1;
const PCT_TOLERANCE = 0.005; // 0.5%

/**
 * Checks each line item's qty * unitPrice against its stated total.
 * Only checks items where all three fields are present and numeric —
 * silently skips (does not flag) incomplete rows, since a missing field
 * is a data-entry gap, not a proven arithmetic error.
 *
 * @param {Array<{item_no?, description, unit?, qty?, quantity?, tender_price?, unitPrice?, total?}>} boqItems
 * @returns {Array<{location, description, severity, financial_impact, expected_total, stated_total}>}
 */
function checkLineItemMath(boqItems) {
  const errors = [];

  for (const item of boqItems || []) {
    const qty = numOrNull(item.qty ?? item.quantity);
    const rate = numOrNull(item.tender_price ?? item.unitPrice ?? item.unit_price);
    const statedTotal = numOrNull(item.total);

    if (qty === null || rate === null || statedTotal === null) continue;

    const expectedTotal = round(qty * rate);
    const diff = Math.abs(expectedTotal - statedTotal);
    const pctDiff = expectedTotal !== 0 ? diff / Math.abs(expectedTotal) : (statedTotal === 0 ? 0 : 1);

    if (diff <= ABS_TOLERANCE_ETB || pctDiff <= PCT_TOLERANCE) continue;

    const severity = pctDiff > 0.1 ? "HIGH" : pctDiff > 0.02 ? "MEDIUM" : "LOW";

    errors.push({
      location: item.item_no ? `Item ${item.item_no}` : (item.description || "Unlabeled item"),
      description:
        `Stated total (${statedTotal.toLocaleString()} ETB) does not match quantity × rate ` +
        `(${qty.toLocaleString()} × ${rate.toLocaleString()} = ${expectedTotal.toLocaleString()} ETB).`,
      severity,
      financial_impact: Math.round(diff),
      expected_total: expectedTotal,
      stated_total: statedTotal,
    });
  }

  return errors;
}

/**
 * Checks that the sum of line-item totals matches any stated grand total.
 * Only runs if a grandTotal is supplied — this is optional context, not
 * something inferred from the LLM.
 *
 * @param {Array} boqItems
 * @param {number|null} statedGrandTotal
 * @returns {Array} zero or one error object
 */
function checkGrandTotal(boqItems, statedGrandTotal) {
  const grandTotal = numOrNull(statedGrandTotal);
  if (grandTotal === null) return [];

  const itemTotals = (boqItems || [])
    .map((i) => numOrNull(i.total))
    .filter((n) => n !== null);

  if (itemTotals.length === 0) return [];

  const sum = round(itemTotals.reduce((a, b) => a + b, 0));
  const diff = Math.abs(sum - grandTotal);
  const pctDiff = grandTotal !== 0 ? diff / Math.abs(grandTotal) : (sum === 0 ? 0 : 1);

  if (diff <= ABS_TOLERANCE_ETB || pctDiff <= PCT_TOLERANCE) return [];

  return [{
    location: "BOQ Grand Total",
    description:
      `Sum of extracted line-item totals (${sum.toLocaleString()} ETB) does not match the ` +
      `stated grand total (${grandTotal.toLocaleString()} ETB). This may indicate items missing ` +
      `from extraction, or an error in the original document — verify against the source.`,
    severity: pctDiff > 0.1 ? "HIGH" : pctDiff > 0.02 ? "MEDIUM" : "LOW",
    financial_impact: Math.round(diff),
    expected_total: sum,
    stated_total: grandTotal,
  }];
}

function numOrNull(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Full deterministic arithmetic validation over a BOQ.
 *
 * @param {Array} boqItems
 * @param {number|null} [statedGrandTotal]
 * @returns {Array} arithmetic_errors — same shape check-analysis.js already
 *   expects, so the frontend needs no changes.
 */
export function validateArithmetic(boqItems, statedGrandTotal = null) {
  if (!Array.isArray(boqItems) || boqItems.length === 0) return [];
  return [
    ...checkLineItemMath(boqItems),
    ...checkGrandTotal(boqItems, statedGrandTotal),
  ];
}