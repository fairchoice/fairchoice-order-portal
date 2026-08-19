export const MASTER_ADMIN_USERNAME = "nisstaj_admin";

export const STAFF_ROLES = Object.freeze([
  "Admin",
  "Accounts",
  "Accountant",
  "Sales Rep",
  "Driver",
  "Warehouse",
  "Super Admin",
]);

const page = (key, label, route, defaultRoles = [], extra = {}) =>
  Object.freeze({ key, label, route, page: route, defaultRoles, ...extra });

export const PAGE_ACCESS_SECTIONS = Object.freeze([
  {
    title: "Order",
    items: [
      page("page.order.sales_rep", "Sales Rep Order", "order", ["Sales Rep"]),
      page("page.order.sales_invoice", "Sales Invoice", "orderSalesInvoices", STAFF_ROLES.filter((role) => role !== "Super Admin"), { readOnly: true }),
    ],
  },
  {
    title: "Operations",
    items: [
      page("page.operations.received_orders", "Received Orders", "orders", ["Warehouse", "Admin"], { fetchOrdersAfter: true }),
      page("page.operations.driver", "Driver Portal", "driver", ["Driver", "Admin"], { fetchOrdersBefore: true }),
      page("page.operations.returns", "Returns", "returnsPortal", ["Warehouse", "Admin"]),
      page("page.operations.warehouse", "Warehouse", "warehouse", ["Warehouse", "Admin"], { fetchOrdersBefore: true }),
      page("page.operations.pre_order_supply", "Pre-Order Supply", "preOrderSupply", ["Warehouse", "Admin"], { fetchOrdersBefore: true }),
    ],
  },
  {
    title: "Admin Setup",
    items: [
      page("page.admin.staff_setup", "Staff Setup", "staff"),
      page("page.admin.customer_setup", "Customer Setup", "customers"),
      {
        label: "Login",
        children: [
          page("page.login.staff_login", "Staff Login", "staffLogin"),
          page("page.login.customer_login", "Customer Login", "customerLogin"),
          page("page.login.access_control", "Access Control", "accessControl"),
        ],
      },
      {
        label: "Product Setup",
        children: [
          page("page.product.categories", "Categories", "categories", ["Admin"]),
          page("page.product.home_content", "Home Page Content", "homePageImages"),
          page("page.product.products", "Products", "products", ["Admin"]),
          page("page.product.stock_taking", "Stock Taking", "stockTaking", ["Admin"]),
          page("page.product.import", "Product Import / Upload", "productImportExport"),
          page("page.product.pricing_rules", "Pricing Rules", "pricingRule"),
          page("page.product.price_management", "Price Management", "priceManagement"),
          page("page.product.promotion", "Promotion", "promotions"),
        ],
      },
    ],
  },
  {
    title: "Supplier",
    items: [page("page.supplier.setup", "Supplier", "suppliers")],
  },
  {
    title: "Accounts",
    items: [
      page("page.accounts.central_payment", "Central Payment", "centralPayment"),
      page("page.accounts.customer_credit", "Customer Credit", "credit", [], { hash: "#credit" }),
      page("page.accounts.invoices", "Invoices", "invoicesPortal"),
      page("page.accounts.weekly", "Weekly Account", "weeklyAccount"),
      page("page.accounts.supplier_accounts", "Supplier Accounts", "supplierAccounts"),
      page("page.accounts.expenses", "Expenses", "expenses", STAFF_ROLES.filter((role) => role !== "Super Admin")),
      page("page.accounts.branch_separation", "Branch Separation", "branchSeparation"),
    ],
  },
  {
    title: "Reports",
    items: [
      page("page.reports.profit", "Profit Portal", "profitPortal"),
      page("page.reports.product_line", "Product Line Analysis", "productLineAnalysis"),
      page("page.reports.sales", "Sales Report", "salesReports"),
      page("page.reports.purchase_planning", "Purchase Planning", "purchasePlanning"),
      page("page.reports.warehouse_activity", "Warehouse Activity", "warehouseActivity"),
      page("page.reports.outstanding_customer", "Outstanding Customer", "outstandingCustomers"),
      page("page.reports.collections", "Collections Report", "collectionsReport"),
      page("page.reports.driver_collection", "Driver Collection", "driverCollections"),
    ],
  },
  {
    title: "System",
    items: [
      page("page.system.audit_log", "Audit Log", "auditLog"),
      page("page.system.import_export", "Import / Export", "importExport"),
      page("page.system.backup", "Backup Tools", "backupTools"),
    ],
  },
]);

const action = (key, label, group) => Object.freeze({ key, label, group });

