import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findMatchingReturn } from "./returnDuplicateDetection.js";

const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260812090000_atomic_customer_return_approval.sql", import.meta.url),
  "utf8"
);
const service = fs.readFileSync(new URL("./centralReturnEngine.js", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../pages/AdminSetup/ReturnsPortal.jsx", import.meta.url), "utf8");
const invoiceEngine = fs.readFileSync(new URL("./centralInvoiceEngine.js", import.meta.url), "utf8");

test("return permissions are explicit and enforced by separate RPCs", () => {
  for (const permission of ["returns.view", "returns.approve", "returns.reverse", "returns.reconcile"]) {
    assert.match(migration, new RegExp(permission.replace(".", "\\.")));
  }
  assert.match(migration, /fc_approve_customer_return_v1[\s\S]*fc_require_session_permission\(p_username, p_session_token, 'returns\.approve'\)/);
  assert.match(migration, /fc_reverse_customer_return_v1[\s\S]*fc_require_session_permission\(p_username,p_session_token,'returns\.reverse'\)/);
  assert.match(migration, /FC role denied: returns\.approve/);
  assert.match(migration, /FC role denied: returns\.reverse/);
  assert.match(migration, /FC role denied: returns\.reconcile/);
});

test("approval locks the row and accepts only Pending Warehouse Confirmation", () => {
  assert.match(migration, /from public\.customer_returns[\s\S]*where id = p_return_id[\s\S]*for update/);
  assert.match(migration, /v_return\.status <> 'Pending Warehouse Confirmation'/);
  assert.doesNotMatch(migration, /v_return\.status\s+in\s*\([^)]*Pending/i);
});

test("one return creates one canonical customer credit with stable source identity", () => {
  assert.match(migration, /'CUSTOMER_RETURN', v_return\.id::text, 'CREDIT'/);
  assert.match(migration, /v_amount, 0, v_amount/);
  assert.match(migration, /on conflict \(source_type, source_id\) do nothing/);
  assert.match(migration, /'transaction_subtype','CREDIT_NOTE'.*'raw_type','RETURN_CREDIT'/s);
});

test("canonical return metadata preserves account branch amount reference and order", () => {
  for (const field of ["return_id", "return_number", "order_id", "order_number", "customer_account_id", "customer_branch_id", "approved_amount", "approved_quantity"]) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.match(migration, /v_return\.return_number/);
  assert.match(migration, /coalesce\(v_return\.customer_branch_id,v_return\.branch_id\)/);
});

test("retry approval is idempotent and conflicting approved state fails closed", () => {
  assert.match(migration, /if v_return\.status = 'Confirmed'/);
  assert.match(migration, /'duplicate', true/);
  assert.match(migration, /missing its expected financial effect; reconciliation is required/);
  assert.match(migration, /Existing return ledger effect conflicts/);
});

test("legacy compatibility is linked once and cannot double count", () => {
  assert.match(migration, /customer_ledger_one_return_credit_idx/);
  assert.match(migration, /customer_return_id,\s*canonical_financial_transaction_id/);
  assert.match(migration, /transaction_type = 'RETURN_CREDIT'/);
  assert.match(migration, /CUSTOMER_RETURN_COMPATIBILITY/);
});

test("approval status changes only after canonical and compatibility writes", () => {
  const canonicalAt = migration.indexOf("insert into public.financial_transactions");
  const legacyAt = migration.indexOf("insert into public.customer_ledger");
  const statusAt = migration.indexOf("update public.customer_returns\n  set status = 'Confirmed'");
  assert.ok(canonicalAt >= 0 && legacyAt > canonicalAt && statusAt > legacyAt);
});

test("approval and reversal are audited without stock mutations", () => {
  assert.match(migration, /insert into public\.financial_audit_log/);
  assert.match(migration, /'APPROVE','CUSTOMER_RETURN'/);
  assert.match(migration, /'REVERSE','CUSTOMER_RETURN'/);
  assert.doesNotMatch(migration, /insert into public\.stock_movements/i);
  assert.doesNotMatch(migration, /update public\.product_location_stock/i);
});

test("reversal preserves original credit and creates one opposite debit", () => {
  assert.match(migration, /'CUSTOMER_RETURN_REVERSAL',v_return\.id::text,'ADJUSTMENT'/);
  assert.match(migration, /v_original\.amount,v_original\.amount,0/);
  assert.doesNotMatch(migration, /delete from public\.financial_transactions/i);
  assert.match(migration, /Original canonical return credit is missing/);
});

test("second reversal and missing reason are rejected", () => {
  assert.match(migration, /Reversal reason is required/);
  assert.match(migration, /Return approval has already been reversed/);
  assert.match(migration, /A reversal transaction already exists/);
});

test("reversed return cannot be reapproved implicitly", () => {
  assert.match(migration, /v_return\.status <> 'Pending Warehouse Confirmation'/);
  assert.match(migration, /status='Reversed'/);
});

test("client approval uses only the secured RPC and has no unsafe fallback", () => {
  const approval = service.match(/export async function confirmReturnCredit[\s\S]*?\n}\n\nexport async function reverseReturnApproval/)?.[0] || "";
  assert.match(approval, /supabase\.rpc\("fc_approve_customer_return_v1"/);
  assert.match(approval, /Secure Return Approval service is not installed/);
  assert.doesNotMatch(approval, /\.from\("customer_ledger"\)/);
  assert.doesNotMatch(approval, /\.from\("customer_returns"\)\.update/);
});

test("direct browser status and financial transitions are rejected", () => {
  assert.match(migration, /fc_guard_customer_return_financial_transition_v1/);
  assert.match(migration, /current_user in \('anon','authenticated'\)/);
  assert.match(migration, /Return approval and reversal must use the secured Returns service/);
});

test("UI requires explicit financial disposition and provides duplicate click lock", () => {
  assert.match(portal, /Select financial effect/);
  assert.match(portal, /CUSTOMER_CREDIT/);
  assert.match(portal, /NO_CREDIT/);
  assert.match(portal, /approvalLocks\.current\.has/);
  assert.match(portal, /Confirm Approval/);
  assert.match(portal, /Approving\.\.\./);
});

test("UI reversal requires a reason and explains preserved history", () => {
  assert.match(portal, /Reverse Approval/);
  assert.match(portal, /Reason for reversal \(required\)/);
  assert.match(portal, /original credit will remain in financial history/i);
  assert.match(portal, /disabled=\{busy \|\| !state\.reason\.trim\(\)\}/);
});

test("stock effect is explicitly left pending", () => {
  assert.match(portal, /Stock Effect:<\/b> Pending \/ Not processed/);
  assert.match(portal, /Stock Effect<\/b><span>Pending \/ Not processed/);
});

test("same-name customers are scoped by account ID before name fallback", () => {
  const start = invoiceEngine.indexOf("export async function allocateCustomerPaymentToInvoices");
  const end = invoiceEngine.indexOf("const isDeliveredInvoiceStatus", start);
  const functionSource = invoiceEngine.slice(start, end);
  assert.match(functionSource, /if \(customerAccountId\)[\s\S]*eq\("customer_account_id", customerAccountId\)[\s\S]*else if \(customerName\)/);
});

test("strong duplicate helper matches order account type products and quantities", () => {
  const base = {
    order: { id: "order-1", customerAccountId: "account-1" },
    returnType: "Customer Rejected",
    items: [{ product_id: "p1", qty: 3 }],
  };
  const candidate = { id: "return-1", order_id: "order-1", customer_account_id: "account-1", return_type: "Customer Rejected", status: "Confirmed", customer_return_items: [{ product_id: "p1", qty: 3 }] };
  assert.equal(findMatchingReturn({ ...base, existingReturns: [candidate] })?.id, "return-1");
  assert.equal(findMatchingReturn({ ...base, existingReturns: [{ ...candidate, customer_account_id: "account-2" }] }), null);
  assert.equal(findMatchingReturn({ ...base, existingReturns: [{ ...candidate, customer_return_items: [{ product_id: "p1", qty: 2 }] }] }), null);
});

test("duplicate return warning remains overridable only after a strong match", () => {
  assert.match(service, /MATCHING_RETURN_EXISTS/);
  assert.match(service, /allowDuplicate = false/);
  assert.match(service, /loadPotentialDuplicateReturns/);
});

test("read-only reconciliation exposes all required classifications", () => {
  for (const status of ["MATCHED", "LEGACY_CREDIT_ONLY", "MISSING_LEDGER", "DUPLICATE_RETURN", "DUPLICATE_LEDGER", "REVERSED", "NO_FINANCIAL_EFFECT", "NEEDS_REVIEW"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /fc_list_customer_return_reconciliation_v1/);
  assert.doesNotMatch(migration.match(/fc_list_customer_return_reconciliation_v1[\s\S]*?\$\$;/)?.[0] || "", /\b(update|insert|delete)\s+public\./i);
});

test("migration is transactional forward-only and contains no historical backfill", () => {
  assert.match(migration, /^--[\s\S]*\nbegin;/);
  assert.match(migration, /commit;\s*$/);
  assert.doesNotMatch(migration, /RET-1786452940927|RET-1786452918969/);
  assert.doesNotMatch(migration, /delete from public\.customer_returns/i);
});

test("RPC execution is restricted to application invocation roles", () => {
  assert.match(migration, /revoke all on function public\.fc_approve_customer_return_v1[\s\S]*from public/);
  assert.match(migration, /grant execute on function public\.fc_approve_customer_return_v1[\s\S]*to anon,authenticated/);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public/);
});
