import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  allocateSupplierQuantity,
  clearPendingPreOrderActionsForOrder,
  filterPendingPreOrderActionsForOrders,
  isActivePreOrderSupplyOrder,
  isLivePreOrderDemandOrder,
  isWarehousePreOrderQueueLine,
  isLivePreOrderSupplyEvent,
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
  assert.doesNotMatch(source, /"History"/);
  assert.doesNotMatch(source, /type="date"/);
});

test("Warehouse Pre-order demand is the Queue source and Received alone is excluded", () => {
  assert.equal(isWarehousePreOrderQueueLine({ status: "Warehouse Packing" }, "Pre-order"), true);
  assert.equal(isWarehousePreOrderQueueLine({ status: "Warehouse Packing" }, "Cannot Supply"), false);
  assert.equal(isWarehousePreOrderQueueLine({ status: "Received" }, "Pre-order"), false);
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /for \(const order of orders \|\| \[\]\)/);
  assert.match(source, /isWarehousePreOrderQueueLine\(entry\.order, entry\.displayStatus\)/);
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

test("synced Bought remains active while its In Stock item belongs to Warehouse Packing", () => {
  const event = { itemKey: "ORD-1:item-1", itemId: "item-1", actionType: "Buy" };
  assert.equal(warehouseSupplyStage("In Stock"), null);
  assert.equal(isLivePreOrderSupplyEvent(
    event,
    new Set([event.itemKey]),
    new Set([event.itemId]),
  ), true);
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /\["in stock", "available"\]\.includes\(normalizeStatus\(warehouseLine\?\.status\)\)/);
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

test("supplier and availability actions remain pending until Sync All", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /setPendingActions\(\(current\) => \[\.\.\.current, \.\.\.actions\]\)/);
  assert.match(source, /const syncPendingActions = async \(\) =>/);
  assert.match(source, /recordWarehouseOperationalActivity\([\s\S]*recordPreOrderSupplyEvent/);
  assert.match(source, /if \(updated === false\) throw new Error\("The Warehouse item did not update\."\)/);
  assert.match(source, /if \(!added\) throw new Error\("The partial Buy split did not complete\."\)/);
  assert.match(source, /failedItemKeys\.has\(action\.itemKey\)/);
  assert.doesNotMatch(source, /const changeWarehouseAvailability = async/);
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
  assert.match(source, /const restorePreOrderSplit = async/);
  assert.match(source, /saveOrderTotalsToDatabase\(orderId, finalItems, order\)/);
  assert.match(source, /restorePreOrderSplit=\{restorePreOrderSplit\}/);
});

test("Cannot Supply exposes permanent Available and Recall Available operations", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /recordWarehouseOperationalActivity/);
  assert.match(source, /actionType = recall \? "Recall Available" : "Available"/);
  assert.match(source, /referencedClientActionId:\s*actionType === "Recall Available" \? line\.latestAction\?\.clientActionId/s);
  assert.match(source, /recalledAvailableEventIds/);
});

test("all product-grouped Pre-Order tabs reuse Warehouse product sorting", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /import \{ compareWarehouseProducts \} from "\.\.\/utils\/warehouseProductSorting"/);
  assert.match(source, /subCategory: product\.subCategory \|\| product\.sub_category/);
  assert.match(source, /\.sort\(compareWarehouseProducts\)/);
  assert.match(source, /records: \[\.\.\.records\]\.sort\(\(left, right\) =>\s*compareWarehouseProducts/);
  assert.doesNotMatch(source, /\.sort\(\(a, b\) => a\.productName\.localeCompare\(b\.productName\)\)/);
});

