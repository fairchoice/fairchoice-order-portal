import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../services/preOrderSupplyHistory.js", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260803001000_preorder_supply_shared_active_history.sql", import.meta.url),
  "utf8",
);

test("history is shared, delivery-aware and refreshes across devices", () => {
  assert.match(service, /fc_list_preorder_supply_events_v2/);
  assert.match(page, /setInterval\(refreshSharedHistory, 10000\)/);
  assert.match(page, /window\.addEventListener\("focus", refreshSharedHistory\)/);
  assert.match(page, /localStorage\.removeItem\(PREORDER_SUPPLY_PENDING_KEY\)/);
});

test("active Bought and Cannot Supply records clear after delivery confirmation", () => {
  assert.match(page, /isDeliveryConfirmed\(event\)/);
  assert.match(page, /if \(delivered\) continue/);
  assert.doesNotMatch(page, /const TABS = \[.*"History"/s);
});

test("active event views require a live order while permanent history remains loaded", () => {
  assert.match(page, /!isLivePreOrderSupplyEvent\(event, liveWarehouseItemKeys, liveWarehouseItemIds\)/);
  assert.match(page, /const combinedEvents = \[\.\.\.pendingActions, \.\.\.historyEvents\]/);
  assert.match(service, /events: rows\.map\(normalizeEvent\)/);
  assert.doesNotMatch(service, /delete.*preorder_supply_events/is);
});

test("active supplier views have no date grouping or date filter", () => {
  assert.match(page, /const supplierName = event\.supplierName/);
  assert.doesNotMatch(page, /historyDateKey|dateGroups|dateGroup\.suppliers|type="date"/);
});

test("additive v2 RPC exposes live delivery state without rewriting events", () => {
  assert.match(migration, /create or replace function public\.fc_list_preorder_supply_events_v2/);
  assert.match(migration, /delivery_confirmed/);
  assert.match(migration, /left join lateral/);
  assert.doesNotMatch(migration, /delete from public\.preorder_supply_events/i);
  assert.doesNotMatch(migration, /update public\.preorder_supply_events/i);
});
