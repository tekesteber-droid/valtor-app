// scripts/test-pricing-engine.mjs
// Run with: node scripts/test-pricing-engine.mjs
import assert from "node:assert/strict";
import { getPricingEngine } from "../api/lib/pricingEngine.js";
import { buildPricingEvidence, buildPricingReference } from "../api/lib/pricingEvidence.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

const engine = await getPricingEngine();

console.log("Exact match");
test("matches by exact item_no", () => {
  const r = engine.match("anything", { itemCode: "1.1.1" });
  assert.equal(r.matched, true);
  assert.equal(r.confidence, "High");
  assert.equal(r.matchType, "Exact (Item Code)");
});
test("matches by exact normalized description", () => {
  const r = engine.match("Demolishing the lamera wall");
  assert.equal(r.matched, true);
  assert.equal(r.confidence, "High");
});

console.log("Fuzzy / keyword match");
test("matches on close paraphrase with confidence Medium or High", () => {
  const r = engine.match("demolish lamera walls"); // plural + reordering
  assert.equal(r.matched, true);
  assert.ok(["High", "Medium"].includes(r.confidence));
});
test("matches case-insensitively", () => {
  const r = engine.match("DEMOLISHING THE LAMERA WALL");
  assert.equal(r.matched, true);
});

console.log("No match");
test("returns Unknown / no price for unrelated text", () => {
  const r = engine.match("intergalactic space elevator installation");
  assert.equal(r.matched, false);
  assert.equal(r.confidence, "Unknown");
  assert.equal(r.referencePrice, null);
});

console.log("Evidence builder never invents numbers");
test("unmatched BOQ item has null reference_price, not an estimate", () => {
  const evidence = buildPricingEvidence(engine, [
    { description: "quantum flux capacitor installation", unit: "pcs", tender_price: 5000 },
  ]);
  assert.equal(evidence[0].reference_price, null);
  assert.equal(evidence[0].confidence, "Unknown");
});
test("matched item computes variance_percent correctly", () => {
  const evidence = buildPricingEvidence(engine, [
    { description: "Demolishing the lamera wall", unit: "m²", tender_price: 200 },
  ]);
  const e = evidence[0];
  assert.equal(e.confidence, "High");
  assert.ok(e.reference_price > 0);
  const expected = Number((((200 - e.reference_price) / e.reference_price) * 100).toFixed(2));
  assert.equal(e.variance_percent, expected);
});

console.log("Pricing reference metadata");
test("includes disclaimer and source document", () => {
  const ref = buildPricingReference(engine);
  assert.ok(ref.disclaimer.includes("benchmark"));
  assert.ok(ref.source_document.length > 0);
});

console.log("Performance");
test("500 lookups complete in well under 1s (in-memory index, no re-parsing)", () => {
  const start = performance.now();
  for (let i = 0; i < 500; i++) {
    engine.match("15cm thick HCB Structure", { unit: "m²" });
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `expected < 1000ms, got ${elapsed.toFixed(1)}ms`);
});

console.log(`\n${passed} test(s) passed.`);
