import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPriceModeLabel } from "./pricing.js";

describe("price mode display labels", () => {
  it("maps stored VAT and Server values without changing their values", () => {
    assert.equal(getPriceModeLabel("VAT"), "Ex.VAT");
    assert.equal(getPriceModeLabel("server"), "Inc.VAT");
  });
});
