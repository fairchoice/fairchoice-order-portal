const normalizeScope = (value) => String(value || "").trim().toLowerCase();

// One scope controls both the preview list and every bulk assignment action.
export function filterCustomerCodeScope(customers = [], {
  country = "All", city = "All", excludedCities = [], search = "", includeInactive = false,
} = {}) {
  const exclusions = new Set(excludedCities.map(normalizeScope));
  const term = normalizeScope(search);
  return customers.filter((customer) => {
    if (!includeInactive && customer.active === false) return false;
    if (country !== "All" && normalizeScope(customer.country) !== normalizeScope(country)) return false;
    if (city !== "All" && normalizeScope(customer.town_city) !== normalizeScope(city)) return false;
    if (exclusions.has(normalizeScope(customer.town_city))) return false;
    return !term || [customer.account_name, customer.town_city, customer.country, customer.postcode]
      .some((value) => normalizeScope(value).includes(term));
  });
}
