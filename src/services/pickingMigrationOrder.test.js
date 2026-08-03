import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrations = [
  "20260801093000_preorder_supply_event_history.sql",
  "20260801100000_quantity_picking_location_inventory.sql",
  "20260801110000_legacy_inventory_bootstrap_for_picking.sql",
  "20260801120000_fix_picking_inventory_rpc_runtime_errors.sql",
  "20260802103000_sync_picking_status_to_received_orders.sql",
];

const sqlByMigration = Object.fromEntries(
  migrations.map((migration) => [
    migration,
    fs.readFileSync(
      new URL(`../../supabase/migrations/${migration}`, import.meta.url),
      "utf8",
    ),
  ]),
);

test("quantity Picking has one explicit five-migration deployment order", () => {
  const preflight = fs.readFileSync(
    new URL("../../docs/preview-picking-migration-preflight.md", import.meta.url),
    "utf8",
  );
  let previousIndex = -1;
  for (const migration of migrations) {
    const index = preflight.indexOf(migration);
    assert.ok(index > previousIndex, `${migration} must appear in deployment order`);
    previousIndex = index;
  }
});

test("pre-order schema precedes quantity Picking and runtime replacements", () => {
  const preOrder = sqlByMigration[migrations[0]];
  const quantity = sqlByMigration[migrations[1]];
  const bootstrap = sqlByMigration[migrations[2]];
  const runtimeRepair = sqlByMigration[migrations[3]];
  const receivedSync = sqlByMigration[migrations[4]];

  assert.match(preOrder, /add column if not exists preorder_supply_client_action_id/i);
  assert.match(quantity, /preorder_supply_client_action_id:=null/i);
  assert.match(quantity, /create or replace function public\.fc_apply_picking_quantity_v1/i);
  assert.match(bootstrap, /create or replace function public\.fc_apply_picking_quantity_v1/i);
  assert.match(runtimeRepair, /create or replace function public\.fc_apply_picking_quantity_v1/i);
  assert.match(receivedSync, /picking_in_stock_qty/);
  assert.match(receivedSync, /picking_pre_order_qty/);
  assert.match(receivedSync, /picking_replaced_qty/);
});
