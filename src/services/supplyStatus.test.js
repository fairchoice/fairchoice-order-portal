import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isSupplyRecordStatus, normalizeSupplyStatus } from "./supplyStatus.js";

const page = fs.readFileSync(new URL("../pages/PreOrderSupply.jsx", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("./preOrderSupplyAllocation.js", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260801093000_preorder_supply_event_history.sql", import.meta.url),
  "utf8",
);

test("Warehouse variants map to canonical supply groups", () => {
  for (const value of ["PRE_ORDER", "PRE-ORDER", "Pre-Order", "preorder", "Need Supplier"]) {
    assert.equal(normalizeSupplyStatus(value).group, "Pre-order");
    assert.equal(isSupplyRecordStatus(value), true);
  }
  for (const value of ["NEXT_SUPPLIER", "NEXT SUPPLIER", "NEXT_SUPPLY"]) {
    assert.equal(normalizeSupplyStatus(value).group, "Next Supply");
    assert.equal(isSupplyRecordStatus(value), true);
  }
  for (const value of ["CANNOT_SUPPLY", "CANNOT SUPPLY", "Cannot Supply"]) {
    assert.equal(normalizeSupplyStatus(value).group, "Cannot Supply");
    assert.equal(isSupplyRecordStatus(value), true);
  }
});

test("Pre-order Supply uses supplier-first permanent workflow tabs", () => {
  assert.match(page, /\["Pre-order Queue", "Next Supplier", "Bought", "Cannot Supply", "Order Pre-orders"\]/);
  assert.match(page, /Select Supplier/);
  assert.match(page, /Confirm Buy/);
  assert.match(page, /Sync All/);
  assert.match(page, /supplierName/);
});

test("active tabs remain live-demand based while permanent history stays off-screen", () => {
  assert.match(page, /if \(!isActivePreOrderSupplyOrder\(order\)\) continue/);
  assert.match(page, /const combinedEvents = \[\.\.\.pendingActions, \.\.\.historyEvents\]/);
  assert.match(page, /if \(delivered\) continue/);
  assert.match(page, /tab === "Bought"[\s\S]*\["Buy", "PartialBuy"\]/);
  assert.match(page, /tab === "Cannot Supply"[\s\S]*\["Remove", "Available", "Recall Available"\]/);
  assert.doesNotMatch(page, /tab === "History"|historyDateKey|type="date"/);
});

test("supplier attempts and bought quantities remain auditable", () => {
  assert.match(workflow, /action\?\.actionType === "NextSup"/);
  assert.match(workflow, /action\?\.actionType === "PartialBuy"/);
  assert.match(page, /batchId/);
  assert.match(migration, /supplier_id uuid/);
  assert.match(migration, /supplier_name text/);
  assert.match(migration, /preorder_supply_events_batch_idx/);
  assert.match(migration, /bought_at/);
});

test("duplicate retries cannot duplicate shared history", () => {
  assert.match(migration, /unique index if not exists preorder_supply_events_client_action_uidx/);
  assert.match(migration, /where client_action_id=v_client/);
  assert.match(migration, /order_items_preorder_supply_action_uidx/);
  assert.match(page, /clientActionId/);
});

test("browser storage contains pending changes only", () => {
  assert.match(page, /PREORDER_SUPPLY_PENDING_KEY/);
  assert.doesNotMatch(page, /HISTORY_KEY/);
  assert.match(page, /historyWarning/);
});
