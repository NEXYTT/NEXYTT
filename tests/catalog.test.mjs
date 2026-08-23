/**
 * Catalogue querying, plus integrity checks over the shipped dataset — a broken
 * slug or an unresolvable supplier id is a 404 in production.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalise, queryCatalog, facetCategories, facetTags,
  priceBounds, findBySlug, findById, relatedProducts, SORTS,
} from "../shop/js/core/catalog.js";
import { PRODUCTS, CATEGORIES, variantPrice, variantOf } from "../shop/data/products.js";
import { SUPPLIERS, supplierById } from "../shop/data/suppliers.js";
import { unitEconomics } from "../shop/js/core/pricing.js";

test("search normalisation is accent- and case-insensitive", () => {
  assert.equal(normalise("Lámpara"), "lampara");
  assert.equal(normalise("NIÑO Café"), "nino cafe");
  assert.equal(normalise(null), "");
  assert.equal(normalise(undefined), "");
});

test("an empty query returns the first page of everything", () => {
  const result = queryCatalog(PRODUCTS, { perPage: 12 });
  assert.equal(result.total, PRODUCTS.length);
  assert.equal(result.items.length, 12);
  assert.equal(result.page, 1);
  assert.equal(result.pages, Math.ceil(PRODUCTS.length / 12));
  assert.equal(result.hasMore, true);
});

test("search matches accented titles from unaccented input", () => {
  const result = queryCatalog(PRODUCTS, { q: "lampara" });
  assert.ok(result.total >= 1);
  assert.ok(result.items.some((p) => p.title.includes("Lámpara")));
});

test("multiple terms are combined with AND", () => {
  const both = queryCatalog(PRODUCTS, { q: "auriculares cancelacion" }).total;
  const one = queryCatalog(PRODUCTS, { q: "auriculares" }).total;
  assert.ok(both <= one, "adding a term can only narrow the result set");
  assert.equal(queryCatalog(PRODUCTS, { q: "lampara zzzzz" }).total, 0);
});

test("nonsense returns nothing rather than everything", () => {
  assert.equal(queryCatalog(PRODUCTS, { q: "qwertyuiop" }).total, 0);
});

test("category and tag filters actually filter", () => {
  const hogar = queryCatalog(PRODUCTS, { categories: ["hogar"], perPage: 100 });
  assert.ok(hogar.total > 0);
  assert.ok(hogar.items.every((p) => p.category === "hogar"));

  const gifts = queryCatalog(PRODUCTS, { tags: ["regalo"], perPage: 100 });
  assert.ok(gifts.items.every((p) => p.tags.includes("regalo")));
});

test("price, rating and stock filters apply together", () => {
  const result = queryCatalog(PRODUCTS, {
    minPrice: 2000, maxPrice: 4000, minRating: 4.4, inStockOnly: true, perPage: 100,
  });
  assert.ok(result.items.every((p) => p.price >= 2000 && p.price <= 4000));
  assert.ok(result.items.every((p) => p.rating >= 4.4));
  assert.ok(result.items.every((p) => p.stock > 0));
});

test("every sort order is honoured", () => {
  const all = { perPage: 100 };
  const asc = queryCatalog(PRODUCTS, { ...all, sort: "price_asc" }).items.map((p) => p.price);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));

  const desc = queryCatalog(PRODUCTS, { ...all, sort: "price_desc" }).items.map((p) => p.price);
  assert.deepEqual(desc, [...desc].sort((a, b) => b - a));

  const rated = queryCatalog(PRODUCTS, { ...all, sort: "rating" }).items.map((p) => p.rating);
  assert.deepEqual(rated, [...rated].sort((a, b) => b - a));

  const newest = queryCatalog(PRODUCTS, { ...all, sort: "newest" }).items.map((p) => p.addedAt);
  assert.deepEqual(newest, [...newest].sort((a, b) => b - a));
});

test("every sort listed in SORTS is implemented", () => {
  for (const id of Object.keys(SORTS)) {
    const result = queryCatalog(PRODUCTS, { sort: id, perPage: 100 });
    assert.equal(result.total, PRODUCTS.length, `sort "${id}" changed the result count`);
  }
});

test("relevance puts a title match ahead of a tag-only match", () => {
  const top = queryCatalog(PRODUCTS, { q: "mochila", sort: "relevance" }).items[0];
  assert.ok(normalise(top.title).includes("mochila"));
});

test("pagination covers every product exactly once", () => {
  const seen = new Set();
  const perPage = 7;
  const pages = Math.ceil(PRODUCTS.length / perPage);
  for (let page = 1; page <= pages; page++) {
    for (const p of queryCatalog(PRODUCTS, { page, perPage }).items) {
      assert.ok(!seen.has(p.id), `${p.id} appeared on more than one page`);
      seen.add(p.id);
    }
  }
  assert.equal(seen.size, PRODUCTS.length);
});

test("out-of-range pages clamp instead of returning nothing", () => {
  assert.equal(queryCatalog(PRODUCTS, { page: 999, perPage: 12 }).page, Math.ceil(PRODUCTS.length / 12));
  assert.equal(queryCatalog(PRODUCTS, { page: -5, perPage: 12 }).page, 1);
});

test("facets count what the catalogue actually holds", () => {
  const cats = facetCategories(PRODUCTS);
  assert.equal(cats.reduce((sum, c) => sum + c.count, 0), PRODUCTS.length);
  for (const { id, count } of cats) {
    assert.equal(count, PRODUCTS.filter((p) => p.category === id).length);
  }
  assert.ok(facetTags(PRODUCTS).length > 0);
});

test("price bounds span the catalogue", () => {
  const { min, max } = priceBounds(PRODUCTS);
  assert.equal(min, Math.min(...PRODUCTS.map((p) => p.price)));
  assert.equal(max, Math.max(...PRODUCTS.map((p) => p.price)));
  assert.deepEqual(priceBounds([]), { min: 0, max: 0 });
});

test("lookups work and miss gracefully", () => {
  assert.equal(findBySlug(PRODUCTS, PRODUCTS[0].slug).id, PRODUCTS[0].id);
  assert.equal(findBySlug(PRODUCTS, "no-existe"), null);
  assert.equal(findById(PRODUCTS, PRODUCTS[3].id).slug, PRODUCTS[3].slug);
  assert.equal(findById(PRODUCTS, "nope"), null);
});

test("related products never include the product itself", () => {
  for (const product of PRODUCTS) {
    const related = relatedProducts(PRODUCTS, product, 4);
    assert.ok(related.length > 0, `${product.id} has no related products`);
    assert.ok(!related.some((r) => r.id === product.id));
    assert.ok(related.length <= 4);
  }
  assert.deepEqual(relatedProducts(PRODUCTS, null), []);
});

/* --- dataset integrity ---------------------------------------------------- */

