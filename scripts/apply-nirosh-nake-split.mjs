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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const OLD_ACCOUNT_ID = "d4cf28c6-803f-4d60-9909-e11a6d202059";
const BRANCH_A_ID = "07067cfb-be6f-4ea8-af7c-e4cf23b883f6";
const BRANCH_B_ID = "9032bef3-5b2c-45d9-8a09-b46eaed106c6";
const NEW_ACCOUNT_NAME = "Village Store - Nelson";
const BRANCH_A_ORDERS = ["ORD-1782383765878", "ORD-1782981495034"];
const BRANCH_B_ORDERS = ["ORD-1782415703998", "ORD-1783018640672"];
const BRANCH_B_PAYMENT_LEDGER_ID = 68;
const PREVIOUS_CREDIT_BALANCE = 452.83;

function fail(step, error) {
  if (error) {
    throw new Error(`${step}: ${error.message || JSON.stringify(error)}`);
  }
}

async function maybeUpdate(table, payload, buildQuery) {
  const query = buildQuery(supabase.from(table).update(payload));
  const { error, count } = await query.select("id", { count: "exact", head: true });
  if (error && /Could not find the table|schema cache|does not exist/i.test(error.message || "")) {
    console.log(`${table}: skipped (${error.message})`);
    return 0;
  }
  fail(`${table} update`, error);
  console.log(`${table}: updated ${count ?? "unknown"} row(s)`);
  return count || 0;
}

async function getOrCreateVillageStoreAccount() {
  const { data: existingRows, error: existingError } = await supabase
    .from("customer_accounts")
    .select("*")
    .ilike("account_name", NEW_ACCOUNT_NAME)
    .limit(1);
  fail("find Village Store account", existingError);

  if (existingRows?.[0]?.id) {
    const { data, error } = await supabase
      .from("customer_accounts")
      .update({
        account_name: NEW_ACCOUNT_NAME,
        address_line_1: existingRows[0].address_line_1 || "57 High St",
        town_city: existingRows[0].town_city || "Treharris",
        postcode: existingRows[0].postcode || "CF46 6HA",
        address: existingRows[0].address || "57 High St, Treharris, Nelson, CF46 6HA",
        country: existingRows[0].country || "Wales",
        active: true,
        allow_manager: false,
        allow_super: false,
      })
      .eq("id", existingRows[0].id)
      .select("*")
      .single();
    fail("update existing Village Store account", error);
    return data;
  }

  const { data: oldAccount, error: oldError } = await supabase
    .from("customer_accounts")
    .select("*")
    .eq("id", OLD_ACCOUNT_ID)
    .single();
  fail("load NIROSH account", oldError);

  const { data, error } = await supabase
    .from("customer_accounts")
    .insert({
      account_name: NEW_ACCOUNT_NAME,
      contact_name: oldAccount.contact_name || "",
      phone: oldAccount.phone || "",
      mobile: oldAccount.mobile || "",
      email: oldAccount.email || "",
      vat_number: oldAccount.vat_number || "",
      address_line_1: "57 High St",
      address_line_2: "",
      town_city: "Treharris",
      postcode: "CF46 6HA",
      address: "57 High St, Treharris, Nelson, CF46 6HA",
      country: oldAccount.country || "Wales",
      payment_terms: oldAccount.payment_terms || "",
      credit_limit: Number(oldAccount.credit_limit || 0),
      default_price_mode: oldAccount.default_price_mode || "VAT",
      status: oldAccount.status || "Active",
      active: oldAccount.active !== false,
      allow_vat: oldAccount.allow_vat ?? true,
      allow_server: oldAccount.allow_server ?? false,
      allow_manager: false,
      allow_super: false,
    })
    .select("*")
    .single();
  fail("create Village Store account", error);
  return data;
}

async function getLedgerIdsForOrders(orderNumbers, extraIds = []) {
  const { data, error } = await supabase
    .from("customer_ledger")
    .select("id, reference_no, order_number")
    .or(
      [
        `reference_no.in.(${orderNumbers.join(",")})`,
        `order_number.in.(${orderNumbers.join(",")})`,
        extraIds.length ? `id.in.(${extraIds.join(",")})` : "",
      ]
        .filter(Boolean)
        .join(",")
    );
  fail("load ledger ids", error);
  return (data || []).map((row) => row.id);
}

