/** Minimal typed-ish event emitter. Used to keep UI in sync with state objects. */
export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} unsubscribe
   */
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event, ...args) {
    // Copy before iterating: a handler may unsubscribe itself.
    for (const handler of [...(this._listeners.get(event) ?? [])]) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[emitter] handler for "${event}" threw`, err);
      }
    }
  }
}
