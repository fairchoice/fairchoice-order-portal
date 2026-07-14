import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveLegacyCompatibilityRows } from "../utils/centralPaymentCalculations.js";

const serviceSource = fs.readFileSync(
  new URL("./centralPaymentService.js", import.meta.url),
  "utf8"
);

function getFunctionSource(name) {
  const start = serviceSource.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);

  const bodyMatch = serviceSource.slice(start).match(/\)\s*\{/);
  assert.ok(bodyMatch, `${name} should have a function body`);
  const openBrace = start + bodyMatch.index + bodyMatch[0].lastIndexOf("{");
  let depth = 0;
  for (let index = openBrace; index < serviceSource.length; index += 1) {
    const char = serviceSource[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return serviceSource.slice(start, index + 1);
  }

  throw new Error(`Could not parse ${name}`);
}

test("legacy payments fill missing history when new invoices exist", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "new-invoice", invoice_number: "INV-1" }],
    payments: [],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["new-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["legacy-payment"]);
});

test("legacy invoices fill missing history when new payments exist", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [],
    payments: [{ id: "new-payment", payment_reference: "PAY-1" }],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["legacy-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["new-payment"]);
});

test("equivalent legacy and new records do not duplicate", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "new-invoice", invoice_number: "INV-1" }],
    payments: [{ id: "new-payment", payment_reference: "PAY-1" }],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["new-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["new-payment"]);
});

test("protected owner payment RPC fails closed without direct browser writes", () => {
  const source = getFunctionSource("createCentralPayment");

  assert.match(source, /supabase\.rpc\("post_owner_central_transaction"/);
  assert.match(source, /Protected Central Payment is not installed/);
  assert.doesNotMatch(source, /\.from\("customer_payments"\)\s*\.\s*insert/);
  assert.doesNotMatch(source, /\.from\("customer_payment_allocations"\)\s*\.\s*insert/);
  assert.doesNotMatch(source, /\.from\("financial_audit_log"\)/);
  assert.doesNotMatch(source, /\.update\(\{\s*status:\s*"VOIDED"/);
});

test("authorization failure from payment posting is surfaced", () => {
  const source = getFunctionSource("createCentralPayment");

  assert.match(source, /if \(isMissingRpcError\(error\)\)/);
  assert.match(source, /throw error;/);
  assert.doesNotMatch(source, /42501.*Central Payment service is unavailable/s);
});

test("missing void_central_payment RPC fails closed without direct updates", () => {
  const source = getFunctionSource("voidCentralPayment");

  assert.match(source, /supabase\.rpc\("void_central_payment"/);
  assert.match(source, /paymentVoidUnavailableMessage/);
  assert.match(serviceSource, /Payment void service is unavailable/);
  assert.doesNotMatch(source, /\.from\("customer_payments"\)/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /financial_audit_log/);
});

test("authorization failure from voiding is surfaced", () => {
  const source = getFunctionSource("voidCentralPayment");

  assert.match(source, /if \(isMissingRpcError\(rpcError\)\)/);
  assert.match(source, /throw rpcError;/);
  assert.doesNotMatch(source, /42501.*Payment void service is unavailable/s);
});

test("applyBranchSeparation remains RPC-only and fails closed when unavailable", () => {
  const source = getFunctionSource("applyBranchSeparation");

  assert.match(source, /supabase\.rpc\("apply_branch_separation"/);
  assert.match(source, /branchSeparationUnavailableMessage/);
  assert.match(serviceSource, /Branch Separation service is unavailable/);
  assert.doesNotMatch(source, /\.from\(/);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
});

test("read-only branch preview fallback is marked local and performs no writes", () => {
  const source = getFunctionSource("previewBranchSeparation");

  assert.match(source, /local_read_only_preview:\s*true/);
  assert.match(source, /applyRpcAvailable:\s*false/);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
});

test("missing RPC detection does not classify authorization failures as unavailable services", () => {
  assert.match(serviceSource, /code === "42883"/);
  assert.match(serviceSource, /code === "PGRST202"/);
  assert.doesNotMatch(serviceSource, /code === "42501"/);
  assert.doesNotMatch(serviceSource, /code === "PGRST301"/);
});

test("bank confirmation is owner RPC-only and sends allocation preview", () => {
  const source = getFunctionSource("confirmOwnerBankTransfer");

  assert.match(source, /supabase\.rpc\("confirm_owner_bank_transfer"/);
  assert.match(source, /p_owner_username:\s*"nisstaj_admin"/);
  assert.match(source, /p_allocations:\s*preview\.allocations/);
  assert.match(source, /bank verification note is compulsory/i);
  assert.doesNotMatch(source, /\.from\("customer_payments"\).*\.update/s);
  assert.doesNotMatch(source, /\.from\("customer_payment_allocations"\).*\.insert/s);
});
