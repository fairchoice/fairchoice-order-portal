import { canPerform } from "../security/accessControlRegistry.js";

const LEGACY_PERMISSION_ALIASES = Object.freeze({
  access_sales_rep: "page.order.sales_rep",
  access_received_orders: "page.operations.received_orders",
  access_driver: "page.operations.driver",
  access_warehouse: "page.operations.warehouse",
  access_customer_setup: "page.admin.customer_setup",
  access_product_setup: "page.product.products",
  access_accounts: "page.accounts.central_payment",
  access_reports: "page.reports.sales",
  can_edit_security: "page.login.access_control",
  access_staff_login: "page.login.staff_login",
  access_customer_login: "page.login.customer_login",
  can_edit_pricing: "page.product.pricing_rules",
  can_receive_order: "orders.receive",
  can_change_order_status_in_progress: "orders.status.change",
  can_add_product_to_order: "orders.items.change",
  can_move_to_warehouse: "orders.status.change",
  can_cancel_order: "orders.cancel",
  can_archive_order: "orders.archive",
});

export function hasPermission(user, permissionKey) {
  const saved = user?.effective_permissions || user?.permissions || {};
  if (saved[permissionKey] === true) return canPerform(user, permissionKey);
  return canPerform(user, LEGACY_PERMISSION_ALIASES[permissionKey] || permissionKey);
}

export function requirePermission(
  user,
  permissionKey,
  message = "You do not have permission for this action."
) {
  if (!hasPermission(user, permissionKey)) {
    alert(message);
    return false;
  }

  return true;
}
