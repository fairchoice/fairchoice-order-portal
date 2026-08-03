import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migrationUrl = new URL(
  "../../supabase/migrations/20260801120000_fix_picking_inventory_rpc_runtime_errors.sql",
  import.meta.url,
);
const sql = fs.readFileSync(migrationUrl, "utf8");

test("picking repair avoids unsupported UUID aggregate", () => {
  assert.doesNotMatch(sql, /min\s*\(\s*id\s*\)/i);
  assert.match(sql, /select\s+sl\.id[\s\S]*into\s+v_country_location_id[\s\S]*order by sl\.id[\s\S]*limit 1/i);
});

test("pre-order path never reads an unassigned record variable", () => {
  assert.doesNotMatch(sql, /v_location\./);
  assert.match(sql, /v_stock_location_id uuid/);
  assert.match(sql, /case[\s\S]*when p_action = 'pre_order' then null[\s\S]*else v_stock_location_id[\s\S]*end/);
});

test("stock deduction uses explicitly assigned scalar values", () => {
  assert.match(sql, /into\s+v_stock_row_id,\s*v_stock_location_id,\s*v_stock_qty/);
  assert.match(sql, /where pls\.id = v_stock_row_id/);
});
