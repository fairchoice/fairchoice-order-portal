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
const reference = process.argv[2] || "ORD-1783022404316";

const print = (label, value) => {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
};

const orderResult = await supabase
  .from("orders")
  .select(
    "id,order_number,company_name,customer_account_id,price_mode,status,order_total,payment_type,payment_amount,payment_collected,created_at,delivered_at,order_items(*)"
  )
  .eq("order_number", reference);

if (orderResult.error) throw orderResult.error;
print("orders", orderResult.data);

const queueResult = await supabase
  .from("processing_queue")
  .select("*")
  .eq("order_number", reference);

if (queueResult.error) {
  console.warn("processing_queue skipped:", queueResult.error.message);
} else {
  print("processing_queue", queueResult.data);
}

const ledgerResult = await supabase
  .from("customer_ledger")
  .select("*")
  .or(`reference_no.eq.${reference},order_number.eq.${reference}`);

if (ledgerResult.error) throw ledgerResult.error;
print("customer_ledger", ledgerResult.data);
