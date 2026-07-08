import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = fs.existsSync(".env")
  ? Object.fromEntries(
      fs
        .readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        })
    )
  : {};

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const TARGET_CUSTOMER_NAME = "Village Store - Nelson";
const OLD_BALANCE_NAME = "Nake Village Store";
const OPENING_BALANCE = 452.83;
const NIROSH_CUSTOMER_NAME = "NIROSH LIMITED";
const NIROSH_OPENING_BALANCE_AFTER_SPLIT = 1077.1;

function fail(step, error) {
  if (error) throw new Error(`${step}: ${error.message || JSON.stringify(error)}`);
}

async function upsertOpeningBalance(customerName, openingBalance) {
  const { data, error } = await supabase
    .from("customer_opening_balances")
    .select("id, customer_name, opening_balance")
    .eq("customer_name", customerName)
    .limit(1);
  fail(`load opening balance ${customerName}`, error);

  if (data?.[0]?.id) {
    const { error: updateError } = await supabase
      .from("customer_opening_balances")
      .update({ opening_balance: openingBalance })
      .eq("id", data[0].id);
    fail(`update opening balance ${customerName}`, updateError);
    return;
  }

  const { error: insertError } = await supabase
    .from("customer_opening_balances")
    .insert({ customer_name: customerName, opening_balance: openingBalance });
  fail(`insert opening balance ${customerName}`, insertError);
}

async function main() {
  const { data: accounts, error: accountsError } = await supabase
    .from("customer_accounts")
    .select("id, account_name")
    .or("account_name.ilike.%Village%,account_name.ilike.%Nake%,account_name.ilike.%NIROSH%")
    .order("account_name");
  fail("load matching accounts", accountsError);

  const { data: balancesBefore, error: balancesBeforeError } = await supabase
    .from("customer_opening_balances")
    .select("id, customer_name, opening_balance")
    .or("customer_name.ilike.%Village%,customer_name.ilike.%Nake%,customer_name.ilike.%NIROSH%")
    .order("customer_name");
  fail("load opening balances before", balancesBeforeError);

  console.log("Accounts before:", JSON.stringify(accounts, null, 2));
  console.log("Opening balances before:", JSON.stringify(balancesBefore, null, 2));

  await upsertOpeningBalance(TARGET_CUSTOMER_NAME, OPENING_BALANCE);
  await upsertOpeningBalance(NIROSH_CUSTOMER_NAME, NIROSH_OPENING_BALANCE_AFTER_SPLIT);

  const { data: oldBalanceRows, error: oldBalanceError } = await supabase
    .from("customer_opening_balances")
    .select("id")
    .eq("customer_name", OLD_BALANCE_NAME);
  fail("load old Nake balance row", oldBalanceError);

  if (oldBalanceRows?.length) {
    const { error: deleteError } = await supabase
      .from("customer_opening_balances")
      .delete()
      .eq("customer_name", OLD_BALANCE_NAME);
    fail("delete old Nake balance row", deleteError);
  }

  const { data: balancesAfter, error: balancesAfterError } = await supabase
    .from("customer_opening_balances")
    .select("id, customer_name, opening_balance")
    .or("customer_name.ilike.%Village%,customer_name.ilike.%Nake%,customer_name.ilike.%NIROSH%")
    .order("customer_name");
  fail("load opening balances after", balancesAfterError);

  console.log("Opening balances after:", JSON.stringify(balancesAfter, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
