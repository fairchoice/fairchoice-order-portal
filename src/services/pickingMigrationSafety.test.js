import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeInventoryCountry, resolveOrderInventoryCountry } from "./locationStock.js";

const base = fs.readFileSync(new URL("../../supabase/migrations/20260801100000_quantity_picking_location_inventory.sql", import.meta.url), "utf8");
const repair = fs.readFileSync(new URL("../../supabase/migrations/20260801120000_fix_picking_inventory_rpc_runtime_errors.sql", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("./picking.js", import.meta.url), "utf8");

test("apply, recall and completion require the warehouse.pick FC session", () => {
  assert.match(repair, /fc_require_session_permission\([\s\S]*?'warehouse\.pick'/);
  assert.match(base, /fc_recall_picking_quantities_v1[\s\S]*?fc_require_session_permission\(p_username,p_session_token,'warehouse\.pick'\)/);
  assert.match(base, /complete_order_picking[\s\S]*?fc_require_session_permission\(p_username,p_session_token,'warehouse\.pick'\)/);
  assert.match(service, /p_username: session\.username/);
  assert.match(service, /p_session_token: session\.token/);
});

test("Picking RPC execution remains restricted to application invocation roles", () => {
  for (const sql of [base, repair]) assert.match(sql, /revoke all on function public\.fc_apply_picking_quantity_v1[\s\S]*?from public,\s*anon,\s*authenticated/i);
  assert.match(repair, /grant execute on function public\.fc_apply_picking_quantity_v1[\s\S]*?to anon, authenticated/i);
  assert.match(base, /grant execute on function public\.fc_recall_picking_quantities_v1[\s\S]*?to anon,authenticated/i);
});

test("country resolution and exact-country stock are shared by SQL and JavaScript", () => {
  for (const [variant, expected] of [["ENG", "England"], ["GB-ENG", "England"], ["WLS", "Wales"], ["GB-WLS", "Wales"]]) assert.equal(normalizeInventoryCountry(variant), expected);
  assert.equal(resolveOrderInventoryCountry({ delivery_country: "WLS", branch_country: "ENG" }), "Wales");
  assert.match(repair, /fc_normalize_inventory_country_v1\(sl\.country\) = v_country/);
  assert.match(repair, /for update/);
  assert.doesNotMatch(repair, /min\s*\(/i);
});

test("pre-order bypasses stock variables and stock actions use assigned scalars", () => {
  assert.match(repair, /if p_action <> 'pre_order' then/);
  assert.match(repair, /v_stock_row_id uuid/);
  assert.match(repair, /v_stock_location_id uuid/);
  assert.match(repair, /v_stock_qty numeric/);
  assert.doesNotMatch(repair, /v_location\s*\./);
});

test("legacy initialization cannot rewrite terminal historical orders", () => {
  assert.match(base, /o\.status in \('Received','In Progress'\)/);
  assert.match(base, /from public\.orders o[\s\S]*o\.id=order_items\.order_id/);
  assert.doesNotMatch(base, /update public\.order_items set[\s\S]{0,300}where picking_ordered_qty is null and picking_action/);
});

test("split completion preserves every financial total and segment identity", () => {
  for (const field of ["line_total", "net_total", "gross_total", "vat_amount", "vat_total"]) {
    assert.match(base, new RegExp(`${field}:=v_`, "i"));
    assert.match(base, new RegExp(`${field}=v_`, "i"));
  }
  assert.match(base, /v_index=v_segments then v_line_remaining/);
  assert.match(base, /v_item\.picking_ordered_qty:=v_qty/);
  assert.match(base, /v_item\.preorder_supply_client_action_id:=null/);
});

test("Picking audit retains original and replacement identities plus reversal context", () => {
  for (const column of ["original_product_id", "old_status", "new_status", "reason", "reversal_old_status", "reversal_new_status", "reversal_reason"]) assert.match(base, new RegExp(`add column if not exists ${column}`));
  assert.match(repair, /v_item\.product_id,[\s\S]*p_replacement_product_id/);
  assert.match(base, /reversal_reason='Picker recall'/);
});

test("migration remains forward additive for business tables", () => {
  assert.doesNotMatch(base, /drop table|truncate table|delete from public\./i);
  assert.match(base, /^begin;/m);
  assert.match(base, /^commit;/m);
});
