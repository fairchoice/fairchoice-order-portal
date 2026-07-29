import assert from "node:assert/strict";
import test from "node:test";

import {
  excludeTestAccountRows,
  getTestAccountIds,
  isTestAccount,
} from "./testAccountFiltering.js";

test("new test accounts are excluded through is_test_account", () => {
  const accounts = [
    { id: "test-id", account_name: "QA Customer", is_test_account: true },
    { id: "real-id", account_name: "Real Customer", is_test_account: false },
  ];
  const ids = getTestAccountIds(accounts);
  const rows = excludeTestAccountRows(
    [
      { id: "p1", customer_account_id: "test-id" },
      { id: "p2", customer_account_id: "real-id" },
    ],
    { testAccountIds: ids }
  );

  assert.equal(isTestAccount(accounts[0]), true);
  assert.deepEqual(rows.map((row) => row.id), ["p2"]);
});

test("genuine customer names containing Shop remain included", () => {
  const rows = excludeTestAccountRows([
    {
      id: "payment-real",
      customer_account_id: "real-shop-id",
      customer_name: "Ravensden Corner Shop",
    },
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["payment-real"]);
});

test("name matching alone never marks an account as test", () => {
  assert.equal(
    isTestAccount({
      id: "unflagged",
      account_name: "Test Shop",
      is_test_account: false,
    }),
    false
  );
});
