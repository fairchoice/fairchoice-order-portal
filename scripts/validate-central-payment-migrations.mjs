import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const migrationFiles = [
  "supabase/migrations/20260711123000_central_payment_credit_foundation.sql",
  "supabase/migrations/20260711124500_central_payment_credit_rpc_and_compatibility.sql",
  "supabase/migrations/20260711125500_central_payment_rpc_security_and_consistency.sql",
  "supabase/migrations/20260714120000_owner_central_payment_security.sql",
  "supabase/migrations/20260715120000_central_payment_final_requirements.sql",
  "supabase/migrations/20260723120000_canonical_payment_writer_and_ledger_sync.sql",
  "supabase/migrations/20260723121000_block_direct_customer_ledger_payment_writes.sql",
  "supabase/migrations/20260723122000_legacy_customer_payment_reconciliation.sql",
];

const requiredAllocationColumns = [
  "payment_id",
  "invoice_reference",
  "invoice_source_id",
  "allocated_amount",
  "allocation_type",
  "status",
  "created_by",
  "created_at",
  "allocated_at",
  "updated_at",
];

const readMigration = (file) => fs.readFileSync(file, "utf8");

function collectAllocationColumns(sqlText) {
  const columns = new Set();
  const createMatch = sqlText.match(
    /create\s+table\s+if\s+not\s+exists\s+public\.customer_payment_allocations\s*\(([\s\S]*?)\n\);/i
  );

  if (createMatch) {
    for (const line of createMatch[1].split(/\r?\n/)) {
      const match = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
      if (match && !["constraint", "primary", "foreign", "unique", "check"].includes(match[1])) {
        columns.add(match[1]);
      }
    }
  }

  const alterBlocks = sqlText.matchAll(
    /alter\s+table\s+public\.customer_payment_allocations\s+([\s\S]*?);/gi
  );
  for (const block of alterBlocks) {
    for (const match of block[1].matchAll(/add\s+column\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)/gi)) {
      columns.add(match[1]);
    }
  }

  return columns;
}

function assertStaticMigrationContract() {
  const combinedSql = migrationFiles.map(readMigration).join("\n\n");
  const allocationColumns = collectAllocationColumns(combinedSql);

  for (const column of requiredAllocationColumns) {
    assert.ok(
      allocationColumns.has(column),
      `customer_payment_allocations.${column} must exist after migrations`
    );
  }

  const rpcAllocationInsert = combinedSql.match(
    /insert\s+into\s+public\.customer_payment_allocations\s*\(([\s\S]*?)\)\s*values/i
  );
  assert.ok(rpcAllocationInsert, "post_central_payment must insert allocation rows");

  const insertedColumns = rpcAllocationInsert[1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  for (const column of insertedColumns) {
    assert.ok(
      allocationColumns.has(column),
      `RPC inserts customer_payment_allocations.${column}, but migration does not define it`
    );
  }

  for (const requiredSnippet of [
    "fairchoice_require_financial_permission('post_payment')",
    "fairchoice_require_financial_permission('super_admin')",
    "revoke all on function public.post_central_payment",
    "grant execute on function public.post_central_payment",
    "void_central_payment",
    "customer_payments_idempotency_scope_idx",
    "customer_payment_allocations_payment_id_fk",
    "post_owner_central_transaction",
    "confirm_owner_bank_transfer",
    "OWNER_DISCOUNT_CREATED",
    "BANK_TRANSFER_RECORDED_PENDING",
    "BANK_TRANSFER_CONFIRMED",
    "owner_financial_security",
    "drop table if exists public.owner_financial_security",
    "central_payment_archive",
    "central_payment_lifecycle_audit",
    "recalculate_central_payment_fifo",
    "list_central_payment_records",
    "edit_central_payment",
    "remove_central_payment",
    "restore_central_payment",
    "permanently_delete_central_payment",
    "limit 2 offset v_offset",
    "post_canonical_customer_payment_v1",
    "sync_canonical_payment_to_customer_ledger_v1",
    "reject_direct_customer_ledger_payment_write_v1",
    "reconcile_customer_ledger_payments_v2",
    "apply_reviewed_customer_ledger_payment_migration_v1",
    "customer_payment_legacy_migrations",
    "legacy-customer-ledger:",
    "PREVIOUS_BALANCE_COLLECTION",
  ]) {
    assert.ok(
      combinedSql.includes(requiredSnippet),
      `Expected migration SQL to include ${requiredSnippet}`
    );
  }

  console.log("Static migration contract validation passed.");
}

function commandExists(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "command", [command], {
    shell: process.platform !== "win32",
    stdio: "ignore",
  });
  return result.status === 0;
}

