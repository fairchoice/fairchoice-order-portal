import { createClient } from "@supabase/supabase-js";

import {
  isActiveLegacyPaymentRow,
  mergeWeeklyAccountPaymentRows,
} from "../src/services/weeklyAccountPayments.js";

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || "").trim();
const supabaseKey = String(process.env.VITE_SUPABASE_ANON_KEY || "").trim();
if (!supabaseUrl || !supabaseKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.");
}

const client = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const selectAll = async (table) => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
};

const [canonicalPayments, legacyPayments] = await Promise.all([
  selectAll("customer_payments"),
  selectAll("customer_ledger"),
]);
const compatibilityViewResult = await client
  .from("v_total_collection_payments")
  .select("canonical_payment_key")
  .limit(1);

const combined = mergeWeeklyAccountPaymentRows({
  canonicalPayments,
  legacyPayments,
});
const canonicalRows = combined.filter((row) => !row.is_legacy);
const legacyRows = combined.filter((row) => row.is_legacy);
const uniquePaymentKeys = new Set(
  combined.map((row) => row.canonical_payment_key || row.id)
);
const activeLegacyCount = legacyPayments.filter(isActiveLegacyPaymentRow).length;
const amount = (rows) =>
  rows.reduce((sum, row) => sum + Number(row.payment_amount || row.amount || 0), 0);

const report = {
  compatibilityViewDeployed: !compatibilityViewResult.error,
  physicalCanonicalRows: canonicalPayments.length,
  physicalLegacyRows: legacyPayments.length,
  validLegacyCandidates: activeLegacyCount,
  includedCanonicalPayments: new Set(
    canonicalRows.map((row) => row.canonical_payment_key)
  ).size,
  includedLegacyOnlyPayments: legacyRows.length,
  suppressedLegacyDuplicates: activeLegacyCount - legacyRows.length,
  combinedUniquePayments: uniquePaymentKeys.size,
  canonicalAmount: Number(amount(canonicalRows).toFixed(2)),
  legacyOnlyAmount: Number(amount(legacyRows).toFixed(2)),
  combinedAmount: Number(amount(combined).toFixed(2)),
};

console.table(report);
if (compatibilityViewResult.error) {
  console.warn(
    `v_total_collection_payments is not deployed yet: ${compatibilityViewResult.error.message}`
  );
}
if (legacyRows.length) {
  console.table(
    legacyRows.map((row) => ({
      source_record_id: row.source_record_id,
      customer: row.customer_name,
      reference: row.invoice_no || row.order_number,
      payment_date: row.payment_date || row.created_at,
      amount: row.payment_amount,
      collection_type: row.collection_type,
    }))
  );
}
