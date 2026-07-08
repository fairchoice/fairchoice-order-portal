import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    })
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const ORDER_NUMBER = "ORD-1783022404316";
const CUSTOMER_NAME = "Jat Store Ltd";
const CUSTOMER_ACCOUNT_ID = "2b47678a-6482-4c53-ae2b-838ee7f770d5";
const INVOICE_TOTAL = 484.2;
const INVOICE_NET = 403.5;
const INVOICE_VAT = 80.7;
const PAYMENT_LEDGER_ID = 99;

function fail(step, error) {
  if (error) throw new Error(`${step}: ${error.message || JSON.stringify(error)}`);
}

const { data: existingInvoice, error: existingInvoiceError } = await supabase
  .from("customer_ledger")
  .select("*")
  .eq("entry_type", "INVOICE")
  .or(`reference_no.eq.${ORDER_NUMBER},order_number.eq.${ORDER_NUMBER}`)
  .limit(1);
fail("load existing invoice ledger", existingInvoiceError);

if (existingInvoice?.[0]?.id) {
  const { error } = await supabase
    .from("customer_ledger")
    .update({
      customer_name: CUSTOMER_NAME,
      customer_account_id: CUSTOMER_ACCOUNT_ID,
      reference_no: ORDER_NUMBER,
      order_number: ORDER_NUMBER,
      debit: INVOICE_TOTAL,
      credit: 0,
      amount: INVOICE_TOTAL,
      invoice_amount: INVOICE_TOTAL,
      invoice_total: INVOICE_TOTAL,
      paid_amount: INVOICE_TOTAL,
      remaining_amount: 0,
      invoice_status: "PAID",
      description: "Invoice",
      price_mode: "VAT",
      order_price_mode: "VAT",
    })
    .eq("id", existingInvoice[0].id);
  fail("update invoice ledger", error);
} else {
  const { error } = await supabase.from("customer_ledger").insert({
    customer_name: CUSTOMER_NAME,
    customer_account_id: CUSTOMER_ACCOUNT_ID,
    entry_type: "INVOICE",
    transaction_type: "INVOICE",
    reference_no: ORDER_NUMBER,
    order_number: ORDER_NUMBER,
    debit: INVOICE_TOTAL,
    credit: 0,
    amount: INVOICE_TOTAL,
    invoice_amount: INVOICE_TOTAL,
    invoice_total: INVOICE_TOTAL,
    paid_amount: INVOICE_TOTAL,
    remaining_amount: 0,
    invoice_status: "PAID",
    description: "Invoice",
    price_mode: "VAT",
    order_price_mode: "VAT",
    created_at: "2026-07-04T08:35:07.541+00:00",
  });
  fail("insert invoice ledger", error);
}

const { error: paymentUpdateError } = await supabase
  .from("customer_ledger")
  .update({
    customer_name: CUSTOMER_NAME,
    customer_account_id: CUSTOMER_ACCOUNT_ID,
    order_number: ORDER_NUMBER,
    invoice_total: INVOICE_TOTAL,
    invoice_amount: INVOICE_TOTAL,
    paid_amount: INVOICE_TOTAL,
    remaining_amount: 0,
  })
  .eq("id", PAYMENT_LEDGER_ID);
fail("link payment ledger", paymentUpdateError);

const { error: orderUpdateError } = await supabase
  .from("orders")
  .update({
    order_total: INVOICE_TOTAL,
    payment_type: "Cash",
    payment_amount: INVOICE_TOTAL,
    payment_collected: "Yes",
  })
  .eq("order_number", ORDER_NUMBER);
fail("update order payment summary", orderUpdateError);

const { data: ledgerRows, error: ledgerVerifyError } = await supabase
  .from("customer_ledger")
  .select("id,entry_type,transaction_type,reference_no,order_number,debit,credit,amount,payment_amount,invoice_total,paid_amount,remaining_amount,invoice_status,payment_type,collection_source")
  .or(`reference_no.eq.${ORDER_NUMBER},order_number.eq.${ORDER_NUMBER}`)
  .order("created_at", { ascending: true });
fail("verify ledger", ledgerVerifyError);

const { data: orderRows, error: orderVerifyError } = await supabase
  .from("orders")
  .select("order_number,order_total,payment_type,payment_amount,payment_collected")
  .eq("order_number", ORDER_NUMBER);
fail("verify order", orderVerifyError);

console.log(JSON.stringify({ orderRows, ledgerRows, expected: { INVOICE_NET, INVOICE_VAT, INVOICE_TOTAL } }, null, 2));
