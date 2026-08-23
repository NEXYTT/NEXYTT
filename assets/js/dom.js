/**
 * Tiny DOM helpers. Deliberately not a framework: the whole project ships with
 * zero dependencies and no build step, so these cover the 90% case
 * (create element, query, delegate, toast, dialog) and nothing more.
 */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Create an element.
 *   el("button.btn.btn--primary", { onclick: fn }, "Apostar")
 *   el("div", { class: "row" }, [child1, child2])
 *
 * Tag syntax supports `tag.class.class#id`. Props starting with `on` bind
 * listeners; `dataset` and `style` accept objects; everything else becomes an
 * attribute, except known DOM properties which are assigned directly so that
 * `value`, `checked` and `disabled` behave as expected.
 *
 * @param {string} spec
 * @param {Record<string, any>} [props]
 * @param {any} [children]
 * @returns {HTMLElement}
 */
export function el(spec, props = {}, children = []) {
  const [head, ...classes] = spec.split(".");
  const [tag, id] = head.split("#");
  const node = document.createElement(tag || "div");

  if (id) node.id = id;
  if (classes.length) node.classList.add(...classes);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;

    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key === "class" || key === "className") {
      node.className = [node.className, value].filter(Boolean).join(" ");
    } else if (key === "html") {
      node.innerHTML = value;
    } else if (key in node && key !== "list" && key !== "form") {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }

  append(node, children);
  return node;
}

/** Append a child, array of children, or text. Nullish entries are skipped. */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replace all children of `parent`. */
export function replace(parent, children) {
  parent.replaceChildren();
  return append(parent, children);
}

/**
 * Event delegation: one listener on a container instead of N on rows.
 * @param {Element} root
 * @param {string} type
 * @param {string} selector
 * @param {(ev: Event, target: Element) => void} handler
 */
export function delegate(root, type, selector, handler) {
  const listener = (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest(selector) : null;
    if (target && root.contains(target)) handler(ev, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

/* --- Toasts -------------------------------------------------------------- */

let toastHost = null;
function ensureToastHost() {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el("div.toast-host", { role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  return toastHost;
}

/**
 * @param {string} message
 * @param {{variant?: 'info'|'win'|'loss'|'warn', timeout?: number, title?: string}} [opts]
 */
export function toast(message, opts = {}) {
  const { variant = "info", timeout = 3600, title } = opts;
  const node = el(`div.toast.toast--${variant}`, {}, [
    el("div", {}, [
      title ? el("strong", { style: { display: "block" } }, title) : null,
      el("span", {}, message),
    ]),
  ]);

  ensureToastHost().append(node);

  const dismiss = () => {
    node.classList.add("is-leaving");
    node.addEventListener("animationend", () => node.remove(), { once: true });
    // Fallback for reduced-motion, where the animation never fires.
    setTimeout(() => node.remove(), 500);
  };

  const timer = setTimeout(dismiss, timeout);
  node.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });
  return dismiss;
}

/* --- Misc ---------------------------------------------------------------- */

/** Run `fn` once the DOM is parsed. */
export function ready(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

/** Read `?key=value` from the current URL. */
export const queryParam = (key, fallback = null) =>
  new URLSearchParams(location.search).get(key) ?? fallback;

/** Copy text, resolving to true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Animate a number from its current value to `to`, for balance counters.
 * Respects prefers-reduced-motion by snapping instantly.
 * @param {(value:number)=>void} render
 */
export function tween(from, to, duration, render) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || duration <= 0 || from === to) {
    render(to);
    return () => {};
  }

  const start = performance.now();
  let frame = 0;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    // easeOutCubic: fast start, gentle settle — reads as "counting up".
    const eased = 1 - (1 - t) ** 3;
    render(from + (to - from) * eased);
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** Promise that settles after `ms`. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
