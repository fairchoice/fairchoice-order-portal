import assert from "node:assert/strict";
import test from "node:test";

import {
  clearFcSessionStorage,
  getFcSessionState,
  isInvalidFcSessionError,
  mergeAuthenticatedProfile,
  readStoredFcProfile,
} from "./fcSession.js";

const futureExpiry = "2099-01-01T12:00:00.000Z";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
    has: (key) => values.has(key),
  };
}

test("Back Office profile refresh preserves FC token, expiry, and session-only fields", () => {
  const current = {
    id: "login-1",
    login_user_id: "login-1",
    username: "nisstaj_admin",
    staff_name: "Old name",
    fc_session_token: "valid-token",
    fc_session_expires_at: futureExpiry,
    session_token: "compatibility-token",
  };
  const refreshed = {
    id: "login-1",
    login_user_id: "login-1",
    username: "nisstaj_admin",
    staff_name: "Updated name",
    permissions: { all_access: true },
  };

  const merged = mergeAuthenticatedProfile(current, refreshed);
  assert.equal(merged.staff_name, "Updated name");
  assert.equal(merged.fc_session_token, "valid-token");
  assert.equal(merged.fc_session_expires_at, futureExpiry);
  assert.equal(merged.session_token, "compatibility-token");
});

test("fresh login replaces an expired token for the same identity", () => {
  const merged = mergeAuthenticatedProfile(
    {
      id: "login-1",
      username: "nisstaj_admin",
      fc_session_token: "expired-token",
      fc_session_expires_at: "2020-01-01T00:00:00Z",
    },
    {
      id: "login-1",
      username: "nisstaj_admin",
      fc_session_token: "fresh-token",
      fc_session_expires_at: futureExpiry,
    },
  );

  assert.equal(merged.fc_session_token, "fresh-token");
  assert.equal(merged.fc_session_expires_at, futureExpiry);
});

test("account switching cannot combine one username with another token", () => {
  const switched = mergeAuthenticatedProfile(
    {
      id: "login-1",
      username: "nisstaj_admin",
      fc_session_token: "admin-token",
      fc_session_expires_at: futureExpiry,
    },
    {
      id: "login-2",
      username: "other_admin",
      staff_name: "Other Admin",
    },
  );

  assert.equal(switched.username, "other_admin");
  assert.equal(switched.fc_session_token, undefined);
  assert.equal(switched.fc_session_expires_at, undefined);
});

test("stored compatibility profiles must identify the same login", () => {
  const storage = memoryStorage({
    fairchoice_user: JSON.stringify({
      id: "login-1",
      username: "nisstaj_admin",
      fc_session_token: "token-1",
      fc_session_expires_at: futureExpiry,
    }),
    loggedInUser: JSON.stringify({
      id: "login-2",
      username: "other_admin",
      fc_session_token: "token-2",
      fc_session_expires_at: futureExpiry,
    }),
  });

  assert.equal(readStoredFcProfile(storage), null);
});

test("missing and expired FC sessions are invalid before financial reads", () => {
  assert.equal(
    getFcSessionState({
      username: "nisstaj_admin",
      fc_session_expires_at: futureExpiry,
    }).valid,
    false,
  );
  const expired = getFcSessionState(
    {
      username: "nisstaj_admin",
      fc_session_token: "expired",
      fc_session_expires_at: "2026-01-01T00:00:00Z",
    },
    Date.parse("2026-01-02T00:00:00Z"),
  );
  assert.equal(expired.expired, true);
  assert.equal(expired.valid, false);
});

test("PostgreSQL 28000 is recognized and invalidation clears all FC storage", () => {
  assert.equal(
    isInvalidFcSessionError({
      code: "28000",
      message: "FC session is invalid or expired. Please sign in again.",
    }),
    true,
  );

  const storage = memoryStorage({
    fairchoice_user: "{}",
    loggedInUser: "{}",
    fc_session_token: "token",
    fc_session_expires_at: futureExpiry,
    loginPortal: "staff",
    fairchoice_last_active: "1",
  });
  clearFcSessionStorage(storage);
  for (const key of [
    "fairchoice_user",
    "loggedInUser",
    "fc_session_token",
    "fc_session_expires_at",
    "loginPortal",
    "fairchoice_last_active",
  ]) {
    assert.equal(storage.has(key), false);
  }
});
