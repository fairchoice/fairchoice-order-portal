import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const warehouse = fs.readFileSync(new URL("./Warehouse.jsx", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../components/WarehousePreOrderPanel.jsx", import.meta.url), "utf8");
const preorder = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
const activityService = fs.readFileSync(new URL("../services/warehouseActivity.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../../supabase/migrations/20260818225103_warehouse_operational_activity.sql", import.meta.url), "utf8");

test("Warehouse replaces row status buttons with one order-level Pre-Order Supply panel", () => {
  assert.match(warehouse, /setPreOrderPanelOrderId\(orderId\)/);
  assert.match(warehouse, /<WarehousePreOrderPanel/);
  assert.doesNotMatch(warehouse, />\s*Available\s*<\/button>/);
  assert.doesNotMatch(warehouse, /updateWarehouseItem/);
  assert.match(warehouse, /Ready For Driver/);
  assert.match(warehouse, /printProtectedDeliveryNote/);
});

test("Warehouse panel exposes only the simplified operational action matrix", () => {
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /recordWarehouseOperationalActivity/);
  assert.match(panel, /status === "Pre-Order" \|\| status === "Cannot Supply"/);
  assert.match(panel, /saveActivity\(item, "Available", "In Stock"\)/);
  assert.match(panel, /saveActivity\(item, "Cannot Supply", "Cannot Supply"\)/);
  assert.match(panel, /saveActivity\(item, "Recall Available", "Cannot Supply", recallableAvailable\)/);
  assert.doesNotMatch(panel, /recordPreOrderSupplyEvent|loadPreOrderSupplyHistory/);
  assert.doesNotMatch(panel, /Select supplier|supplierAction|Bought|Next Supplier|Move to Pre-Order/);
});

test("Available and Recall Available remain a referenced permanent audit chain", () => {
  assert.match(preorder, />\s*Available\s*<\/button>/);
  assert.match(preorder, />\s*Recall\s*<\/button>/);
  assert.match(preorder, /referencedEventId:\s*actionType === "Recall Available" \? line\.latestAction\?\.id/s);
  assert.match(preorder, /warehouseStatusOverrides\[itemId\] \|\| line\?\.status/);
  assert.match(panel, /event\.oldStatus === "Cannot Supply"/);
  assert.match(panel, /referencedEventId: referencedEvent\?\.id/);
  assert.match(migration, /referenced_event_id uuid references public\.warehouse_operational_events/);
  assert.match(migration, /action_type='Recall Available' and r\.referenced_event_id=v_original\.id/);
  assert.doesNotMatch(migration, /delete from public\.warehouse_operational_events/i);
});

test("operational RPC persists the item transition and permanent event atomically", () => {
  const updateIndex = migration.indexOf("update public.order_items");
  const insertIndex = migration.indexOf("insert into public.warehouse_operational_events");
  assert.ok(updateIndex > 0);
  assert.ok(insertIndex > updateIndex);
  assert.match(migration, /v_old_status in \('Pre-Order','Cannot Supply'\) and v_new_status='In Stock'/);
  assert.match(migration, /v_old_status='In Stock' and v_new_status='Cannot Supply'/);
  assert.match(panel, /saved = await recordWarehouseOperationalActivity/);
  assert.match(panel, /setEvents\(\(current\) => \[saved, \.\.\.current\]\)/);
  assert.match(panel, /savedStatuses\[String\(key\)\]/);
  assert.match(panel, /activity was saved, but the order list could not be refreshed/);
  assert.match(panel, /if \(typeof refreshOrders === "function"\) await refreshOrders\(\)/);
});

test("all four approved Warehouse transitions keep reason optional", () => {
  const implementation = [warehouse, panel, activityService, migration].join("\n");
  assert.doesNotMatch(implementation, /reason\s+is\s+required[\s\S]*In Stock Warehouse exception/i);
  assert.doesNotMatch(panel, /window\.prompt|reasonRequired/);
  assert.doesNotMatch(migration, /v_reason\s+is\s+null|reason\s+is\s+required/i);

  assert.match(panel, /status === "Pre-Order" \|\| status === "Cannot Supply"/);
  assert.match(panel, /saveActivity\(item, "Available", "In Stock"\)/);
  assert.match(panel, /saveActivity\(item, "Cannot Supply", "Cannot Supply"\)/);
  assert.match(panel, /saveActivity\(item, "Recall Available", "Cannot Supply", recallableAvailable\)/);
  assert.match(migration, /v_old_status in \('Pre-Order','Cannot Supply'\) and v_new_status='In Stock'/);
  assert.match(migration, /v_old_status='In Stock' and v_new_status='Cannot Supply'/);

  assert.match(panel, /window\.confirm/);
  assert.match(panel, /saved = await recordWarehouseOperationalActivity/);
  assert.match(activityService, /reason: activity\.reason \|\| null/);
  assert.match(migration, /v_old_status,v_new_status,v_action,v_reason/);
});

test("migration is additive, session-authorized and changes order status without physical stock", () => {
  assert.match(migration, /create table if not exists public\.warehouse_operational_events/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /fc_require_session_permission_v2/);
  assert.match(migration, /update public\.order_items[\s\S]*source_status/);
  assert.doesNotMatch(migration, /update\s+public\.(product_location_stock|inventory_layers)/i);
  assert.doesNotMatch(migration, /truncate|drop table|delete from public\.preorder_supply_events/i);
});

test("supplier history is unioned into the monitor rather than duplicated", () => {
  assert.match(migration, /from public\.preorder_supply_events p/);
  assert.doesNotMatch(migration, /insert into public\.warehouse_operational_events\([^)]*supplier_id/i);
  assert.match(migration, /'Pre-Order Supply'/);
});

test("supplier workflow transitions retain Next Supplier in the activity monitor", () => {
  assert.match(migration, /when p\.action_type='NextSup' then 'Next Supplier'/);
  assert.match(migration, /p\.action_type in \('Buy','PartialBuy','Remove'\)[\s\S]*then 'Next Supplier'/);
  assert.match(migration, /original\.action_type='NextSup' then 'Recall Next Supplier'/);
});
