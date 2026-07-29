import { getPricingEngine } from './api/lib/pricingEngine.js';

const main = async () => {
  const engine = await getPricingEngine();
  
  console.log("Records loaded:", engine.records.length);
  console.log("byItemNo size:", engine.byItemNo.size);
  console.log("byNormalizedDescription size:", engine.byNormalizedDescription.size);
  
  // Test 1: Exact match by description
  const r1 = engine.match("C-25 Concrete (Mechanical Mix) 1:2:3 for Footing, Beam and slab");
  console.log("Concrete match:", r1);
  
  // Test 2: Exact match by item_no
  const r2 = engine.match("anything", { itemCode: "4.3.2" });
  console.log("Item code match:", r2);
  
  // Test 3: Fuzzy match
  const r3 = engine.match("10cm class-c HCB wall");
  console.log("Fuzzy match:", r3);

  // Print first few records to verify data loaded
  console.log("First record sample:", engine.records.slice(0, 2));
};

main();