export const IMPORTANT_FUNCTION_PERMISSIONS = Object.freeze([
  action("orders.receive", "Receive order", "Orders"),
  action("orders.status.change", "Change order status", "Orders"),
  action("orders.items.change", "Add, remove or change order products", "Orders"),
  action("orders.quantity.change", "Change order quantity", "Orders"),
  action("orders.amount.change", "Change order amount or item price", "Orders"),
  action("orders.discount.change", "Apply or change discounts", "Orders"),
  action("orders.price_mode.change", "Change restricted price mode", "Orders"),
  action("orders.cancel", "Cancel order", "Orders"),
  action("orders.archive", "Archive or restore order", "Orders"),
  action("orders.delete", "Permanently delete order", "Orders"),
  action("orders.recall", "Recall order", "Orders"),
  action("orders.recall_all", "Recall all orders", "Orders"),
  action("invoices.amend", "Amend invoice", "Invoices"),
  action("invoices.void", "Void invoice", "Invoices"),
  action("invoices.financial_void", "Financially void invoice", "Invoices"),
  action("invoices.replace", "Regenerate or replace invoice", "Invoices"),
  action("payments.edit", "Edit payment", "Payments"),
  action("payments.reverse", "Reverse or remove payment", "Payments"),
  action("payments.delete", "Permanently delete payment", "Payments"),
  action("payments.amount.change", "Change payment amount", "Payments"),
  action("payments.reallocate", "Reallocate payment", "Payments"),
  action("payments.manual_credit", "Create manual credit", "Payments"),
  action("customer_credit.opening_balance_edit", "Change opening balance", "Customer Credit"),
  action("customer_credit.balance_adjust", "Manual balance adjustment", "Customer Credit"),
  action("customer_credit.credit_limit_edit", "Change credit limit", "Customer Credit"),
  action("stock.manual_adjust", "Manual stock adjustment", "Stock"),
  action("stock.received_quantity_change", "Change received stock quantity", "Stock"),
  action("stock.movement_reverse", "Delete or reverse stock movement", "Stock"),
  action("stock.recall", "Stock recall", "Stock"),
  action("stock.take_difference_approve", "Approve stock-taking differences", "Stock"),
  action("returns.approve", "Approve return", "Stock"),
  action("returns.reverse", "Reverse return approval", "Stock"),
  action("returns.reconcile", "Reconcile return", "Stock"),
  action("system.import_sensitive", "Import sensitive data", "System"),
  action("system.export_sensitive", "Export sensitive data", "System"),
  action("system.backup_restore", "Use backup or restore tools", "System"),
  action("system.delete_records", "Delete records", "System"),
  action("staff.manage", "Manage staff identities and login lifecycle", "System"),
  action("customers.create_login", "Manage customer portal logins", "System"),
  action("permissions.manage", "Manage access control", "System"),
]);

export const PAGE_REGISTRY = Object.freeze(
  PAGE_ACCESS_SECTIONS.flatMap((section) =>
    section.items.flatMap((item) => item.children || [item])
  )
);

export const PAGE_BY_ROUTE = Object.freeze(
  Object.fromEntries(PAGE_REGISTRY.map((item) => [item.route, item]))
);

export const ALL_PAGE_PERMISSION_KEYS = Object.freeze(PAGE_REGISTRY.map((item) => item.key));
export const ALL_IMPORTANT_FUNCTION_KEYS = Object.freeze(IMPORTANT_FUNCTION_PERMISSIONS.map((item) => item.key));
export const ALL_REGISTERED_PERMISSION_KEYS = Object.freeze([
  ...ALL_PAGE_PERMISSION_KEYS,
  ...ALL_IMPORTANT_FUNCTION_KEYS,
]);

export function normalizeRole(role) {
  const compact = String(role || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
  const roles = {
    admin: "Admin",
    administrator: "Admin",
    accounts: "Accounts",
    accountant: "Accountant",
    salesrep: "Sales Rep",
    salesrepresentative: "Sales Rep",
    driver: "Driver",
    warehouse: "Warehouse",
    superadmin: "Super Admin",
    customer: "Customer",
  };
  return roles[compact] || String(role || "Staff").trim() || "Staff";
}

export function isMasterAdmin(user) {
  return String(user?.username || user?.user_name || "").trim().toLowerCase() === MASTER_ADMIN_USERNAME;
}

export function isStaffUser(user) {
  return Boolean(user) && normalizeRole(user.role || user.access_level) !== "Customer";
}

export function permissionMap(user) {
  return user?.effective_permissions || user?.permissions || {};
}

export function canPerform(user, permissionKey) {
  if (!isStaffUser(user) || user?.active === false) return false;
  if (isMasterAdmin(user) || normalizeRole(user.role || user.access_level) === "Super Admin") return true;
  const permissions = permissionMap(user);
  return permissions.all_access === true || permissions[permissionKey] === true;
}

export function canAccessPage(user, pageOrPermissionKey) {
  const entry = PAGE_BY_ROUTE[pageOrPermissionKey];
  const permissionKey = entry?.key || pageOrPermissionKey;
  return canPerform(user, permissionKey);
}

export function getRoleDefaultPermissionKeys(role) {
  const normalized = normalizeRole(role);
  if (normalized === "Super Admin") return [...ALL_REGISTERED_PERMISSION_KEYS];
  return PAGE_REGISTRY.filter((item) => item.defaultRoles.includes(normalized)).map((item) => item.key);
}

export function groupImportantFunctionPermissions() {
  return IMPORTANT_FUNCTION_PERMISSIONS.reduce((groups, item) => {
    (groups[item.group] ||= []).push(item);
    return groups;
  }, {});
}

export function getAccessiblePageSections(user) {
  const filterItems = (items = []) => items
    .map((item) => item.children ? { ...item, children: filterItems(item.children) } : item)
    .filter((item) => item.children ? item.children.length > 0 : canAccessPage(user, item.key));
  return PAGE_ACCESS_SECTIONS
    .map((section) => ({ ...section, items: filterItems(section.items) }))
    .filter((section) => section.items.length > 0);
}
