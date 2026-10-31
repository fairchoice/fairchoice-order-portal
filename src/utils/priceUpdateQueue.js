export const mergePendingPriceUpdates = (current = [], added = []) =>
  [...new Set([...current, ...added].filter(Boolean).map(String))];

export const removePendingPriceUpdates = (current = [], applied = []) => {
  const removed = new Set(applied.map(String));
  return current.filter(id => !removed.has(String(id)));
};

export function readPendingPriceUpdates(key, storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(key) || "[]");
    return Array.isArray(value) ? mergePendingPriceUpdates([], value.filter(id => typeof id === "string")) : [];
  } catch { return []; }
}

export function writePendingPriceUpdates(key, ids, storage = globalThis.localStorage) {
  storage?.setItem(key, JSON.stringify(mergePendingPriceUpdates([], ids)));
}
