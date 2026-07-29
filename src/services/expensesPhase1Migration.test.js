import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260729130000_secure_phase1_expenses.sql",
    import.meta.url,
  ),
  "utf8",
);
const serviceSource = fs.readFileSync(
  new URL("./expenses.js", import.meta.url),
  "utf8",
);
const uiSource = fs.readFileSync(
  new URL("../pages/AdminSetup/Expenses.jsx", import.meta.url),
  "utf8",
);

function functionSource(functionName) {
  const start = migrationSource.indexOf(
    `create or replace function public.${functionName}(`,
  );
  assert.notEqual(start, -1, `${functionName} must exist`);
  const next = migrationSource.indexOf(
    "\ncreate or replace function public.",
    start + 1,
  );
  return migrationSource.slice(start, next === -1 ? undefined : next);
}

test("Phase 1 migration is forward-only, transactional, and reloads PostgREST last", () => {
  assert.match(migrationSource, /^\s*--[\s\S]*\nbegin;/);
  assert.doesNotMatch(migrationSource, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migrationSource, /\btruncate\b/i);
  assert.doesNotMatch(migrationSource, /\bdelete\s+from\b/i);
  assert.match(
    migrationSource,
    /commit;\s*\n\s*notify pgrst, 'reload schema';\s*$/,
  );
});

test("migration checks the FC identity, supplier, audit, and canonical ledger contracts", () => {
  for (const prerequisite of [
    "staff_users",
    "login_users",
    "suppliers",
    "fc_permissions",
    "fc_staff_permissions",
    "fc_login_sessions",
    "financial_transactions",
    "financial_transaction_archive",
    "financial_ledger_events",
    "financial_audit_log",
  ]) {
    assert.match(migrationSource, new RegExp(`public\\.${prerequisite}`));
  }
  assert.match(
    migrationSource,
    /fc_require_session_permission\(text,text,text\)/,
  );
  assert.match(
    migrationSource,
    /unique Global Ledger source_type\/source_id key/,
  );
});

test("expense financial tables have RLS and no direct browser privileges", () => {
  for (const tableName of ["expense_types", "business_payouts"]) {
    assert.match(
      migrationSource,
      new RegExp(`alter table public\\.${tableName} enable row level security`),
    );
    assert.match(
      migrationSource,
      new RegExp(
        `revoke all on table public\\.${tableName}\\s+from public, anon, authenticated`,
      ),
    );
  }
  assert.doesNotMatch(
    migrationSource,
    /create policy[\s\S]{0,300}using\s*\(\s*true\s*\)/i,
  );
});

test("every Phase 1 RPC validates an FC session and has restricted execution", () => {
  const functions = [
    "fc_list_expense_types",
    "fc_list_business_payouts",
    "fc_create_business_payout",
    "fc_update_business_payout",
    "fc_submit_business_payout",
    "fc_approve_business_payout",
    "fc_reject_business_payout",
    "fc_void_business_payout",
    "fc_upsert_expense_type",
  ];

  for (const functionName of functions) {
    const source = functionSource(functionName);
    assert.match(source, /security definer\s+set search_path = public/);
    assert.match(source, /public\.fc_require_session_permission\(/);
    assert.match(
      migrationSource,
      new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated`,
      ),
    );
    assert.match(
      migrationSource,
      new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]*?to anon, authenticated`,
      ),
    );
  }
});

test("creation derives the recorder from the validated session and rejects impersonation", () => {
  const source = functionSource("fc_create_business_payout");
  assert.match(source, /'expenses\.create'/);
  assert.match(source, /recorded_by_staff_id[\s\S]*v_actor\.staff_id/);
  assert.doesNotMatch(source, /p_recorded_by_staff_id/);
  assert.match(source, /to_jsonb\(v_row\)/);
  assert.match(source, /actor_staff_id[\s\S]*v_actor\.staff_id/);
});

test("approval is permission-gated, locked, and posts one canonical money-out effect", () => {
  const source = functionSource("fc_approve_business_payout");
  assert.match(source, /'expenses\.approve'/);
  assert.match(source, /where id = p_payout_id\s+for update/);
  assert.match(source, /transaction_type[\s\S]*'EXPENSE'/);
  assert.match(source, /'direction', 'OUT'/);
  assert.match(source, /'business_payouts'[\s\S]*v_before\.id::text/);
  assert.match(source, /debit_amount[\s\S]*v_before\.amount/);
  assert.match(source, /credit_amount[\s\S]*0/);
  assert.match(
    source,
    /if v_before\.status = 'POSTED'[\s\S]*matching active ledger effect/,
  );
  assert.match(
    migrationSource,
    /business_payouts_ledger_transaction_uidx[\s\S]*where ledger_transaction_id is not null/,
  );
  assert.doesNotMatch(
    migrationSource,
    /insert into public\.fc_staff_permissions/i,
  );
});

test("void archives the active ledger effect and keeps both ledger and audit history", () => {
  const source = functionSource("fc_void_business_payout");
  assert.match(source, /'expenses\.void'/);
  assert.match(source, /public\.archive_financial_transactions\(/);
  assert.match(source, /status = 'VOIDED'/);
  assert.match(source, /'VOID', 'BUSINESS_PAYOUT'/);
  assert.doesNotMatch(source, /\bdelete\b/i);
});

test("expense types are deactivated through a managed RPC and cannot be deleted", () => {
  const source = functionSource("fc_upsert_expense_type");
  assert.match(source, /'expense_types\.manage'/);
  assert.match(source, /active = coalesce\(p_active, true\)/);
  assert.doesNotMatch(source, /\bdelete\b/i);
  assert.match(
    migrationSource,
    /business_payouts_expense_type_fk[\s\S]*on delete restrict/,
  );
});

test("inactive types and invalid optional suppliers are rejected", () => {
  for (const name of [
    "fc_create_business_payout",
    "fc_update_business_payout",
  ]) {
    const source = functionSource(name);
    assert.match(
      source,
      /public\.expense_types[\s\S]*active is true/,
    );
    assert.match(
      source,
      /p_supplier_id is not null[\s\S]*public\.suppliers[\s\S]*active, true/,
    );
  }
  assert.match(
    migrationSource,
    /p_supplier_id uuid/,
  );
});

test("Phase 1 does not create excluded supplier-credit, debit, messaging, PO, or weekly objects", () => {
  assert.doesNotMatch(
    migrationSource,
    /create\s+(?:table|view|function|trigger)\s+(?:if not exists\s+)?public\.(?:supplier_credit|direct_debit|whatsapp|purchase_order|weekly_account)/i,
  );
});

test("Expenses service and UI use RPC writes and expose the approval workflow", () => {
  for (const rpcName of [
    "fc_create_business_payout",
    "fc_update_business_payout",
    "fc_submit_business_payout",
    "fc_approve_business_payout",
    "fc_reject_business_payout",
    "fc_void_business_payout",
  ]) {
    assert.match(serviceSource, new RegExp(rpcName));
  }
  assert.doesNotMatch(
    serviceSource,
    /\.from\(["']business_payouts["']\)\s*\.(?:insert|update|delete)/,
  );
  assert.match(serviceSource, /p_session_token/);
  assert.doesNotMatch(serviceSource, /p_recorded_by_staff_id/);
  assert.match(uiSource, /Save and submit/);
  assert.match(uiSource, /approvePayout/);
  assert.match(uiSource, /voidPayout/);
  assert.doesNotMatch(uiSource, /Direct Debit|Supplier Credit|WhatsApp|Weekly Account/);
});
