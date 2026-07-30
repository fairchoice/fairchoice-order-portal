import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("./OrderPicking.jsx", import.meta.url),
  "utf8",
);

test("Picking List renders items in source order without sequence badges", () => {
  assert.match(source, /items\.map\(\(item\) =>/);
  assert.doesNotMatch(source, /\{index \+ 1\}/);
  assert.doesNotMatch(source, /rounded-full bg-slate-100 text-xs font-black text-slate-600/);
  assert.match(source, /<article key=\{itemId\}/);
});

test("Picking List actions and completion calculations remain intact", () => {
  assert.match(
    source,
    /const completedCount = items\.filter\(\(item\) => Boolean\(item\.pickingAction \|\| item\.picking_action\)\)\.length/,
  );
  assert.match(
    source,
    /const allDecided = items\.length > 0 && items\.every\(\(item\) => Boolean\(item\.pickingAction \|\| item\.picking_action\)\)/,
  );
  for (const label of [
    "Add / In Stock",
    "Pre-Order",
    "Replace",
    "Recall",
    "Break / Save Progress",
    "Complete Picking",
  ]) {
    assert.match(source, new RegExp(label.replace("/", "\\/")));
  }
  assert.match(source, /savePickingDecision/);
  assert.match(source, /pauseOrderPicking/);
  assert.match(source, /completeOrderPicking/);
});
