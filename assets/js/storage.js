/**
 * Persistence adapter.
 *
 * Game and shop logic depend on this interface, never on `localStorage`
 * directly, so the same modules run under `node --test` with an in-memory
 * store. It also degrades gracefully in private-browsing modes where
 * `localStorage` exists but throws on write.
 */

/** @typedef {{get(key:string):unknown, set(key:string,value:unknown):void, remove(key:string):void, keys():string[]}} Store */

/** In-memory store. The default in Node and the fallback when the DOM store is unusable. */
export function createMemoryStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get: (key) => (map.has(key) ? structuredClone(map.get(key)) : undefined),
    set: (key, value) => void map.set(key, structuredClone(value)),
    remove: (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

/**
 * localStorage-backed store, namespaced so the casino and the shop never
 * collide, with JSON (de)serialisation and quota failures contained.
 * @param {string} namespace
 * @returns {Store}
 */
export function createLocalStore(namespace) {
  const prefix = `${namespace}:`;
  let backing;

  try {
    const probe = `${prefix}__probe__`;
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    backing = globalThis.localStorage;
  } catch {
    // Private mode, disabled storage, or a non-DOM runtime: state stays in memory
    // for the tab's lifetime rather than crashing the app.
    console.warn(`[storage] localStorage unavailable for "${namespace}"; using memory`);
    return createMemoryStore();
  }

  return {
    get(key) {
      const raw = backing.getItem(prefix + key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        // Corrupted entry (hand-edited, or written by an older schema).
        backing.removeItem(prefix + key);
        return undefined;
      }
    },
    set(key, value) {
      try {
        backing.setItem(prefix + key, JSON.stringify(value));
      } catch (err) {
        console.warn(`[storage] write failed for "${key}"`, err);
      }
    },
    remove(key) {
      backing.removeItem(prefix + key);
    },
    keys() {
      return Object.keys(backing)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
  };
}

/** Picks the right store for the current runtime. */
export function createStore(namespace) {
  const hasDom = typeof globalThis.localStorage !== "undefined";
  return hasDom ? createLocalStore(namespace) : createMemoryStore();
}
