import {
  classifyArithmeticError,
  classifyUnpricedItem,
  computeComplianceRisk,
  computePricingRisk,
} from '../api/_lib/riskScoring.js';

console.log('=== 1. Arithmetic tolerance against REAL Group 2 line items ===');
const realLines = [
  { desc: '1.01 Topsoil clearing', qty: 368.56, rate: 31.25, stated: 11517.41 },
  { desc: '1.03 Pit excavation', qty: 455.22, rate: 347.66, stated: 158260.08 },
  { desc: '2.02a RC in pad foundation', qty: 27.72, rate: 3112.12, stated: 86275.68 },
  { desc: 'B.1.01i "flatfloor" slab (largest real drift seen: 18.92 Birr)', qty: 296.16, rate: 487.41, stated: 144350.22 },
];
for (const l of realLines) {
  const computed = l.qty * l.rate;
  const severity = classifyArithmeticError(computed, l.stated);
  console.log(`  ${l.desc}: computed=${computed.toFixed(2)} stated=${l.stated} diff=${(computed - l.stated).toFixed(2)} -> ${severity ?? 'NO FINDING (within tolerance)'}`);
}

console.log('\n=== 2. Synthetic genuine error, to prove the classifier still catches real problems ===');
const syntheticBad = { desc: 'SYNTHETIC: 12% overstated amount, 45,000 Birr line', qty: 100, rate: 3750, stated: 420000 };
const computedBad = syntheticBad.qty * syntheticBad.rate; // 375,000
console.log(`  ${syntheticBad.desc}: computed=${computedBad} stated=${syntheticBad.stated} -> ${classifyArithmeticError(computedBad, syntheticBad.stated)}`);

console.log('\n=== 3. Unpriced item -- REAL Group 2 case (staircase/landing formwork) ===');
const staircaseItem = { quantity: 26.08, rate: null, amount: null };
const totalBidPrice = 5399461.48; // Group 2's actual stated bid price
const comparableRate = 654.52; // nearest real neighboring formwork rate in the same BOQ (e.g. grade beam formwork)
const unpricedResult = classifyUnpricedItem(staircaseItem, totalBidPrice, comparableRate);
console.log(`  26.08 sqm x ${comparableRate} Birr/sqm comparable rate = ${(26.08 * comparableRate).toFixed(2)} Birr estimated exposure`);
console.log('  Result:', unpricedResult);

console.log('\n=== 4. Compliance Risk -- REAL Edna Construction findings ===');
const ednaFindings = {
  eligibility_integrity: [
    { name: 'Bid security 200 ETB on 3,047,098.25 ETB contract (0.0066%, vs ~1-2% norm)', severity: 'CRITICAL' },
    { name: 'Signed "on behalf of" an individual team member, not the bidding entity', severity: 'CRITICAL' },
    { name: 'Bid dated Feb 26 2020, Bid Submission Sheet re-dated Jan 29 2019 (year prior)', severity: 'MEDIUM' },
    { name: 'CV certification dated Sept 2020, seven months after bid submission date', severity: 'MEDIUM' },
  ],
};
console.log('  ', computeComplianceRisk(ednaFindings));

console.log('\n=== 5. Compliance Risk -- REAL Group 2 findings, NAIVE (one input per table column) ===');
const group2Naive = {
  eligibility_integrity: [
    { name: 'Financial Standing Net Value fails check, Year2 (11.7% off)', severity: 'HIGH' },
    { name: 'Financial Standing Net Value fails check, Year1 (30.0% off)', severity: 'CRITICAL' },
    { name: 'Financial Standing Net Value fails check, Last Year (5.8% off)', severity: 'HIGH' },
    { name: 'Financial Standing Net Value fails check, Current Year (36.2% off)', severity: 'CRITICAL' },
    { name: 'Bid Submission Sheet dated Jan 28 2019 vs Compliance form dated Jan 27 2019', severity: 'MEDIUM' },
    { name: 'Procurement ref EM/001/2019 vs EM/001/19 across forms', severity: 'MEDIUM' },
  ],
};
console.log('  ', computeComplianceRisk(group2Naive));

console.log('\n=== 6. Compliance Risk -- REAL Group 2 findings, DE-DUPLICATED by root cause ===');
const group2Deduped = {
  eligibility_integrity: [
    // The 4 Net Value failures share ONE root cause (one wrong table formula) --
    // represented once, at worst observed severity, not as 4 independent findings.
    { name: 'Financial Standing Net Value fails Assets-Liabilities check in all 4 reported years (worst: 36.2% off, Current Year)', severity: 'CRITICAL' },
    { name: 'Bid Submission Sheet dated Jan 28 2019 vs Compliance form dated Jan 27 2019', severity: 'MEDIUM' },
    { name: 'Procurement ref EM/001/2019 vs EM/001/19 across forms', severity: 'MEDIUM' },
  ],
};
console.log('  ', computeComplianceRisk(group2Deduped));