/**
 * Catalogue querying: search, filter, sort, paginate.
 *
 * Pure functions over an array of products. At this catalogue size a linear
 * scan is faster than any index would be; the shape below is what a real
 * backend query string maps onto, so swapping in a server-side search later is
 * a change of one function, not of the UI.
 */

/**
 * Normalise for accent-insensitive search: "lámpara" must match "lampara".
 * NFD splits accented characters into base + combining mark, which we then drop.
 */
export const normalise = (str) =>
  String(str ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Pre-compute a haystack per product so repeated keystrokes don't re-normalise. */
const haystacks = new WeakMap();
function haystackFor(product) {
  let value = haystacks.get(product);
  if (!value) {
    value = normalise(
      [product.title, product.category, product.brand, product.summary, ...(product.tags ?? [])].join(" ")
    );
    haystacks.set(product, value);
  }
  return value;
}

export const SORTS = {
  relevance: { id: "relevance", label: "Relevancia" },
  price_asc: { id: "price_asc", label: "Precio: menor a mayor" },
  price_desc: { id: "price_desc", label: "Precio: mayor a menor" },
  rating: { id: "rating", label: "Mejor valorados" },
  newest: { id: "newest", label: "Novedades" },
  discount: { id: "discount", label: "Mayor descuento" },
};

/**
 * @param {object[]} products
 * @param {{q?:string, categories?:string[], tags?:string[], minPrice?:number, maxPrice?:number, minRating?:number, inStockOnly?:boolean, sort?:string, page?:number, perPage?:number}} query
 */
export function queryCatalog(products, query = {}) {
  const {
    q = "",
    categories = [],
    tags = [],
    minPrice = null,
    maxPrice = null,
    minRating = 0,
    inStockOnly = false,
    sort = "relevance",
    page = 1,
    perPage = 12,
  } = query;

  const terms = normalise(q).split(/\s+/).filter(Boolean);

  let results = products.filter((p) => {
    if (categories.length && !categories.includes(p.category)) return false;
    if (tags.length && !tags.some((t) => p.tags?.includes(t))) return false;
    if (minPrice != null && p.price < minPrice) return false;
    if (maxPrice != null && p.price > maxPrice) return false;
    if (p.rating < minRating) return false;
    if (inStockOnly && p.stock <= 0) return false;

    // Every term must appear somewhere — AND semantics, which is what shoppers expect.
    if (terms.length) {
      const hay = haystackFor(p);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  results = sortProducts(results, sort, terms);

  const total = results.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * perPage;

  return {
    items: results.slice(start, start + perPage),
    total,
    page: current,
    pages,
    perPage,
    hasMore: current < pages,
  };
}

function sortProducts(items, sort, terms = []) {
  const out = items.slice();
  switch (sort) {
    case "price_asc":
      return out.sort((a, b) => a.price - b.price);
    case "price_desc":
      return out.sort((a, b) => b.price - a.price);
    case "rating":
      return out.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    case "newest":
      return out.sort((a, b) => b.addedAt - a.addedAt);
    case "discount":
      return out.sort((a, b) => discountOf(b) - discountOf(a));
    default:
      // Relevance: a title hit outranks a tag hit; then bestsellers, then rating.
      return out.sort((a, b) => {
        if (terms.length) {
          const score = (p) => {
            const title = normalise(p.title);
            return terms.reduce((s, t) => s + (title.includes(t) ? 2 : 0), 0);
          };
          const diff = score(b) - score(a);
          if (diff) return diff;
        }
        return (b.bestseller ? 1 : 0) - (a.bestseller ? 1 : 0) || b.rating - a.rating;
      });
  }
}

const discountOf = (p) => (p.compareAt > p.price ? (p.compareAt - p.price) / p.compareAt : 0);

/** Distinct categories with counts, for the filter sidebar. */
export function facetCategories(products) {
  const counts = new Map();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}

/** Distinct tags with counts, most common first. */
export function facetTags(products, limit = 14) {
  const counts = new Map();
  for (const p of products) {
    for (const tag of p.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function priceBounds(products) {
  if (!products.length) return { min: 0, max: 0 };
  let min = Infinity;
  let max = 0;
  for (const p of products) {
    if (p.price < min) min = p.price;
    if (p.price > max) max = p.price;
  }
  return { min, max };
}

export const findBySlug = (products, slug) => products.find((p) => p.slug === slug) ?? null;
export const findById = (products, id) => products.find((p) => p.id === id) ?? null;

/**
 * "You may also like": same category first, then shared tags, never the product itself.
 */
export function relatedProducts(products, product, limit = 4) {
  if (!product) return [];
  const scored = products
    .filter((p) => p.id !== product.id)
    .map((p) => {
      let score = 0;
      if (p.category === product.category) score += 3;
      score += (p.tags ?? []).filter((t) => product.tags?.includes(t)).length;
      if (p.bestseller) score += 0.5;
      return { p, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.p.rating - a.p.rating);

  return scored.slice(0, limit).map((entry) => entry.p);
}
