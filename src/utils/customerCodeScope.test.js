import test from "node:test";
import assert from "node:assert/strict";
import { filterCustomerCodeScope } from "./customerCodeScope.js";

const customers = [
  { id: "london", account_name: "London Shop", country: "England", town_city: "London", active: true },
  { id: "bedford", account_name: "Bedford Shop", country: "England", town_city: " Bedford ", active: true },
  { id: "cardiff", account_name: "Cardiff Shop", country: "Wales", town_city: "Cardiff", active: true },
  { id: "inactive", account_name: "Old Shop", country: "England", town_city: "London", active: false },
  { id: "unknown", account_name: "No City", country: "England", town_city: null, active: true },
];
const ids = (options) => filterCustomerCodeScope(customers, options).map((customer) => customer.id);

test("England bulk assignments leave out selected cities without excluding other England customers", () => {
  assert.deepEqual(ids({ country: "England", excludedCities: ["London"] }), ["bedford", "unknown"]);
  assert.deepEqual(ids({ country: "England", excludedCities: ["London", "Bedford"] }), ["unknown"]);
});

test("all-country code assignments can exclude multiple cities without changing the source customer list", () => {
  assert.deepEqual(ids({ excludedCities: ["London", "Cardiff"] }), ["bedford", "unknown"]);
  assert.equal(customers.length, 5);
});

test("exclusions match case and whitespace differences and take precedence over a selected city", () => {
  assert.deepEqual(ids({ country: "england", city: "Bedford", excludedCities: ["BEDFORD"] }), []);
  assert.deepEqual(ids({ country: "England", excludedCities: [" bedford "] }), ["london", "unknown"]);
});

test("search and active filters still apply, including when inactive customers are enabled", () => {
  assert.deepEqual(ids({ search: "shop", excludedCities: ["London"], includeInactive: true }), ["bedford", "cardiff"]);
  assert.deepEqual(ids({ city: "London", includeInactive: true }), ["london", "inactive"]);
  assert.deepEqual(ids({ country: "Wales" }), ["cardiff"]);
});

test("clearing exclusions restores the original eligible scope", () => {
  assert.deepEqual(ids({ country: "England", excludedCities: [] }), ["london", "bedford", "unknown"]);
});
