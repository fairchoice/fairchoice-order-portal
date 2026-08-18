import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  allocateSupplierQuantity,
  preOrderSupplyItemChanges,
  preOrderWorkflowStage,
  warehouseSupplyStage,
} from "../services/preOrderSupplyAllocation.js";

test("supplier quantity allocation fills customer orders in stable order", () => {
  const lines = [
    { itemKey: "x", qty: 5 },
    { itemKey: "y", qty: 6 },
  ];
  assert.deepEqual(allocateSupplierQuantity(lines, 8), { x: 5, y: 3 });
});

test("pre-order supply exposes supplier-first queues and manual sync", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /Pre-order Queue/);
  assert.match(source, /Next Supplier/);
  assert.match(source, /Order Pre-orders/);
  assert.match(source, /Confirm Buy/);
  assert.match(source, /Sync All/);
  assert.match(source, /Select Supplier/);
});

test("cannot supply history stays compact without redundant unavailable label", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, />Not available</);
});

test("Warehouse Pre-Order variants are operational Pre-order Queue demand", () => {
  for (const status of [
    "Pre-Order",
    "PRE_ORDER",
    "Pre Order",
    "Need Supplier",
    "preorder",
    "Next Supplier",
  ]) {
    assert.equal(warehouseSupplyStage(status), "Pre-order");
    assert.equal(preOrderWorkflowStage(status), "Pre-order");
  }
});

test("Warehouse Cannot Supply is operational without a Remove event", () => {
  assert.equal(warehouseSupplyStage("Cannot Supply"), "Cannot Supply");
  assert.equal(preOrderWorkflowStage("CANNOT_SUPPLY"), "Cannot Supply");
});

test("Buy makes exactly the bought Warehouse quantity pickable In Stock", () => {
  assert.deepEqual(preOrderSupplyItemChanges("Buy", { quantity: 4 }), {
    sourceStatus: "In Stock",
    includeInPicking: true,
    pickedQty: 4,
  });
});

test("Recall Buy restores unresolved Warehouse demand and keeps an audit action", () => {
  assert.deepEqual(preOrderSupplyItemChanges("Recall", { restoreQuantity: 7 }), {
    sourceStatus: "Need Supplier",
    includeInPicking: false,
    pickedQty: 0,
    qty: 7,
  });
  assert.equal(
    preOrderWorkflowStage("In Stock", { actionType: "Recall" }, { pending: true }),
    "Pre-order",
  );
});

test("Next Supplier is workflow-only and leaves Warehouse status unchanged", () => {
  assert.equal(preOrderSupplyItemChanges("NextSup", { quantity: 5 }), null);
  assert.equal(
    preOrderWorkflowStage("Need Supplier", { actionType: "NextSup" }),
    "Next Supplier",
  );
});

test("partial Buy conserves ordered quantity across In Stock and unresolved lines", () => {
  const ordered = 9;
  const bought = 4;
  const remaining = ordered - bought;
  assert.deepEqual(
    preOrderSupplyItemChanges("PartialBuy", {
      quantity: bought,
      remainingQuantity: remaining,
    }),
    {
      sourceStatus: "Need Supplier",
      includeInPicking: false,
      pickedQty: 0,
      qty: remaining,
    },
  );
  assert.equal(bought + remaining, ordered);
  assert.equal(
    preOrderWorkflowStage("Need Supplier", { actionType: "PartialBuy" }),
    "Next Supplier",
  );
});

test("Buy and Remove from Next Supplier use Warehouse-safe transitions", () => {
  assert.deepEqual(preOrderSupplyItemChanges("Buy", { quantity: 3 }), {
    sourceStatus: "In Stock",
    includeInPicking: true,
    pickedQty: 3,
  });
  assert.deepEqual(preOrderSupplyItemChanges("Remove", { quantity: 3 }), {
    sourceStatus: "Cannot Supply",
    includeInPicking: false,
    pickedQty: 0,
  });
});

test("page records supplier-linked permanent events and skips Warehouse update for Next Supplier", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /supplierId: supplier\?\.id/);
  assert.match(source, /supplierName: supplier\?\.supplier_name/);
  assert.match(source, /productId: itemProductId\(line\.item\)/);
  assert.match(source, /customerName: line\.customerName/);
  assert.match(source, /action\.actionType !== "NextSup"/);
  assert.match(source, /recordPreOrderSupplyEvent\(persistedAction, loggedInUser\)/);
  assert.match(source, /recalledClientActionId/);
  assert.match(source, /persistedByClientActionId/);
});

test("the real partial split keeps remaining and bought order_items in Warehouse-safe states", () => {
  const source = fs.readFileSync(new URL("./CustomerOrder.jsx", import.meta.url), "utf8");
  assert.match(source, /qty: remainingQty,[\s\S]*source_status: "Need Supplier",[\s\S]*include_in_picking: false/);
  assert.match(source, /qty: allocatedQty,[\s\S]*picked_qty: allocatedQty,[\s\S]*source_status: "In Stock",[\s\S]*include_in_picking: true/);
  assert.match(source, /updatedItems\.push\([\s\S]*qty: allocatedQty/);
});
