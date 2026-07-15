export const OWNER_USERNAME = "nisstaj_admin";

export function isOwnerUser(user) {
  return String(user?.username || "").trim().toLowerCase() === OWNER_USERNAME;
}
