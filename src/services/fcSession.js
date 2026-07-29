export const FC_PROFILE_STORAGE_KEYS = ["fairchoice_user", "loggedInUser"];

const SESSION_FIELD_PATTERN =
  /^(?:fc_session_|session_token$|sessionToken$|session_expires_at$)/;

function parseStoredProfile(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function loginIdentity(profile = {}) {
  const loginId = String(
    profile.login_user_id || profile.login_id || profile.id || "",
  ).trim();
  const username = String(
    profile.username || profile.user_name || "",
  ).trim().toLowerCase();
  return { loginId, username };
}

export function profilesShareLoginIdentity(left, right) {
  if (!left || !right) return false;
  const leftIdentity = loginIdentity(left);
  const rightIdentity = loginIdentity(right);

  if (leftIdentity.loginId && rightIdentity.loginId) {
    return leftIdentity.loginId === rightIdentity.loginId;
  }
  return Boolean(
    leftIdentity.username &&
      rightIdentity.username &&
      leftIdentity.username === rightIdentity.username,
  );
}

export function mergeAuthenticatedProfile(currentProfile, refreshedProfile) {
  if (!currentProfile) return refreshedProfile || null;
  if (!refreshedProfile) return currentProfile;

  if (!profilesShareLoginIdentity(currentProfile, refreshedProfile)) {
    return { ...refreshedProfile };
  }

  const merged = { ...currentProfile, ...refreshedProfile };
  for (const [key, value] of Object.entries(currentProfile)) {
    if (
      SESSION_FIELD_PATTERN.test(key) &&
      (refreshedProfile[key] === undefined ||
        refreshedProfile[key] === null ||
        refreshedProfile[key] === "")
    ) {
      merged[key] = value;
    }
  }
  return merged;
}

export function readStoredFcProfile(storage = globalThis?.localStorage) {
  if (!storage) return null;
  const profiles = FC_PROFILE_STORAGE_KEYS.map((key) =>
    parseStoredProfile(storage.getItem(key)),
  ).filter(Boolean);

  if (!profiles.length) return null;
  if (profiles.length === 1) return profiles[0];
  if (!profilesShareLoginIdentity(profiles[0], profiles[1])) return null;
  return mergeAuthenticatedProfile(profiles[0], profiles[1]);
}

function parseExpiry(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function getFcSessionState(profile, now = Date.now()) {
  const username = String(
    profile?.username || profile?.user_name || "",
  ).trim();
  const token =
    profile?.fc_session_token ||
    profile?.session_token ||
    profile?.sessionToken ||
    "";
  const expiresAt = parseExpiry(
    profile?.fc_session_expires_at ?? profile?.session_expires_at,
  );
  const missing = !username || !token || !expiresAt;
  const expired = Boolean(expiresAt && expiresAt <= now);

  return {
    username,
    token,
    expiresAt,
    missing,
    expired,
    valid: !missing && !expired,
  };
}

export function isInvalidFcSessionError(error) {
  const code = String(error?.code || error?.status || "");
  const message = String(error?.message || error?.details || error || "");
  return (
    code === "28000" ||
    /fc session is invalid or expired/i.test(message) ||
    /fc login session is (?:required|missing)/i.test(message)
  );
}

export function clearFcSessionStorage(storage = globalThis?.localStorage) {
  if (!storage) return;
  for (const key of [
    ...FC_PROFILE_STORAGE_KEYS,
    "fc_session_token",
    "fc_session_expires_at",
    "loginPortal",
    "fairchoice_last_active",
  ]) {
    storage.removeItem(key);
  }
}
