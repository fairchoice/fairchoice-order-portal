import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import fs from "node:fs";

const WORKBOOK_PATH =
  process.argv.find((arg) => arg.endsWith(".xlsx")) ||
  "C:/Users/nisst/Downloads/fairchoice-customers-2026-07-08.xlsx";
const APPLY = process.argv.includes("--apply");

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

const normalize = (value) => String(value || "").trim();
const normalizeKey = (value) => normalize(value).toLowerCase();

const getRowValue = (row, keys) => {
  const values = Object.entries(row || {}).reduce((map, [key, value]) => {
    map[normalizeKey(key)] = value;
    return map;
  }, {});

  for (const key of keys) {
    const value = values[normalizeKey(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
};

const toBool = (value, fallback = true) => {
  if (value === true || value === false) return value;
  if (value === "") return fallback;

  const text = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(text)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(text)) return false;

  return fallback;
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseAllowedModes = (value) => {
  const modes = normalize(value)
    .split(/[,\|/]+/)
    .map((mode) => mode.trim().toLowerCase())
    .filter(Boolean);

  return {
    allow_vat: modes.length
      ? modes.includes("vat") || modes.includes("ex vat") || modes.includes("ex. vat")
      : true,
    allow_server: modes.includes("server"),
    allow_manager: false,
    allow_super: false,
  };
};

const getWorkbookRows = () => {
  const workbook = XLSX.readFile(WORKBOOK_PATH);
  const accountSheet = workbook.Sheets["Customer Accounts"];
  const branchSheet = workbook.Sheets["Customer Branches"];

  if (!accountSheet) throw new Error("Workbook is missing Customer Accounts sheet.");

  return {
    accountRows: XLSX.utils.sheet_to_json(accountSheet, { defval: "" }),
    branchRows: branchSheet ? XLSX.utils.sheet_to_json(branchSheet, { defval: "" }) : [],
  };
};

const buildAccountPayload = (row) => {
  const addressLine1 = normalize(getRowValue(row, ["Address", "address"]));
  const townCity = normalize(
    getRowValue(row, ["City / Town", "Town / City", "City", "Town", "town_city", "city"])
  );
  const postcode = normalize(getRowValue(row, ["Postcode", "postcode"]));
  const fullAddress = [addressLine1, townCity, postcode].filter(Boolean).join(", ");

  return {
    id: normalize(getRowValue(row, ["Customer Account ID", "id"])),
    account_name: normalize(getRowValue(row, ["Customer Name", "account_name"])),
    account_code: normalize(getRowValue(row, ["Account Code", "account_code"])),
    contact_name: normalize(getRowValue(row, ["Contact Name", "contact_name"])),
    phone: normalize(getRowValue(row, ["Phone", "phone"])),
    email: normalize(getRowValue(row, ["Email", "email"])),
    address_line_1: addressLine1,
    town_city: townCity,
    postcode,
    address: fullAddress,
    country: normalize(getRowValue(row, ["Country", "country"])) || "Wales",
    credit_limit: toNumber(getRowValue(row, ["Credit Limit", "credit_limit"])),
    default_price_mode:
      normalize(getRowValue(row, ["Default Price Mode", "default_price_mode"])) || "VAT",
    active: toBool(getRowValue(row, ["Active", "active"]), true),
    opening_balance: toNumber(getRowValue(row, ["Opening Balance", "opening_balance"])),
    ...parseAllowedModes(getRowValue(row, ["Allowed Price Modes", "allowed_price_modes"])),
  };
};

const buildBranchPayload = (row) => ({
  id: normalize(getRowValue(row, ["Branch ID", "id"])),
  customer_account_id: normalize(getRowValue(row, ["Customer Account ID", "customer_account_id"])),
  customer_name: normalize(getRowValue(row, ["Customer Name", "customer_name"])),
  branch_name: normalize(getRowValue(row, ["Branch Name", "branch_name"])),
  delivery_address: normalize(getRowValue(row, ["Delivery Address", "delivery_address"])),
  postcode: normalize(getRowValue(row, ["Postcode", "postcode"])),
  country: normalize(getRowValue(row, ["Country", "country"])) || "Wales",
  phone: normalize(getRowValue(row, ["Phone", "phone"])),
  active: toBool(getRowValue(row, ["Active", "active"]), true),
});

const fail = (label, error) => {
  if (error) throw new Error(`${label}: ${error.message || JSON.stringify(error)}`);
};

async function loadExisting() {
  const { data: accounts, error: accountsError } = await supabase
    .from("customer_accounts")
    .select("id, account_name");
  fail("load customer accounts", accountsError);

  const { data: branches, error: branchesError } = await supabase
    .from("customer_branches")
    .select("id, customer_account_id, branch_name");
  fail("load customer branches", branchesError);

  return {
    accounts: accounts || [],
    branches: branches || [],
  };
}

async function upsertOpeningBalance(customerName, openingBalance) {
  const { data, error } = await supabase
    .from("customer_opening_balances")
    .select("id")
    .eq("customer_name", customerName)
    .maybeSingle();
  fail(`load opening balance ${customerName}`, error);

  if (data?.id) {
    const { error: updateError } = await supabase
      .from("customer_opening_balances")
      .update({ opening_balance: openingBalance })
      .eq("id", data.id);
    fail(`update opening balance ${customerName}`, updateError);
    return;
  }

  const { error: insertError } = await supabase
    .from("customer_opening_balances")
    .insert({ customer_name: customerName, opening_balance: openingBalance });
  fail(`insert opening balance ${customerName}`, insertError);
}

async function main() {
  const { accountRows, branchRows } = getWorkbookRows();
  const { accounts, branches } = await loadExisting();
  const accountsById = new Map(accounts.map((account) => [String(account.id), account]));
  const accountsByName = new Map(accounts.map((account) => [normalizeKey(account.account_name), account]));
  const branchesById = new Map(branches.map((branch) => [String(branch.id), branch]));

  const accountUpdates = [];
  const accountCreates = [];
  const branchUpdates = [];
  const branchCreates = [];
  const skipped = [];

  for (const row of accountRows) {
    const payload = buildAccountPayload(row);
    if (!payload.account_name) {
      skipped.push({ type: "account", reason: "missing account_name", row });
      continue;
    }

    const existing = payload.id
      ? accountsById.get(payload.id)
      : accountsByName.get(normalizeKey(payload.account_name));

    if (existing) {
      accountUpdates.push({ id: existing.id, payload });
    } else {
      accountCreates.push({ payload });
    }
  }

  for (const row of branchRows) {
    const payload = buildBranchPayload(row);
    if (!payload.branch_name) {
      skipped.push({ type: "branch", reason: "missing branch_name", row });
      continue;
    }

    const existing = payload.id ? branchesById.get(payload.id) : null;
    if (existing) {
      branchUpdates.push({ id: existing.id, payload });
    } else {
      branchCreates.push({ payload });
    }
  }

  console.log(
    JSON.stringify(
      {
        workbook: WORKBOOK_PATH,
        apply: APPLY,
        accountRows: accountRows.length,
        branchRows: branchRows.length,
        accountUpdates: accountUpdates.length,
        accountCreates: accountCreates.length,
        branchUpdates: branchUpdates.length,
        branchCreates: branchCreates.length,
        skipped: skipped.length,
        sampleAccounts: accountUpdates.slice(0, 5).map(({ payload }) => ({
          account_name: payload.account_name,
          town_city: payload.town_city,
          address: payload.address,
          active: payload.active,
        })),
      },
      null,
      2
    )
  );

  if (!APPLY) return;

  for (const { id, payload } of accountUpdates) {
    const { opening_balance, id: _ignoredId, ...updatePayload } = payload;
    const { error } = await supabase.from("customer_accounts").update(updatePayload).eq("id", id);
    fail(`update customer ${payload.account_name}`, error);
    await upsertOpeningBalance(payload.account_name, opening_balance);
  }

  for (const { payload } of accountCreates) {
    const { opening_balance, id: _ignoredId, ...insertPayload } = payload;
    const { data, error } = await supabase.from("customer_accounts").insert(insertPayload).select().single();
    fail(`insert customer ${payload.account_name}`, error);
    await upsertOpeningBalance(data.account_name, opening_balance);
  }

  for (const { id, payload } of branchUpdates) {
    const { id: _ignoredId, customer_name, ...updatePayload } = payload;
    const { error } = await supabase.from("customer_branches").update(updatePayload).eq("id", id);
    fail(`update branch ${payload.branch_name}`, error);
  }

  for (const { payload } of branchCreates) {
    const customer =
      accountsById.get(payload.customer_account_id) ||
      accountsByName.get(normalizeKey(payload.customer_name));
    const { id: _ignoredId, customer_name, ...insertPayload } = payload;

    if (!insertPayload.customer_account_id && customer?.id) {
      insertPayload.customer_account_id = customer.id;
    }

    const { error } = await supabase.from("customer_branches").insert(insertPayload);
    fail(`insert branch ${payload.branch_name}`, error);
  }

  console.log("Customer workbook sync applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
