const roleAccess = {
  Admin: [
    "orders",
    "admin",
    "admin_config",
    "products",
    "received",
    "customer_credit",
    "stock_history",
    "stock_receipts",
    "warehouse",
    "driver",
  ],

  Warehouse: ["warehouse"],
  Driver: ["driver"],
  "Sales Rep": ["orders"],
  Customer: ["orders"],
};

export default function canAccess(role, page) {
  return roleAccess[role]?.includes(page);
}