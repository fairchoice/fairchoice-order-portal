import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { hasPermission } from "../utils/permissions.js";

const migrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731110000_driver_sales_expense_entry_permissions.sql",
    import.meta.url,
  ),
  "utf8",
);

const backOfficeSource = fs.readFileSync(
  new URL("../pages/AdminSetup/BackOfficeLayout.jsx", import.meta.url),
  "utf8",
);

const entryPermissions = {
  "expenses.view": true,
  "expenses.create": true,
  "expenses.submit": true,
};

test("nisstaj_admin can view and administer expenses", () => {
  const owner = {
    username: "nisstaj_admin",
    role: "Super Admin",
    effective_permissions: { all_access: true },
  };

  for (const permission of [
    "expenses.view",
    "expenses.create",
    "expenses.submit",
    "expenses.approve",
    "expenses.void",
  ]) {
    assert.equal(hasPermission(owner, permission), true);
  }
});

test("Nisstaj_drive can view, create, and submit but cannot approve or void", () => {
  const driver = {
    username: "Nisstaj_drive",
    role: "Driver",
    effective_permissions: entryPermissions,
  };

  assert.equal(hasPermission(driver, "expenses.view"), true);
  assert.equal(hasPermission(driver, "expenses.create"), true);
  assert.equal(hasPermission(driver, "expenses.submit"), true);
  assert.equal(hasPermission(driver, "expenses.approve"), false);
  assert.equal(hasPermission(driver, "expenses.void"), false);
});

test("unrelated users remain denied expense access", () => {
  const unrelated = {
    username: "warehouse_user",
    role: "Warehouse",
    effective_permissions: {
      "payments.collect_cash": true,
    },
  };

  for (const permission of [
    "expenses.view",
    "expenses.create",
    "expenses.submit",
    "expenses.approve",
    "expenses.void",
  ]) {
    assert.equal(hasPermission(unrelated, permission), false);
  }
});

test("migration grants only entry permissions to active linked Driver and Sales Rep staff", () => {
  assert.match(migrationSource, /insert into public\.fc_staff_permissions/i);
  assert.match(
    migrationSource,
    /lower\(trim\(login\.username\)\) = 'nisstaj_drive'/i,
  );
  assert.match(
    migrationSource,
    /login\.active is true[\s\S]*staff\.active is true|staff\.active is true[\s\S]*login\.active is true/i,
  );
  assert.match(
    migrationSource,
    /'driver'[\s\S]*'salesrep'[\s\S]*'salesrepresentative'/i,
  );

  for (const permission of Object.keys(entryPermissions)) {
    assert.match(migrationSource, new RegExp(`'${permission.replace(".", "\\.")}'`));
  }

  assert.doesNotMatch(
    migrationSource,
    /'expenses\.(?:approve|void)'|'all_access'|'permissions\.manage'/i,
  );
  assert.match(
    migrationSource,
    /on conflict \(staff_id, permission_key\)[\s\S]*allowed = excluded\.allowed/i,
  );
});

test("Expenses navigation and page access use expenses.view", () => {
  assert.match(
    backOfficeSource,
    /\{\s*label:\s*"Expenses",\s*page:\s*"expenses",\s*permission:\s*"expenses\.view"\s*\}/,
  );
  assert.match(backOfficeSource, /expenses:\s*"expenses\.view"/);
});