async function saveOpeningBalance(customerName, amount) {
  const { data, error } = await supabase
    .from("customer_opening_balances")
    .select("*")
    .eq("customer_name", customerName)
    .limit(1);
  fail(`load opening balance ${customerName}`, error);

  if (data?.[0]?.id) {
    const { error: updateError } = await supabase
      .from("customer_opening_balances")
      .update({ opening_balance: Number(amount || 0) })
      .eq("id", data[0].id);
    fail(`update opening balance ${customerName}`, updateError);
    return;
  }

  const { error: insertError } = await supabase
    .from("customer_opening_balances")
    .insert({ customer_name: customerName, opening_balance: Number(amount || 0) });
  fail(`insert opening balance ${customerName}`, insertError);
}

async function main() {
  console.log("Starting NIROSH/Village Store live data split...");
  const nakeAccount = await getOrCreateVillageStoreAccount();
  console.log(`Village Store account id: ${nakeAccount.id}`);

  const branchBLedgerIds = await getLedgerIdsForOrders(BRANCH_B_ORDERS, [BRANCH_B_PAYMENT_LEDGER_ID]);
  const branchALedgerIds = await getLedgerIdsForOrders(BRANCH_A_ORDERS);

  await maybeUpdate(
    "orders",
    {
      customer_account_id: nakeAccount.id,
      customer_branch_id: null,
      branch_id: null,
      branch_name: null,
      delivery_branch_name: null,
      company_name: NEW_ACCOUNT_NAME,
    },
    (query) =>
      query.or(
        [
          `customer_branch_id.eq.${BRANCH_B_ID}`,
          `branch_id.eq.${BRANCH_B_ID}`,
          `order_number.in.(${BRANCH_B_ORDERS.join(",")})`,
        ].join(",")
      )
  );

  await maybeUpdate(
    "orders",
    {
      customer_account_id: OLD_ACCOUNT_ID,
      customer_branch_id: null,
      branch_id: null,
      branch_name: null,
      delivery_branch_name: null,
      company_name: "NIROSH LIMITED",
    },
    (query) =>
      query.or(
        [
          `customer_branch_id.eq.${BRANCH_A_ID}`,
          `branch_id.eq.${BRANCH_A_ID}`,
          `order_number.in.(${BRANCH_A_ORDERS.join(",")})`,
        ].join(",")
      )
  );

  await maybeUpdate(
    "customer_ledger",
    {
      customer_account_id: nakeAccount.id,
      customer_branch_id: null,
      branch_id: null,
      branch_name: null,
      customer_name: NEW_ACCOUNT_NAME,
    },
    (query) =>
      query.or(
        [
          `customer_branch_id.eq.${BRANCH_B_ID}`,
          `branch_id.eq.${BRANCH_B_ID}`,
          `reference_no.in.(${BRANCH_B_ORDERS.join(",")})`,
          `order_number.in.(${BRANCH_B_ORDERS.join(",")})`,
          `id.eq.${BRANCH_B_PAYMENT_LEDGER_ID}`,
        ].join(",")
      )
  );

  await maybeUpdate(
    "customer_ledger",
    {
      customer_account_id: OLD_ACCOUNT_ID,
      customer_branch_id: null,
      branch_id: null,
      branch_name: null,
      customer_name: "NIROSH LIMITED",
    },
    (query) =>
      query.or(
        [
          `customer_branch_id.eq.${BRANCH_A_ID}`,
          `branch_id.eq.${BRANCH_A_ID}`,
          `reference_no.in.(${BRANCH_A_ORDERS.join(",")})`,
          `order_number.in.(${BRANCH_A_ORDERS.join(",")})`,
        ].join(",")
      )
  );

  for (const table of ["processing_queue", "customer_returns"]) {
    await maybeUpdate(
      table,
      {
        customer_account_id: nakeAccount.id,
        customer_branch_id: null,
        branch_id: null,
        branch_name: null,
        customer_name: NEW_ACCOUNT_NAME,
      },
      (query) =>
        query.or(
          [
            `customer_branch_id.eq.${BRANCH_B_ID}`,
            `branch_id.eq.${BRANCH_B_ID}`,
            `order_number.in.(${BRANCH_B_ORDERS.join(",")})`,
          ].join(",")
        )
    );

    await maybeUpdate(
      table,
      {
        customer_account_id: OLD_ACCOUNT_ID,
        customer_branch_id: null,
        branch_id: null,
        branch_name: null,
        customer_name: "NIROSH LIMITED",
      },
      (query) =>
        query.or(
          [
            `customer_branch_id.eq.${BRANCH_A_ID}`,
            `branch_id.eq.${BRANCH_A_ID}`,
            `order_number.in.(${BRANCH_A_ORDERS.join(",")})`,
          ].join(",")
        )
    );
  }

  if (branchBLedgerIds.length) {
    await maybeUpdate(
      "customer_payment_allocations",
      { customer_account_id: nakeAccount.id, customer_branch_id: null },
      (query) =>
        query.or(
          [
            `customer_branch_id.eq.${BRANCH_B_ID}`,
            `invoice_ledger_id.in.(${branchBLedgerIds.join(",")})`,
            `payment_ledger_id.in.(${branchBLedgerIds.join(",")})`,
          ].join(",")
        )
    );
  }

  if (branchALedgerIds.length) {
    await maybeUpdate(
      "customer_payment_allocations",
      { customer_account_id: OLD_ACCOUNT_ID, customer_branch_id: null },
      (query) =>
        query.or(
          [
            `customer_branch_id.eq.${BRANCH_A_ID}`,
            `invoice_ledger_id.in.(${branchALedgerIds.join(",")})`,
            `payment_ledger_id.in.(${branchALedgerIds.join(",")})`,
          ].join(",")
        )
    );
  }

  const { data: niroshBalanceRows, error: niroshBalanceError } = await supabase
    .from("customer_opening_balances")
    .select("*")
    .eq("customer_name", "NIROSH LIMITED")
    .limit(1);
  fail("load NIROSH opening balance", niroshBalanceError);

  const { data: existingVillageBalanceRows, error: existingVillageBalanceError } = await supabase
    .from("customer_opening_balances")
    .select("*")
    .eq("customer_name", NEW_ACCOUNT_NAME)
    .limit(1);
  fail("load existing Village Store opening balance", existingVillageBalanceError);

  const currentNiroshOpeningBalance = Number(niroshBalanceRows?.[0]?.opening_balance || 0);
  const villageOpeningBalanceAlreadyExists = Boolean(existingVillageBalanceRows?.[0]?.id);
  await saveOpeningBalance(NEW_ACCOUNT_NAME, PREVIOUS_CREDIT_BALANCE);
  if (!villageOpeningBalanceAlreadyExists && niroshBalanceRows?.[0]?.id) {
    const { error } = await supabase
      .from("customer_opening_balances")
      .update({
        opening_balance: Math.max(0, currentNiroshOpeningBalance - PREVIOUS_CREDIT_BALANCE),
      })
      .eq("id", niroshBalanceRows[0].id);
    fail("reduce NIROSH opening balance", error);
  } else if (villageOpeningBalanceAlreadyExists) {
    console.log("Opening balance: Village Store already existed, NIROSH not reduced again.");
  }

  const { error: deleteBranchError, count: deletedBranches } = await supabase
    .from("customer_branches")
    .delete({ count: "exact" })
    .in("id", [BRANCH_A_ID, BRANCH_B_ID]);
  fail("delete old branches", deleteBranchError);
  console.log(`customer_branches: deleted ${deletedBranches ?? "unknown"} old branch row(s)`);

  const { data: verifyAccounts, error: verifyAccountsError } = await supabase
    .from("customer_accounts")
    .select("id, account_name")
    .in("account_name", ["NIROSH LIMITED", NEW_ACCOUNT_NAME])
    .order("account_name");
  fail("verify accounts", verifyAccountsError);

  const { data: verifyBranches, error: verifyBranchesError } = await supabase
    .from("customer_branches")
    .select("id, customer_account_id, branch_name")
    .in("id", [BRANCH_A_ID, BRANCH_B_ID]);
  fail("verify old branches", verifyBranchesError);

  const { data: verifyOrders, error: verifyOrdersError } = await supabase
    .from("orders")
    .select("order_number, company_name, customer_account_id, customer_branch_id, branch_name, delivery_branch_name, order_total")
    .in("order_number", [...BRANCH_A_ORDERS, ...BRANCH_B_ORDERS])
    .order("order_number");
  fail("verify orders", verifyOrdersError);

  console.log("Accounts:", JSON.stringify(verifyAccounts, null, 2));
  console.log("Old branches remaining:", JSON.stringify(verifyBranches, null, 2));
  console.log("Orders:", JSON.stringify(verifyOrders, null, 2));
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
