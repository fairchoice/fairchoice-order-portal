import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getOrderedQty,getResolvedQty,getRemainingPickingQty } from "./picking.js";
test("quantity four can resolve as two plus two",()=>{const item={qty:4,picking_in_stock_qty:2,picking_pre_order_qty:2,picking_replaced_qty:0};assert.equal(getOrderedQty(item),4);assert.equal(getResolvedQty(item),4);assert.equal(getRemainingPickingQty(item),0);});
test("migration secures quantity writes and prevents over-resolution",()=>{const sql=fs.readFileSync(new URL("../../supabase/migrations/20260801100000_quantity_picking_location_inventory.sql",import.meta.url),"utf8");assert.match(sql,/fc_require_session_permission\(p_username,p_session_token,'warehouse\.pick'\)/);assert.match(sql,/exceeds the unresolved quantity/);assert.match(sql,/preorder_supply_client_action_id:=null/);assert.match(sql,/revoke all on function public\.complete_order_picking/);});
test("legacy products can bootstrap exactly one country inventory row",()=>{const sql=fs.readFileSync(new URL("../../supabase/migrations/20260801110000_legacy_inventory_bootstrap_for_picking.sql",import.meta.url),"utf8");assert.match(sql,/v_any_location_count>0/);assert.match(sql,/insert into public\.product_location_stock/);assert.match(sql,/on conflict\(product_id,location_id\) do nothing/);assert.match(sql,/no active % stock row/);});
