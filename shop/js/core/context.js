/**
 * Storefront runtime context: one store, one cart, one order book, shared by
 * every page. Importing this is how a page gets state; nothing constructs its
 * own `Cart`.
 */

import { createStore } from "../../../assets/js/storage.js";
import { Cart } from "./cart.js";
import { PRODUCTS } from "../../data/products.js";
import { SUPPLIERS } from "../../data/suppliers.js";

const store = createStore("nexytt.shop");

export const cart = new Cart({ store });
export const products = PRODUCTS;
export const suppliers = SUPPLIERS;
export { store };

const ORDERS_KEY = "orders";
const MAX_ORDERS = 100;

/** @returns {object[]} newest first */
export function listOrders() {
  const saved = store.get(ORDERS_KEY);
  return Array.isArray(saved) ? saved : [];
}

export function saveOrder(order) {
  const orders = listOrders().filter((o) => o.reference !== order.reference);
  orders.unshift(order);
  store.set(ORDERS_KEY, orders.slice(0, MAX_ORDERS));
  return order;
}

export const getOrder = (reference) =>
  listOrders().find((o) => o.reference === reference) ?? null;

/* --- Recently viewed ------------------------------------------------------ */

const RECENT_KEY = "recent";

export function markViewed(productId) {
  const recent = (store.get(RECENT_KEY) ?? []).filter((id) => id !== productId);
  recent.unshift(productId);
  store.set(RECENT_KEY, recent.slice(0, 8));
}

export const recentlyViewed = (excludeId = null) =>
  (store.get(RECENT_KEY) ?? [])
    .filter((id) => id !== excludeId)
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean);

/* --- Wishlist ------------------------------------------------------------- */

const WISH_KEY = "wishlist";

export const wishlist = () => store.get(WISH_KEY) ?? [];

export function toggleWish(productId) {
  const current = wishlist();
  const next = current.includes(productId)
    ? current.filter((id) => id !== productId)
    : [...current, productId];
  store.set(WISH_KEY, next);
  return next.includes(productId);
}
