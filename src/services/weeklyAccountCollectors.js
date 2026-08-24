import { getFcSessionState, readStoredFcProfile } from "./fcSession.js";
import { supabase } from "./supabase.js";

export const normalizeCollectorText = (value) =>
  String(value || "").trim().toLocaleLowerCase();

export function normalizeCollectorType(value) {
  const role = normalizeCollectorText(value).replace(/[^a-z]/g, "");
  if (role.includes("driver")) return "Driver";
  if (role.includes("salesrep") || role.includes("salesrepresentative")) {
    return "Sales Rep";
  }
  return null;
}

export function collectorStaffId(row = {}) {
  return String(
    row.collector_staff_id ||
      row.metadata?.collector_staff_id ||
      "",
  ).trim();
}

export function collectorName(row = {}) {
  return String(
    row.collector_name ||
      row.driver_name ||
      row.sales_rep_name ||
      row.collected_by ||
      row.metadata?.collector_name ||
      row.metadata?.driver_name ||
      row.metadata?.sales_rep_name ||
      "",
  ).trim();
}

export function collectorType(row = {}) {
  return normalizeCollectorType(
    row.collector_type ||
      row.collection_type ||
      row.collector_role ||
      row.collected_by_role ||
      row.metadata?.collector_role,
  );
}

const identityAliases = (identity = {}) =>
  [
    identity.staff_name,
    identity.username,
    ...(Array.isArray(identity.login_aliases) ? identity.login_aliases : []),
  ]
    .map(normalizeCollectorText)
    .filter(Boolean);

export function buildCollectorOptions(identities = [], legacyRows = []) {
  const byStaffId = new Map();

  identities.forEach((identity) => {
    const staffId = String(identity.staff_id || "").trim();
    const type = normalizeCollectorType(identity.collector_type || identity.role);
    if (!staffId || !type) return;

    const existing = byStaffId.get(staffId);
    const aliases = new Set([
      ...(existing?.aliases || []),
      ...identityAliases(identity),
    ]);
    const username = String(identity.username || existing?.username || "").trim();
    const staffName = String(identity.staff_name || existing?.staffName || "").trim();
    byStaffId.set(staffId, {
      value: staffId,
      staffId,
      type,
      username,
      staffName,
      nameSnapshot: staffName || username,
      label:
        staffName && username && normalizeCollectorText(staffName) !== normalizeCollectorText(username)
          ? `${staffName} — ${username}`
          : staffName || username,
      aliases: [...aliases],
      legacy: false,
    });
  });

  const identityOptions = [...byStaffId.values()];
  const legacyOptions = new Map();
  legacyRows.forEach((row) => {
    if (collectorStaffId(row)) return;
    const type = collectorType(row);
    const name = collectorName(row);
    const normalizedName = normalizeCollectorText(name);
    if (!type || !normalizedName) return;

    const matches = identityOptions.filter(
      (option) => option.type === type && option.aliases.includes(normalizedName),
    );
    if (matches.length === 1) return;

    const key = `${type}|${normalizedName}`;
    if (!legacyOptions.has(key)) {
      legacyOptions.set(key, {
        value: `legacy:${key}`,
        staffId: "",
        type,
        username: "",
        staffName: "",
        nameSnapshot: name,
        label: name,
        aliases: [normalizedName],
        legacy: true,
      });
    }
  });

  return [...identityOptions, ...legacyOptions.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
  );
}

export function collectorOptionMatchesRow(option, row = {}) {
  if (!option || collectorType(row) !== option.type) return false;
  const rowStaffId = collectorStaffId(row);
  if (rowStaffId) return Boolean(option.staffId) && rowStaffId === option.staffId;
  return option.aliases.includes(normalizeCollectorText(collectorName(row)));
}

export async function loadWeeklyAccountCollectors(currentUser = {}) {
  let session = getFcSessionState(currentUser);
  if (!session.valid) session = getFcSessionState(readStoredFcProfile());
  if (!session.valid) {
    throw new Error("A valid FC login session is required to load collectors.");
  }

  const { data, error } = await supabase.rpc("fc_list_weekly_account_collectors_v1", {
    p_username: session.username,
    p_session_token: session.token,
  });
  if (error) throw error;
  return data || [];
}
