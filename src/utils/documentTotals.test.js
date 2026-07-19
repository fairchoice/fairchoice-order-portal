import assert from "node:assert/strict";
import test from "node:test";

import { calculateDocumentTotals } from "./documentTotals.js";

test("calculateDocumentTotals excludes removed raw database order items", () => {
  const totals = calculateDocumentTotals(
    [
      {
        qty: 1,
        net_total: 699.08,
        vat_rate: 20,
        include_in_picking: true,
        source_status: "In Stock",
      },
      {
        qty: 1,
        net_total: 112,
        vat_rate: 20,
        include_in_picking: false,
        source_status: "Cannot Supply",
      },
    ],
    { price_mode: "VAT" }
  );

  assert.equal(totals.netTotal, 699.08);
  assert.equal(totals.vatTotal, 139.82);
  assert.equal(totals.grandTotal, 838.9);
});
