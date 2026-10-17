export const PERFORMANCE_GROUPS = Object.freeze([
  "Middleton England", "South England", "West England", "East England", "Wales",
]);

export function requirePerformanceGroup(value) {
  const group = String(value || "").trim();
  if (!PERFORMANCE_GROUPS.includes(group)) throw new Error("Performance Group is required. Select a listed group.");
  return group;
}

// Used for trade applications and the initial migration only. Customer edits
// retain the explicit saved selection; an address change never moves it silently.
export function suggestPerformanceGroup(customer = {}) {
  const address = [customer.town_city, customer.city, customer.address, customer.address_line_1, customer.address_line_2].filter(Boolean).join(" ");
  if (/\b(southampton|portsmouth|shillington)\b/i.test(address)) return "South England";
  if (/\bswindon\b/i.test(address)) return "West England";
  if (/\bnewport\b/i.test(address)) return "Wales";
  if (/\bkent\b/i.test(address)) return "East England";
  return /^(wales|wls|gb-wls)$/i.test(String(customer.country || "").trim()) ? "Wales" : "Middleton England";
}

export const AGENCY_GROUP_PERMISSIONS = Object.freeze(PERFORMANCE_GROUPS.map((group) => Object.freeze({
  key: `agency.${group.toLowerCase().replaceAll(" ", "_")}`, label: group,
})));
export const AGENCY_SHARED_PERMISSION = "agency.shared_totals";
export const AGENCY_ACCESS_OPTIONS = Object.freeze([
  ...AGENCY_GROUP_PERMISSIONS,
  Object.freeze({ key: AGENCY_SHARED_PERMISSION, label: "Shared stock and business expenses" }),
]);
