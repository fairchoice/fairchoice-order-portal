import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getCentralPaymentSections,
  isOwnerUser,
  runOwnerFinancialRequest,
} from "./ownerFinancialSecurity.js";

const centralPaymentSource = fs.readFileSync(
  new URL("../pages/AdminSetup/CentralPayment.jsx", import.meta.url),
  "utf8",
);
const centralPaymentServiceSource = fs.readFileSync(
  new URL("./centralPaymentService.js", import.meta.url),
  "utf8",
);
const ownerHistoryMigrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260730100000_owner_central_payment_history_access.sql",
    import.meta.url,
  ),
  "utf8",
);
const customerAccountFoundationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260711123000_central_payment_credit_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);

test("nisstaj_admin identity is normalized through the shared owner check", () => {
  assert.equal(isOwnerUser({ username: " nisstaj_admin " }), true);
  assert.equal(isOwnerUser({ username: "NISSTAJ_ADMIN" }), true);
  assert.equal(isOwnerUser({ username: "other_admin" }), false);
  assert.equal(isOwnerUser({ role: "Super Admin" }), false);
});

test("Payment History, Payment Archive, and Global Ledger tabs are owner-only", () => {
  assert.match(
    centralPaymentSource,
    /getCentralPaymentSections\(currentUser\)\.map/,
  );
  assert.match(
    centralPaymentSource,
    /\{isNisstajAdmin && activeTab === "history" && \([\s\S]*?<PaymentRecordsPanel/,
  );
  assert.match(
    centralPaymentSource,
    /\{isNisstajAdmin && activeTab === "archive" && \([\s\S]*?<PaymentRecordsPanel[\s\S]*?archived/,
  );
  assert.match(
    centralPaymentSource,
    /\{isNisstajAdmin && activeTab === "ledger" && \([\s\S]*?<GlobalLedgerPanel/,
  );
});

test("non-owners cannot mount or load restricted history panels", () => {
  assert.match(
    centralPaymentSource,
    /const canViewFinancialHistory = isOwnerUser\(currentUser\)/,
  );
  assert.match(
    centralPaymentSource,
    /if \(!canViewFinancialHistory\) return;[\s\S]*listCentralPaymentRecords/,
  );
  assert.match(
    centralPaymentSource,
    /if \(!canViewFinancialHistory\) return null/,
  );
  assert.match(
    centralPaymentServiceSource,
    /if \(!isOwnerUser\(currentUser\)\) \{[\s\S]*Payment History is restricted to nisstaj_admin/,
  );
  assert.match(
    centralPaymentSource,
    /runOwnerFinancialRequest\(currentUser,[\s\S]*listCentralPaymentRecords/,
  );
});

test("owner-only RPC returns only the explicit history response contract", () => {
  const responseObject =
    ownerHistoryMigrationSource.match(
      /select\s+jsonb_build_object\(([\s\S]*?)\n\s{6}\) as row_data,/,
    )?.[1] || "";
  const responseFields = [
    ...responseObject.matchAll(/^\s*'([a-z_]+)',/gm),
  ].map((match) => match[1]);

  assert.deepEqual(responseFields, [
    "id",
    "payment_date",
    "created_at",
    "customer_name",
    "payment_reference",
    "payment_method",
    "paid_by",
    "verification_status",
    "amount",
    "status",
    "price_mode",
    "inc_vat",
    "manager_name",
  ]);
  assert.doesNotMatch(ownerHistoryMigrationSource, /\bto_jsonb\s*\(\s*p\s*\)/i);
  assert.doesNotMatch(ownerHistoryMigrationSource, /\brow_to_json\s*\(\s*p\s*\)/i);
  assert.doesNotMatch(ownerHistoryMigrationSource, /\bselect\s+p\.\*/i);
  assert.doesNotMatch(
    responseFields.join(","),
    /session|token|password|idempotency|metadata/i,
  );
});

test("owner-history customer name uses the real customer_accounts schema", () => {
  const customerAccountsDefinition =
    customerAccountFoundationSource.match(
      /create table if not exists public\.customer_accounts\s*\(([\s\S]*?)\n\);/i,
    )?.[1] || "";

  assert.match(customerAccountsDefinition, /\baccount_name\s+text\s+not null/i);
  assert.doesNotMatch(customerAccountsDefinition, /\bcompany_name\b/i);
  assert.match(
    ownerHistoryMigrationSource,
    /'customer_name',\s*coalesce\(c\.account_name, ''\)/,
  );
  assert.doesNotMatch(ownerHistoryMigrationSource, /\bc\.company_name\b/i);
});

test("owner-only RPC protects all history fields including derived sensitive fields", () => {
  assert.match(centralPaymentSource, />Price Mode</);
  assert.match(centralPaymentSource, />Inc\. VAT</);
  assert.match(centralPaymentSource, />Manager</);
  assert.match(
    centralPaymentSource,
    /const sensitive = getSensitiveFinancialDetails\(payment\)/,
  );
  assert.match(
    centralPaymentSource,
    /const sensitive = getSensitiveFinancialDetails\(row\)/,
  );
  assert.match(
    centralPaymentServiceSource,
    /\.rpc\(\s*"list_owner_central_payment_records_v1"/,
  );
  assert.doesNotMatch(
    centralPaymentServiceSource.match(
      /export async function listCentralPaymentRecords[\s\S]*?export async function editCentralPayment/,
    )?.[0] || "",
    /\.from\("customer_payments"\)/,
  );
  assert.match(
    ownerHistoryMigrationSource,
    /fc_require_session_permission\([\s\S]*'payments\.view'/,
  );
  assert.match(
    ownerHistoryMigrationSource,
    /lower\(trim\(coalesce\(v_actor\.username, ''\)\)\) <> 'nisstaj_admin'/,
  );
  assert.match(ownerHistoryMigrationSource, /using errcode = '42501'/);
});

test("history search escapes percent, underscore, and backslash as literals", () => {
  const escapeLikeLiteral = (value) =>
    String(value)
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");

  assert.equal(escapeLikeLiteral("INV%25"), "INV\\%25");
  assert.equal(escapeLikeLiteral("staff_name"), "staff\\_name");
  assert.equal(escapeLikeLiteral("folder\\reference"), "folder\\\\reference");

  assert.match(
    ownerHistoryMigrationSource,
    /replace\(trim\(p_search\), E'\\\\', E'\\\\\\\\'\)/,
    "backslash must be escaped first",
  );
  assert.match(
    ownerHistoryMigrationSource,
    /replace\([\s\S]*'%',[\s\S]*E'\\\\%'/,
    "percent must be escaped",
  );
  assert.match(
    ownerHistoryMigrationSource,
    /replace\([\s\S]*'_',[\s\S]*E'\\\\_'/,
    "underscore must be escaped",
  );
  assert.match(
    ownerHistoryMigrationSource,
    /ilike v_search_pattern escape E'\\\\'/i,
  );
  for (const searchableField of [
    "payment_reference",
    "account_name",
    "paid_by",
    "collector_name",
    "manager_name",
    "notes",
  ]) {
    assert.match(ownerHistoryMigrationSource, new RegExp(searchableField));
  }
});

test("SECURITY DEFINER function has a restricted path and application-role grants", () => {
  assert.match(
    ownerHistoryMigrationSource,
    /security definer\s+set search_path = pg_catalog, public/i,
  );
  assert.match(
    ownerHistoryMigrationSource,
    /revoke all[\s\S]*from public;/i,
  );
  assert.match(
    ownerHistoryMigrationSource,
    /grant execute[\s\S]*to anon, authenticated;/i,
  );
  assert.doesNotMatch(ownerHistoryMigrationSource, /grant execute[\s\S]*to public;/i);
});

test("owner-history service RPC signature exactly matches the pending migration", () => {
  const functionDeclaration =
    ownerHistoryMigrationSource.match(
      /create or replace function public\.list_owner_central_payment_records_v1\(([\s\S]*?)\)\s*returns jsonb/i,
    )?.[1] || "";
  const migrationParameters = [
    ...functionDeclaration.matchAll(/^\s*(p_[a-z_]+)\s+([a-z]+)(?:\s+default\s+([^\r\n,]+))?/gim),
  ].map((match) => ({
    name: match[1],
    type: match[2].toLowerCase(),
    defaultValue: match[3]?.trim() || null,
  }));
  const listMethod =
    centralPaymentServiceSource.match(
      /export async function listCentralPaymentRecords[\s\S]*?export async function editCentralPayment/,
    )?.[0] || "";
  const rpcArguments =
    listMethod.match(
      /\.rpc\(\s*"list_owner_central_payment_records_v1",\s*\{([\s\S]*?)\}\s*\)/,
    )?.[1] || "";
  const serviceParameterNames = [
    ...rpcArguments.matchAll(/^\s*(p_[a-z_]+):/gim),
  ].map((match) => match[1]);

  assert.deepEqual(migrationParameters, [
    { name: "p_username", type: "text", defaultValue: null },
    { name: "p_session_token", type: "text", defaultValue: null },
    { name: "p_archived", type: "boolean", defaultValue: "false" },
    { name: "p_search", type: "text", defaultValue: "''" },
    { name: "p_method", type: "text", defaultValue: "''" },
    { name: "p_date_from", type: "date", defaultValue: "null" },
    { name: "p_date_to", type: "date", defaultValue: "null" },
    { name: "p_page", type: "integer", defaultValue: "1" },
    { name: "p_page_size", type: "integer", defaultValue: "30" },
  ]);
  assert.deepEqual(
    serviceParameterNames,
    migrationParameters.map(({ name }) => name),
  );
  assert.match(ownerHistoryMigrationSource, /notify pgrst, 'reload schema';/i);
});

test("Payment History reads canonical payments while Weekly Account may add legacy rows", () => {
  assert.match(
    ownerHistoryMigrationSource,
    /from public\.customer_payments p/,
  );
  assert.doesNotMatch(
    ownerHistoryMigrationSource,
    /from public\.customer_ledger\b/,
  );
  assert.match(
    ownerHistoryMigrationSource,
    /case when p_archived then 'VOIDED' else 'POSTED' end/,
  );
  assert.doesNotMatch(
    ownerHistoryMigrationSource,
    /p\.verification_status[\s\S]{0,80}(?:=|in\s*\()/i,
  );
});

test("non-owner runtime policy exposes only Manual Payment and performs zero restricted calls", async () => {
  const ordinaryUser = {
    username: "ordinary_user",
    fc_session_token: "test-token",
    fc_session_expires_at: Date.now() + 60_000,
  };
  const sections = getCentralPaymentSections(ordinaryUser);
  assert.deepEqual(sections, [["manual", "Manual Payment"]]);
  assert.equal(sections.some(([value]) => value === "history"), false);
  assert.equal(sections.some(([value]) => value === "archive"), false);
  assert.equal(sections.some(([value]) => value === "ledger"), false);

  const calls = { history: 0, archive: 0, ledger: 0 };
  await runOwnerFinancialRequest(ordinaryUser, async () => {
    calls.history += 1;
  });
  await runOwnerFinancialRequest(ordinaryUser, async () => {
    calls.archive += 1;
  });
  await runOwnerFinancialRequest(ordinaryUser, async () => {
    calls.ledger += 1;
  });
  assert.deepEqual(calls, { history: 0, archive: 0, ledger: 0 });
});

test("nisstaj_admin runtime policy exposes and loads Payment Archive", async () => {
  const owner = { username: " NISSTAJ_ADMIN " };
  const sections = getCentralPaymentSections(owner);
  assert.deepEqual(
    sections.map(([value]) => value),
    ["manual", "history", "archive", "ledger"],
  );

  let archiveCalls = 0;
  const result = await runOwnerFinancialRequest(owner, async () => {
    archiveCalls += 1;
    return { records: [{ status: "VOIDED" }] };
  });
  assert.equal(archiveCalls, 1);
  assert.deepEqual(result, { records: [{ status: "VOIDED" }] });
});

test("owner-password guidance is removed without changing Manual Payment or EXPENSE", () => {
  assert.doesNotMatch(
    centralPaymentSource,
    /owner password is used only for legacy discounts, bank review/i,
  );
  assert.doesNotMatch(
    centralPaymentSource,
    /unlock the global ledger/i,
  );
  assert.deepEqual(
    getCentralPaymentSections({ username: "ordinary_user" }),
    [["manual", "Manual Payment"]],
  );
  assert.match(centralPaymentSource, /function ManualPaymentPanel/);
  assert.match(
    centralPaymentSource,
    /"ADJUSTMENT", "EXPENSE"/,
  );
});
