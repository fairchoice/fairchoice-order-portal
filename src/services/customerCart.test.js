import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./customerCart.js", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260810010000_customer_central_cart_foundation.sql", import.meta.url),
  "utf8",
);

test("central cart stays opt-in until test database migration is approved", () => {
  assert.match(source, /VITE_CENTRAL_CART_ENABLED/);
  assert.match(source, /===\s*"true"/);
});

test("central cart client uses FC session credentials and server RPCs", () => {
  assert.match(source, /getFcSessionState/);
  assert.match(source, /fc_cart_get_or_create_v1/);
  assert.match(source, /fc_cart_increment_item_v1/);
  assert.match(source, /fc_cart_set_quantity_v1/);
  assert.match(source, /fc_cart_begin_submission_v1/);
  assert.match(source, /fc_cart_finalize_submission_v1/);
});

test("migration does not alter current orders or order_items", () => {
  assert.doesNotMatch(migration, /alter\s+table\s+public\.orders/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.order_items/i);
  assert.match(migration, /create table if not exists public\.customer_carts/i);
  assert.match(migration, /create table if not exists public\.customer_cart_items/i);
});

test("central cart tables are not directly writable by browser roles", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.customer_carts from anon, authenticated/i);
  assert.match(migration, /revoke all on public\.customer_cart_items from anon, authenticated/i);
});

test("cart mutations validate account ownership and use atomic increments", () => {
  assert.match(migration, /fc_assert_cart_access_v1/i);
  assert.match(migration, /quantity\s*=\s*customer_cart_items\.quantity\s*\+\s*excluded\.quantity/i);
});