test("product ids and slugs are unique", () => {
  assert.equal(new Set(PRODUCTS.map((p) => p.id)).size, PRODUCTS.length);
  assert.equal(new Set(PRODUCTS.map((p) => p.slug)).size, PRODUCTS.length);
});

test("slugs are URL-safe", () => {
  for (const p of PRODUCTS) {
    assert.match(p.slug, /^[a-z0-9-]+$/, `${p.slug} is not URL-safe`);
  }
});

test("every product references a real category and supplier", () => {
  const categoryIds = new Set(CATEGORIES.map((c) => c.id));
  for (const p of PRODUCTS) {
    assert.ok(categoryIds.has(p.category), `${p.id} has unknown category ${p.category}`);
    assert.ok(supplierById(p.supplierId), `${p.id} has unknown supplier ${p.supplierId}`);
  }
});

test("every supplier is actually used", () => {
  const used = new Set(PRODUCTS.map((p) => p.supplierId));
  for (const s of SUPPLIERS) assert.ok(used.has(s.id), `${s.id} sells nothing`);
});

test("every product has the fields the storefront renders", () => {
  for (const p of PRODUCTS) {
    for (const field of ["title", "brand", "summary", "description", "bullets", "specs", "art", "variants"]) {
      assert.ok(p[field], `${p.id} is missing ${field}`);
    }
    assert.ok(p.bullets.length >= 3, `${p.id} needs at least 3 bullets`);
    assert.ok(Object.keys(p.specs).length >= 3, `${p.id} needs at least 3 specs`);
    assert.ok(p.variants.length >= 1);
    assert.ok(p.rating >= 1 && p.rating <= 5);
    assert.ok(p.reviewCount > 0);
    assert.ok(p.grams > 0, `${p.id} needs a shipping weight`);
  }
});

test("prices are integers below their compare-at price", () => {
  for (const p of PRODUCTS) {
    assert.ok(Number.isInteger(p.price) && p.price > 0);
    assert.ok(Number.isInteger(p.compareAt));
    assert.ok(p.price < p.compareAt, `${p.id} shows a fake discount`);
    assert.ok(Number.isInteger(p.supplierCost) && p.supplierCost > 0);
    assert.ok(Number.isInteger(p.supplierShipping) && p.supplierShipping >= 0);
  }
});

test("variant stock adds up to the product's stock", () => {
  for (const p of PRODUCTS) {
    const summed = p.variants.reduce((sum, v) => sum + v.stock, 0);
    assert.equal(summed, p.stock, `${p.id}: variants hold ${summed} but stock says ${p.stock}`);
  }
});

test("variant ids are unique within a product and price deltas are integers", () => {
  for (const p of PRODUCTS) {
    assert.equal(new Set(p.variants.map((v) => v.id)).size, p.variants.length, `${p.id} has duplicate variant ids`);
    for (const v of p.variants) {
      assert.ok(Number.isInteger(v.priceDelta), `${p.id}/${v.id} has a non-integer delta`);
      assert.ok(p.price + v.priceDelta > 0);
    }
  }
});

test("variant helpers resolve and fall back to the first variant", () => {
  const p = PRODUCTS[0];
  assert.equal(variantPrice(p, p.variants[1].id), p.price + p.variants[1].priceDelta);
  assert.equal(variantPrice(p, "no-such-variant"), p.price, "an unknown variant falls back to the base price");
  assert.equal(variantOf(p, "no-such-variant").id, p.variants[0].id);
});

test("every product is profitable at a realistic acquisition cost", () => {
  for (const p of PRODUCTS) {
    const econ = unitEconomics({
      price: p.price, supplierCost: p.supplierCost,
      supplierShipping: p.supplierShipping, adCostPerOrder: 500,
    });
    assert.ok(econ.margin > 0, `${p.title} loses money at a 5 € acquisition cost`);
    assert.ok(econ.markup >= 1.8, `${p.title} has a markup of only ${econ.markup.toFixed(2)}×`);
  }
});
