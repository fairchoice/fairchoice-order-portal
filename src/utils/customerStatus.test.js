import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCustomerStatusLabel,
  getStoredCustomerStatus,
  isInactiveCustomer,
  isOperationalCustomer,
} from "./customerStatus.js";

describe("customer status compatibility", () => {
  it("shows legacy stopped values as Inactive", () => {
    assert.equal(getCustomerStatusLabel("Stopped"), "Inactive");
    assert.equal(getCustomerStatusLabel("inactive"), "Inactive");
  });

  it("stores the Inactive UI choice using the existing legacy value", () => {
    assert.equal(getStoredCustomerStatus("Inactive"), "Closed");
  });

  it("keeps only active customers operationally selectable", () => {
    assert.equal(isOperationalCustomer({ status: "Active", active: true }), true);
    assert.equal(isOperationalCustomer({ status: "On Hold", active: true }), false);
    assert.equal(isOperationalCustomer({ status: "Stopped", active: true }), false);
    assert.equal(isInactiveCustomer({ status: "Active", active: false }), true);
  });
});
