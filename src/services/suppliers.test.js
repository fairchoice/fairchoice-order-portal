import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  canManageSupplierSetup,
  filterSuppliers,
  normalizeOptionalText,
  supplierOptionsForSelection,
  validateSupplier,
} from "./suppliers.js";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260730120000_supplier_setup_foundation.sql",
    import.meta.url,
  ),
);
const migrationSql = readFileSync(migrationPath, "utf8");

test("supplier create and edit validation requires a trimmed name", () => {
  const missing = validateSupplier({ supplier_name: "   " });
  assert.equal(missing.valid, false);
  assert.equal(missing.errors.supplier_name, "Supplier name is required.");

  const valid = validateSupplier({
    supplier_name: "  Acme Foods  ",
    contact_name: "  Accounts Team  ",
    company_legal_name: "  ",
    email: " accounts@example.test ",
    default_payment_method: "Bank Transfer",
    vat_registered: false,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.supplier.supplier_name, "Acme Foods");
  assert.equal(valid.supplier.company_legal_name, null);
  assert.equal(valid.supplier.contact_name, "Accounts Team");
  assert.equal(valid.supplier.email, "accounts@example.test");
  assert.equal(valid.supplier.vat_registered, false);
  assert.equal(normalizeOptionalText("\t"), null);
});

test("supplier validation reports invalid email, payment method, and long notes", () => {
  const result = validateSupplier({
    supplier_name: "Acme",
    email: "not-an-email",
    default_payment_method: "Crypto",
    notes: "x".repeat(4001),
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.email, /valid email/i);
  assert.match(result.errors.default_payment_method, /valid default/i);
  assert.match(result.errors.notes, /4,000/);
});

test("supplier search is trimmed, case-insensitive, partial, and literal", () => {
  const suppliers = [
    { id: "1", supplier_name: "Percent % Foods", active: true },
    { id: "2", supplier_name: "Under_score Ltd", active: true },
    { id: "3", supplier_name: String.raw`Back\Slash Wholesale`, active: false },
    { id: "4", supplier_name: "Ordinary Supplier", active: true },
  ];

  assert.deepEqual(
    filterSuppliers(suppliers, "  PERCENT %  ").map(({ id }) => id),
    ["1"],
  );
  assert.deepEqual(
    filterSuppliers(suppliers, "_score").map(({ id }) => id),
    ["2"],
  );
  assert.deepEqual(
    filterSuppliers(suppliers, String.raw`\slash`).map(({ id }) => id),
    ["3"],
  );
  assert.deepEqual(filterSuppliers(suppliers, "%_\\").map(({ id }) => id), []);
});

test("supplier active filters and selectors preserve only a current inactive value", () => {
  const suppliers = [
    { id: "active", supplier_name: "Active Foods", active: true },
    { id: "inactive", supplier_name: "Old Foods", active: false },
  ];

  assert.deepEqual(
    filterSuppliers(suppliers, "", "active").map(({ id }) => id),
    ["active"],
  );
  assert.deepEqual(
    filterSuppliers(suppliers, "", "inactive").map(({ id }) => id),
    ["inactive"],
  );
  assert.deepEqual(
    supplierOptionsForSelection(suppliers).map(({ id }) => id),
    ["active"],
  );
  assert.deepEqual(
    supplierOptionsForSelection(suppliers, suppliers[1]).map(({ id }) => id),
    ["active", "inactive"],
  );
  assert.equal(
    supplierOptionsForSelection(suppliers, "Legacy Name")[1].supplier_name,
    "Legacy Name",
  );
});

test("Supplier Setup reuses access_product_setup permission enforcement", () => {
  assert.equal(
    canManageSupplierSetup({
      role: "Staff",
      permissions: { access_product_setup: true },
    }),
    true,
  );
  assert.equal(
    canManageSupplierSetup({
      role: "Staff",
      permissions: { access_accounts: true },
    }),
    false,
  );
  assert.equal(canManageSupplierSetup({ role: "Customer" }), false);
});

test("Supplier Setup migration extends the canonical suppliers table and ID", () => {
  assert.match(migrationSql, /alter table public\.suppliers/i);
  assert.match(migrationSql, /public\.suppliers\.id uuid/i);
  for (const column of [
    "company_legal_name",
    "vat_number",
    "address_line_1",
    "address_line_2",
    "city",
    "postcode",
    "country",
    "default_payment_method",
    "bank_payment_reference",
  ]) {
    assert.match(migrationSql, new RegExp(`add column if not exists ${column}`));
  }
  assert.doesNotMatch(migrationSql, /drop\s+(?:table|column)/i);
  assert.doesNotMatch(migrationSql, /create\s+table/i);
  const prerequisiteBlock = migrationSql.slice(
    0,
    migrationSql.indexOf("alter table public.suppliers"),
  );
  assert.doesNotMatch(prerequisiteBlock, /\('vat_number'\)|\('contact_number'\)/);
  assert.doesNotMatch(migrationSql, /\bcontact_number\b|\bcontact_person\b/);
  assert.match(migrationSql, /\bcontact_name\b/);
  assert.match(migrationSql, /\bvat_registered\b/);
});

test("Supplier Setup RPCs require FC session permission and block direct writes", () => {
  for (const rpc of [
    "fc_list_suppliers",
    "fc_upsert_supplier",
    "fc_set_supplier_active",
  ]) {
    assert.match(migrationSql, new RegExp(`function public\\.${rpc}`));
  }
  assert.ok(
    (
      migrationSql.match(
        /fc_require_session_permission\([\s\S]*?'access_product_setup'/g,
      ) || []
    ).length >= 3,
  );
  assert.match(
    migrationSql,
    /revoke insert, update, delete on table public\.suppliers[\s\S]*from public, anon, authenticated/i,
  );
});

test("database search treats %, _, and backslash literally", () => {
  const listFunction = migrationSql.slice(
    migrationSql.indexOf("create or replace function public.fc_list_suppliers"),
    migrationSql.indexOf("create or replace function public.fc_upsert_supplier"),
  );
  assert.match(listFunction, /position\(/i);
  assert.doesNotMatch(listFunction, /\bilike\b|\blike\b/i);
});

test("existing supplier selectors remain active-only and preserve edits", () => {
  const productsSource = readFileSync(
    fileURLToPath(new URL("../pages/AdminProducts.jsx", import.meta.url)),
    "utf8",
  );
  const receiptsSource = readFileSync(
    fileURLToPath(
      new URL("../pages/AdminSetup/StockReceipts.jsx", import.meta.url),
    ),
    "utf8",
  );
  const expensesSource = readFileSync(
    fileURLToPath(new URL("../pages/AdminSetup/Expenses.jsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    productsSource,
    /\.from\("suppliers"\)[\s\S]*?\.eq\("active", true\)/,
  );
  assert.match(productsSource, /supplierOptionsForSelection/);
  assert.match(
    receiptsSource,
    /\.from\("suppliers"\)[\s\S]*?\.eq\("active", true\)/,
  );
  assert.match(expensesSource, /supplierOptionsForSelection/);
});