function runPsql(databaseUrl, args, input) {
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    input,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        "psql validation failed.",
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n")
    );
  }

  return result.stdout;
}

function buildLiveValidationSql() {
  return `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end;
$$;
`;
}

function buildSmokeTestSql() {
  return `
select set_config('request.jwt.claims', '{"email":"admin@example.com"}', true);

insert into public.staff_users (staff_name, email, role, permissions, active)
values ('Integration Admin', 'admin@example.com', 'Super Admin', '{"access_accounts":true}'::jsonb, true)
on conflict do nothing;

do $$
declare
  v_source uuid := gen_random_uuid();
  v_destination uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_payment_result jsonb;
  v_duplicate_result jsonb;
  v_preview jsonb;
  v_apply jsonb;
begin
  insert into public.customer_accounts (id, account_name, active, credit_limit)
  values
    (v_source, 'Integration Source', true, 1000),
    (v_destination, 'Integration Destination', true, 1000);

  insert into public.customer_branches (id, customer_account_id, branch_name, active)
  values (v_branch, v_source, 'Branch A', true);

  insert into public.customer_invoices (
    customer_account_id,
    customer_branch_id,
    invoice_number,
    invoice_date,
    invoice_total,
    status
  )
  values (v_source, v_branch, 'INT-INV-1', now(), 100, 'ISSUED');

  v_payment_result := public.post_central_payment(
    v_source,
    v_branch,
    'INT-PAY-1',
    now(),
    75,
    'Cash',
    'Tester',
    'Integration payment',
    'integration-key-1',
    'client-supplied-actor-ignored',
    '[{"invoiceReference":"INT-INV-1","invoiceSourceId":"integration","allocatedAmount":75,"customerBranchId":"' || v_branch || '"}]'::jsonb
  );

  if coalesce((v_payment_result->>'duplicate')::boolean, false) then
    raise exception 'First payment post was unexpectedly treated as duplicate.';
  end if;

  if (select count(*) from public.customer_payments where customer_account_id = v_source) <> 1 then
    raise exception 'Expected one payment row.';
  end if;

  if (select count(*) from public.customer_payment_allocations where customer_account_id = v_source) <> 1 then
    raise exception 'Expected one allocation row.';
  end if;

  v_duplicate_result := public.post_central_payment(
    v_source,
    v_branch,
    'INT-PAY-1',
    now(),
    75,
    'Cash',
    'Tester',
    'Duplicate payment',
    'integration-key-1',
    'client-supplied-actor-ignored',
    '[]'::jsonb
  );

  if not coalesce((v_duplicate_result->>'duplicate')::boolean, false) then
    raise exception 'Duplicate idempotency handling failed.';
  end if;

  v_preview := public.preview_branch_separation(v_source, v_branch, v_destination);
  if (v_preview->'counts'->>'invoices')::int <> 1 then
    raise exception 'Branch separation preview did not include invoice count.';
  end if;

  v_apply := public.apply_branch_separation(
    v_source,
    v_branch,
    v_destination,
    'Integration branch separation',
    'client-supplied-actor-ignored'
  );

  if (select customer_account_id from public.customer_branches where id = v_branch) <> v_destination then
    raise exception 'Branch row was not moved to destination customer.';
  end if;

  if exists (
    select 1 from public.customer_payment_allocations
    where customer_account_id = v_source
      and customer_branch_id = v_branch
  ) then
    raise exception 'Payment allocations remained on source customer.';
  end if;
end;
$$;
`;
}

function runLiveValidationIfAvailable() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    console.log("Live migration validation skipped: TEST_DATABASE_URL is not set.");
    return;
  }

  if (!commandExists("psql")) {
    console.log("Live migration validation skipped: psql is not installed.");
    return;
  }

  runPsql(databaseUrl, [], buildLiveValidationSql());

  for (const file of migrationFiles) {
    runPsql(databaseUrl, ["-f", path.resolve(file)]);
  }

  const smokeSql = buildSmokeTestSql();
  const smokeFile = path.join(os.tmpdir(), `central-payment-migration-smoke-${Date.now()}.sql`);
  fs.writeFileSync(smokeFile, smokeSql);
  try {
    runPsql(databaseUrl, ["-f", smokeFile]);
  } finally {
    fs.rmSync(smokeFile, { force: true });
  }

  console.log("Live migration integration validation passed.");
}

assertStaticMigrationContract();
runLiveValidationIfAvailable();
