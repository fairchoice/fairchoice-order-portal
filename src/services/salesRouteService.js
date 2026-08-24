import { supabase } from "./supabase";

const ROUTES_KEY = "fairchoice_sales_route_assignments_v1";
const VISITS_KEY = "fairchoice_sales_route_visits_v1";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const SALES_ROUTE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const EXCEPTION_ORDER_REASONS = [
  "Urgent customer request",
  "Customer not on today’s route",
  "Temporary route change",
  "Manager instruction",
  "New / unassigned customer",
  "Other",
];

export const NO_ORDER_REASONS = [
  "Customer has enough stock",
  "Buyer / owner unavailable",
  "Customer closed",
  "Price issue",
  "Payment / outstanding issue",
  "Bought from competitor",
  "Asked to return later",
  "Temporarily not trading",
  "Other",
];

const readLocal = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
};
const writeLocal = (key, rows) => localStorage.setItem(key, JSON.stringify(rows || []));
const missingRelation = (error) => ["42P01", "PGRST205", "PGRST204", "42703"].includes(error?.code) || /does not exist|schema cache/i.test(String(error?.message || ""));
const uuid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const getRouteDay = (value = new Date()) => DAYS[new Date(value).getDay()];
export const getBusinessDate = (value = new Date()) => {
  const d = new Date(value);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export async function loadSalesRouteStaff() {
  const { data, error } = await supabase.from("staff_users").select("id, staff_code, staff_name, role, active").eq("active", true).order("staff_name");
  if (error) return [];
  return (data || []).filter((row) => /sales|admin/i.test(String(row.role || "")));
}

export async function loadRouteAssignments() {
  const { data, error } = await supabase.from("sales_route_assignments").select("*").order("day_of_week").order("visit_sequence");
  if (!error) return data || [];
  if (!missingRelation(error)) throw error;
  return readLocal(ROUTES_KEY);
}

export async function saveRouteAssignment(input = {}) {
  const row = {
    id: input.id || uuid(),
    customer_account_id: input.customerAccountId,
    customer_branch_id: input.customerBranchId || null,
    assigned_staff_id: input.assignedStaffId || null,
    day_of_week: input.dayOfWeek,
    visit_sequence: Number(input.visitSequence || 1),
    active: input.active !== false,
    notes: String(input.notes || "").trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("sales_route_assignments").upsert(row, { onConflict: "id" }).select("*").single();
  if (!error) return data;
  if (!missingRelation(error)) throw error;
  const rows = readLocal(ROUTES_KEY);
  const index = rows.findIndex((item) => String(item.id) === String(row.id));
  if (index >= 0) rows[index] = row; else rows.push({ ...row, created_at: new Date().toISOString() });
  writeLocal(ROUTES_KEY, rows);
  return row;
}

export async function removeRouteAssignment(id) {
  const { error } = await supabase.from("sales_route_assignments").delete().eq("id", id);
  if (!error) return;
  if (!missingRelation(error)) throw error;
  writeLocal(ROUTES_KEY, readLocal(ROUTES_KEY).filter((row) => String(row.id) !== String(id)));
}

export async function loadRouteVisits({ dateFrom = null, dateTo = null } = {}) {
  let query = supabase.from("sales_route_visits").select("*").order("visited_at", { ascending: false });
  if (dateFrom) query = query.gte("business_date", dateFrom);
  if (dateTo) query = query.lte("business_date", dateTo);
  const { data, error } = await query;
  if (!error) return data || [];
  if (!missingRelation(error)) throw error;
  return readLocal(VISITS_KEY).filter((row) => (!dateFrom || row.business_date >= dateFrom) && (!dateTo || row.business_date <= dateTo));
}

export async function recordSalesRouteVisit({
  customerAccountId,
  customerBranchId = null,
  staffId = null,
  staffName = "",
  outcome,
  reason = "",
  note = "",
  orderNumber = null,
  routeAssignmentId = null,
  businessDate = getBusinessDate(),
} = {}) {
  if (!customerAccountId) return null;
  const row = {
    id: uuid(),
    route_assignment_id: routeAssignmentId || null,
    customer_account_id: customerAccountId,
    customer_branch_id: customerBranchId || null,
    staff_id: staffId || null,
    staff_name: staffName || null,
    business_date: businessDate,
    outcome: String(outcome || "VISITED").toUpperCase(),
    no_order_reason: String(reason || "").trim() || null,
    note: String(note || "").trim() || null,
    order_number: orderNumber || null,
    visited_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("sales_route_visits").insert(row).select("*").single();
  if (!error) return data;
  if (!missingRelation(error)) throw error;
  const rows = readLocal(VISITS_KEY);
  rows.push(row); writeLocal(VISITS_KEY, rows); return row;
}

export async function loadTodaysSalesRoute({ customers = [], currentUser = null, date = new Date() } = {}) {
  const day = getRouteDay(date);
  const dateKey = getBusinessDate(date);
  const [assignments, visits] = await Promise.all([
    loadRouteAssignments(),
    loadRouteVisits({ dateFrom: dateKey, dateTo: dateKey }),
  ]);
  const staffId = currentUser?.staff_id || currentUser?.id || null;
  const byCustomer = new Map((customers || []).map((customer) => [String(customer.id), customer]));
  return assignments
    .filter((row) => row.active !== false && row.day_of_week === day)
    .filter((row) => !row.assigned_staff_id || !staffId || String(row.assigned_staff_id) === String(staffId))
    .map((row) => {
      const customer = byCustomer.get(String(row.customer_account_id));
      const branches = customer?.customer_branches || [];
      const branch = branches.find((item) => String(item.id) === String(row.customer_branch_id)) || null;
      const visit = visits.find((item) => String(item.route_assignment_id || "") === String(row.id) || (
        String(item.customer_account_id) === String(row.customer_account_id) &&
        String(item.customer_branch_id || "") === String(row.customer_branch_id || "")
      ));
      return { ...row, customer, branch, visit, status: visit?.outcome || "NOT_VISITED" };
    })
    .filter((row) => row.customer)
    .sort((a, b) => Number(a.visit_sequence || 0) - Number(b.visit_sequence || 0));
}

export async function loadSalesRouteAnalysis({ customers = [] } = {}) {
  const [assignments, visits, ordersResult] = await Promise.all([
    loadRouteAssignments(),
    loadRouteVisits(),
    supabase.from("orders").select("id, order_number, customer_account_id, customer_branch_id, company_name, created_at, status, order_total, total_amount, customer_country, delivery_postcode, delivery_branch_name").order("created_at", { ascending: false }).limit(5000),
  ]);
  const orders = ordersResult.error ? [] : (ordersResult.data || []).filter((row) => !/cancel|void|deleted/i.test(String(row.status || "")));
  const lastOrderByCustomer = new Map();
  orders.forEach((order) => {
    const key = String(order.customer_account_id || "");
    if (!key) return;
    if (!lastOrderByCustomer.has(key)) lastOrderByCustomer.set(key, order);
  });
  const now = Date.now();
  const customerRows = (customers || []).map((customer) => {
    const lastOrder = lastOrderByCustomer.get(String(customer.id)) || null;
    const daysSinceOrder = lastOrder ? Math.floor((now - new Date(lastOrder.created_at).getTime()) / 86400000) : null;
    const customerVisits = visits.filter((visit) => String(visit.customer_account_id) === String(customer.id));
    const noOrders = customerVisits.filter((visit) => visit.outcome === "NO_ORDER");
    const orderVisits = customerVisits.filter((visit) => visit.outcome === "ORDER_PLACED");
    return { customer, lastOrder, daysSinceOrder, visits: customerVisits.length, noOrders: noOrders.length, orderVisits: orderVisits.length };
  });
  const assignedIds = new Set(assignments.filter((row) => row.active !== false).map((row) => String(row.customer_account_id)));
  const newCustomers = customerRows.filter((row) => {
    const created = new Date(row.customer.created_at || row.customer.approved_at || 0).getTime();
    return created && now - created <= 30 * 86400000;
  });
  const inactive14 = customerRows.filter((row) => row.daysSinceOrder === null || row.daysSinceOrder > 14);
  const locationMap = new Map();
  customerRows.forEach((row) => {
    const c = row.customer;
    const country = String(c.country || c.account_country || c.default_country || (c.customer_branches || []).find((b) => b?.active !== false)?.country || "Unknown").trim() || "Unknown";
    const location = String(c.town_city || c.city || c.postcode || "Unknown").trim() || "Unknown";
    const key = `${country}::${location}`;
    const current = locationMap.get(key) || { country, location, customers: 0, assigned: 0, visits: 0, orders: 0, noOrders: 0 };
    current.customers += 1;
    if (assignedIds.has(String(c.id))) current.assigned += 1;
    current.visits += row.visits;
    current.orders += row.orderVisits;
    current.noOrders += row.noOrders;
    locationMap.set(key, current);
  });
  const todayKey = getBusinessDate();
  const todayDay = getRouteDay();
  const missedToday = assignments
    .filter((route) => route.active !== false && route.day_of_week === todayDay)
    .filter((route) => !visits.some((visit) => visit.business_date === todayKey && (
      String(visit.route_assignment_id || "") === String(route.id) || (
        String(visit.customer_account_id) === String(route.customer_account_id) &&
        String(visit.customer_branch_id || "") === String(route.customer_branch_id || "")
      )
    )))
    .map((route) => ({ route, customer: (customers || []).find((customer) => String(customer.id) === String(route.customer_account_id)) }))
    .filter((row) => row.customer)
    .sort((a, b) => Number(a.route.visit_sequence || 0) - Number(b.route.visit_sequence || 0));

  return {
    assignments,
    visits,
    customerRows,
    inactive14,
    newCustomers,
    missedToday,
    unassigned: customerRows.filter((row) => !assignedIds.has(String(row.customer.id))),
    locations: [...locationMap.values()].sort((a, b) => b.customers - a.customers),
    orders,
  };
}