test("orders leaving the live Warehouse workflow clear every active Pre-Order view only", () => {
  const liveOrder = { status: "Warehouse Packing" };
  const receivedOrder = { status: "Received" };
  const exitedOrder = { status: "Ready For Driver" };
  const event = {
    id: "permanent-event",
    itemKey: "ORD-1:item-1",
    itemId: "item-1",
    actionType: "Buy",
  };
  const permanentHistory = [event];

  assert.equal(isLivePreOrderDemandOrder(liveOrder), true);
  assert.equal(isLivePreOrderDemandOrder(receivedOrder), true);
  assert.equal(isActivePreOrderSupplyOrder(liveOrder), true);
  assert.equal(isActivePreOrderSupplyOrder(receivedOrder), false);
  assert.equal(isLivePreOrderSupplyEvent(event, new Set([event.itemKey]), new Set([event.itemId])), true);
  assert.equal(isLivePreOrderDemandOrder(exitedOrder), false);
  assert.equal(isLivePreOrderSupplyEvent(event, new Set(), new Set()), false);
  assert.deepEqual(permanentHistory, [event]);

  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /!isLivePreOrderSupplyEvent\(event, liveWarehouseItemKeys, liveWarehouseItemIds\)/);
  assert.match(source, /isLivePreOrderSupplyEvent\(entry, liveWarehouseItemKeys, liveWarehouseItemIds\)/);
  assert.match(source, /if \(!isActivePreOrderSupplyOrder\(order\)\) continue/);
  assert.match(source, /filterPendingPreOrderActionsForOrders\(current, orders\)/);
  assert.doesNotMatch(source, /setHistoryEvents\(\(current\).*filter/s);
});

test("pending POS state is retained only for live orders and can be cleared by order", () => {
  const actions = [{ orderId: "LIVE" }, { orderId: "DRIVER" }];
  assert.deepEqual(
    filterPendingPreOrderActionsForOrders(actions, [{ orderId: "LIVE", status: "Warehouse Packing" }]),
    [actions[0]],
  );
  const values = new Map([["fairchoice_preorder_supply_pending", JSON.stringify(actions)]]);
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  clearPendingPreOrderActionsForOrder("DRIVER", storage);
  assert.deepEqual(JSON.parse(values.get("fairchoice_preorder_supply_pending")), [actions[0]]);
});

test("Back to Received records additive supplier reversals before changing status", () => {
  const orderPage = fs.readFileSync(new URL("./CustomerOrder.jsx", import.meta.url), "utf8");
  const historyService = fs.readFileSync(new URL("../services/preOrderSupplyHistory.js", import.meta.url), "utf8");
  assert.match(orderPage, /status === "Received"[\s\S]*reversePreOrderSupplyForReceivedOrder[\s\S]*updateOrderStatus/);
  assert.match(historyService, /actionType: "Recall"/);
  assert.match(historyService, /reason: "Order moved back to Received"/);
  assert.match(historyService, /actionType: "Recall Available"/);
  assert.match(historyService, /sourceModule: "Order Lifecycle"/);
  assert.match(historyService, /\.sort\(\(left, right\) =>[\s\S]*new Date\(right\.timestamp/);
  assert.match(historyService, /recalledClientActionId: event\.clientActionId/);
  assert.match(historyService, /recalledEventId: event\.id/);
  assert.doesNotMatch(historyService, /delete.*preorder_supply_events/is);
});

test("Sync history captures authenticated actor identity without changing physical stock", () => {
  const supplierMigration = fs.readFileSync(
    new URL("../../supabase/migrations/20260801093000_preorder_supply_event_history.sql", import.meta.url),
    "utf8",
  );
  const warehouseMigration = fs.readFileSync(
    new URL("../../supabase/migrations/20260818225103_warehouse_operational_activity.sql", import.meta.url),
    "utf8",
  );
  for (const migration of [supplierMigration, warehouseMigration]) {
    assert.match(migration, /v_actor\.login_id/);
    assert.match(migration, /v_actor\.staff_id/);
    assert.match(migration, /v_actor\.username/);
    assert.match(migration, /v_actor\.staff_name/);
    assert.match(migration, /v_actor\.staff_role/);
  }
  const implementation = [
    fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../services/preOrderSupplyHistory.js", import.meta.url), "utf8"),
    warehouseMigration,
  ].join("\n");
  assert.doesNotMatch(implementation, /location_stock|product_location_stock|england_stock|wales_stock/i);
});
