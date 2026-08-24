import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildCollectorOptions,
  collectorOptionMatchesRow,
} from "./weeklyAccountCollectors.js";

const DRIVER_ID = "11111111-1111-4111-8111-111111111111";
const SALES_ID = "22222222-2222-4222-8222-222222222222";
const migration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731120000_weekly_collector_identity_short_expense_references.sql",
    import.meta.url,
  ),
  "utf8",
);
const handoverService = fs.readFileSync(
  new URL("./handovers.js", import.meta.url),
  "utf8",
);

test("roster SQL requires active linked eligible login and staff identities", () => {
  assert.match(migration, /join public\.login_users lu[\s\S]*lu\.staff_id = su\.id/);
  assert.match(migration, /lu\.active is true/);
  assert.match(migration, /where su\.active is true/);
  assert.match(migration, /in \('driver', 'salesrep', 'salesrepresentative'\)/);
  assert.doesNotMatch(
    migration.match(/with eligible as \([\s\S]*?\n {2}\)/)?.[0] || "",
    /\badmin\b/i,
  );
});

test("handover writes the selected stable staff ID with name and type snapshots", () => {
  assert.match(handoverService, /collector_staff_id: data\.collectorStaffId \|\| null/);
  assert.match(handoverService, /collector_type: data\.collectorType/);
  assert.match(handoverService, /collector_name: data\.collectorName/);
});

test("active linked Driver and Sales Rep identities produce stable UUID options", () => {
  const options = buildCollectorOptions([
    {
      staff_id: DRIVER_ID,
      staff_name: "Nisstaj",
      username: "Nisstaj_drive",
      collector_type: "Driver",
      login_aliases: ["Nisstaj_drive", "nisstaj_admin"],
    },
    {
      staff_id: SALES_ID,
      staff_name: "Vijay",
      username: "vijay_sales",
      collector_type: "Sales Representative",
      login_aliases: ["vijay_sales"],
    },
  ]);

  assert.deepEqual(
    options.map(({ value, label, type }) => ({ value, label, type })),
    [
      { value: DRIVER_ID, label: "Nisstaj — Nisstaj_drive", type: "Driver" },
      { value: SALES_ID, label: "Vijay — vijay_sales", type: "Sales Rep" },
    ],
  );
});

test("duplicate login aliases do not create duplicate options for one staff UUID", () => {
  const options = buildCollectorOptions([
    {
      staff_id: DRIVER_ID,
      staff_name: "Nisstaj",
      username: "Nisstaj_drive",
      collector_type: "Driver",
    },
    {
      staff_id: DRIVER_ID,
      staff_name: "Nisstaj",
      username: "nisstaj_admin",
      collector_type: "Driver",
    },
  ]);

  assert.equal(options.length, 1);
  assert.equal(options[0].staffId, DRIVER_ID);
  assert.ok(options[0].aliases.includes("nisstaj_drive"));
  assert.ok(options[0].aliases.includes("nisstaj_admin"));
});

test("historical name-only collectors remain visible only when unresolved", () => {
  const options = buildCollectorOptions(
    [
      {
        staff_id: DRIVER_ID,
        staff_name: "Nisstaj",
        username: "Nisstaj_drive",
        collector_type: "Driver",
      },
    ],
    [
      { collector_type: "Driver", collector_name: "Nisstaj" },
      { collector_type: "Driver", collector_name: "Historic Driver" },
    ],
  );

  const identity = options.find((option) => option.staffId === DRIVER_ID);
  const legacy = options.find((option) => option.legacy);
  assert.equal(identity.staffId, DRIVER_ID);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.label, "Historic Driver");
});

test("matching prefers staff UUID and falls back to aliases only for legacy rows", () => {
  const [option] = buildCollectorOptions([
    {
      staff_id: DRIVER_ID,
      staff_name: "Nisstaj",
      username: "Nisstaj_drive",
      collector_type: "Driver",
      login_aliases: ["nisstaj_admin"],
    },
  ]);

  assert.equal(
    collectorOptionMatchesRow(option, {
      collector_staff_id: DRIVER_ID,
      collector_type: "Driver",
      collector_name: "old snapshot",
    }),
    true,
  );
  assert.equal(
    collectorOptionMatchesRow(option, {
      collector_type: "Driver",
      collector_name: "NISSTAJ_ADMIN",
    }),
    true,
  );
  assert.equal(
    collectorOptionMatchesRow(option, {
      collector_staff_id: SALES_ID,
      collector_type: "Driver",
      collector_name: "Nisstaj",
    }),
    false,
  );
});
