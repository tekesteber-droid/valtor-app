// scripts/test-integration.mjs
//
// Exercises the REAL functions check-analysis.js calls — getPricingEngine(),
// buildPricingEvidence(), and the new computeComplianceRisk()/
// computePricingRisk() — directly, bypassing HTTP, Supabase auth, and the
// frontend entirely. This is the fastest way to prove today's change works
// end-to-end without vercel dev / env vars / a real login.
//
// Run from the repo root: node scripts/test-integration.mjs

import { getPricingEngine } from '../api/_lib/pricingEngine.js';
import { buildPricingEvidence } from '../api/_lib/pricingEvidence.js';
import { validateArithmetic } from '../api/_lib/arithmeticValidator.js';
import { computeComplianceRisk, computePricingRisk } from '../api/_lib/riskScoring.js';

console.log('=== 1. Load the real pricing engine (reads api/data/pricing_master.json) ===');
const engine = await getPricingEngine();
console.log(`  Loaded. Reference label: "${engine.referenceLabel}"`);
console.log(`  Records indexed: ${engine.records.length}`);

console.log('\n=== 2. Realistic fake BOQ items, shaped exactly like what boqExtractor.js produces ===');
// Deliberately mixes: a normal item, an underpriced item, an overpriced
// item, and an item with an arithmetic mismatch — so every path gets
// exercised in one run.
const boqItems = [
  { item_no: '1.01', description: '200mm thick HCB wall bedded in cement sand mortar', unit: 'm2', qty: 70.27, tender_price: 660.28, total: 46400.18 },
  { item_no: '1.02', description: 'Excavation for isolated footing in ordinary soil', unit: 'm3', qty: 22.48, tender_price: 40.00, total: 899.20 }, // deliberately ~58% under a plausible reference rate
  { item_no: '1.03', description: 'Reinforced concrete C-25 in footing pad', unit: 'm3', qty: 7.91, tender_price: 6500.00, total: 51415.00 }, // deliberately overpriced
  { item_no: '1.04', description: 'Steel bar reinforcement dia 12mm deformed', unit: 'kg', qty: 270.41, tender_price: 69.87, total: 25000.00 }, // stated total doesn't match qty x rate
];
const totalBidPrice = boqItems.reduce((sum, i) => sum + i.total, 0);
console.log(`  ${boqItems.length} items, total bid price: ${totalBidPrice.toFixed(2)} ETB`);

console.log('\n=== 3. buildPricingEvidence() — the REAL function, confirms quantity is now present ===');
const pricingEvidence = buildPricingEvidence(engine, boqItems);
for (const e of pricingEvidence) {
  console.log(`  "${e.item}" — matched: ${e.matched_reference_item_no ?? 'NO MATCH'} (${e.confidence}), quantity: ${e.quantity}, variance: ${e.variance_percent}%`);
}
const missingQuantity = pricingEvidence.filter((e) => e.quantity == null).length;
console.log(missingQuantity === 0
  ? '  PASS: every item has a quantity field.'
  : `  FAIL: ${missingQuantity} item(s) missing quantity — pricingEvidence.js fix did not land correctly.`);

console.log('\n=== 4. validateArithmetic() — the REAL function, confirms the deliberate mismatch on item 1.04 is caught ===');
const arithmeticErrors = validateArithmetic(boqItems, totalBidPrice);
console.log(arithmeticErrors);
console.log(arithmeticErrors.some((e) => e.location.includes('1.04'))
  ? '  PASS: deliberate arithmetic mismatch detected.'
  : '  FAIL: expected an arithmetic_errors entry for item 1.04.');

console.log('\n=== 5. computePricingRisk() — the REAL new function, real engine data, real arithmetic findings ===');
const analysis = {
  arithmetic_errors: arithmeticErrors,
  market_variance: pricingEvidence,
};
const pricingRisk = computePricingRisk(analysis, totalBidPrice);
console.log(JSON.stringify(pricingRisk, null, 2));

console.log('\n=== 6. computeComplianceRisk() — the REAL new function, fake-but-realistic contractual_traps/scope_gaps ===');
const complianceAnalysis = {
  contractual_traps: [
    { clause_type: 'Missing Liquidated Damages Clause', severity: 'CRITICAL', description: 'No LD clause found in submitted document.' },
  ],
  scope_gaps: [
    { missing_element: 'No waterproofing spec for basement', risk_impact: 'Dispute risk on defects liability', estimated_cost_etb: 12000 },
  ],
};
const complianceRisk = computeComplianceRisk(complianceAnalysis, { totalBidPrice });
console.log(JSON.stringify(complianceRisk, null, 2));

console.log('\n=== SUMMARY ===');
console.log(`  Pricing Risk score: ${pricingRisk.score}`);
console.log(`  Compliance Risk score: ${complianceRisk.score}`);
console.log(`  Legacy bridge risk_score (max of both): ${Math.max(pricingRisk.score, complianceRisk.score)}`);
