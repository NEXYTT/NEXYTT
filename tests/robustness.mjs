/**
 * Robustness against hostile and corrupted input.
 *
 * The other suites drive the happy path. This one attacks: HTML injected
 * through every field a user controls, storage records with the wrong shape,
 * and URL parameters that name nothing. The bar is not that these inputs work —
 * it is that the page stays usable and says something honest instead of going
 * blank or rendering a confidently wrong value.
 *
 *   node tests/robustness.mjs
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.ROBUST_PORT ?? 8166);
const BASE = `http://localhost:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function startServer() {
  const server = createServer(async (req, res) => {
    const filePath = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    try {
      if ((await stat(filePath)).isDirectory()) throw new Error("dir");
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(await readFile(filePath));
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

let failures = 0;
let checks = 0;
const check = (label, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${ok || !detail ? "" : `\n      ${detail}`}`);
};

/** A page is "usable" when it rendered real content, not an empty shell. */
const MIN_USABLE_TEXT = 120;

const server = await startServer();
const browser = await chromium.launch();

/**
 * Load `url`, optionally seeding storage first, and report what happened.
 * The injected payload sets `window.__xss` if it ever executes.
 */
async function visit(url, seed) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // The order loader warns when it drops a malformed record; that is the
    // containment working, not a failure.
    if (m.type() === "error") errors.push(m.text());
  });

  if (seed) {
    // Storage is origin-scoped, so it has to be seeded from a page on the origin.
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(seed);
  }

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const text = (await page.locator("body").innerText()).trim();
  const executed = await page.evaluate(() => window.__xss === true);
  await context.close();
  return { text, errors, executed };
}

const PAYLOAD = '<img src=x onerror="window.__xss=true">';

console.log("\n1. HTML inyectado en cada entrada que controla el usuario\n");

for (const [label, url, seed] of [
  [
    "semilla de cliente",
    `${BASE}/casino/fairness.html`,
    () =>
      localStorage.setItem(
        "nexytt.casino:fairness",
        JSON.stringify({
          serverSeed: "abc",
          clientSeed: '<img src=x onerror="window.__xss=true">',
          nonce: 0,
          nextServerSeed: "def",
        })
      ),
  ],
  ["referencia de pedido", `${BASE}/shop/order.html?ref=${encodeURIComponent(PAYLOAD)}`, null],
  ["slug de producto", `${BASE}/shop/product.html?slug=${encodeURIComponent(PAYLOAD)}`, null],
  ["término de búsqueda", `${BASE}/shop/index.html?q=${encodeURIComponent(PAYLOAD)}`, null],
  ["categoría", `${BASE}/shop/index.html?cat=${encodeURIComponent(PAYLOAD)}`, null],
]) {
  const { text, executed, errors } = await visit(url, seed);
  check(`${label}: el HTML inyectado no se ejecuta`, !executed, "window.__xss quedó en true");
  check(`${label}: la página sigue usable`, text.length >= MIN_USABLE_TEXT, `${text.length} caracteres · ${errors.slice(0, 2).join(" | ")}`);
}

console.log("\n2. Estado persistido con la forma equivocada\n");

/**
 * Each case is JSON that parses cleanly but whose shape no screen expects —
 * the record an older schema or a half-finished write would leave behind.
 */
const CORRUPT = [
  ["carrito con líneas sin precio", "shop/cart.html", () =>
    localStorage.setItem("nexytt.shop:cart", JSON.stringify({ lines: [{ key: "a::b", productId: "x", qty: 2 }], promoCode: null, country: "ES" }))],
  ["carrito cuyas líneas no son un array", "shop/cart.html", () =>
    localStorage.setItem("nexytt.shop:cart", JSON.stringify({ lines: { nope: true }, country: "ES" }))],
  ["carrito con JSON corrupto", "shop/cart.html", () =>
    localStorage.setItem("nexytt.shop:cart", "{{{ esto no es json")],
  ["saldo del casino como texto", "casino/dice.html", () =>
    localStorage.setItem("nexytt.casino:wallet", JSON.stringify({ balance: "muchísimo", ledger: [] }))],
  ["libro mayor que no es un array", "casino/dice.html", () =>
    localStorage.setItem("nexytt.casino:wallet", JSON.stringify({ balance: 1000, ledger: { a: 1 } }))],
  ["pedido sin totales ni fecha", "shop/orders.html", () =>
    localStorage.setItem("nexytt.shop:orders", JSON.stringify([{ reference: "NX-A-BBBB", lines: [], status: "paid" }]))],
  ["pedido con fecha no válida", "shop/orders.html", () =>
    localStorage.setItem("nexytt.shop:orders", JSON.stringify([{ reference: "NX-A-CCCC", lines: [], status: "paid", createdAt: "ayer", totals: { total: 100 } }]))],
  ["límites de juego con valores absurdos", "casino/dice.html", () =>
    localStorage.setItem("nexytt.casino:responsible", JSON.stringify({ limits: { lossLimit: "mucho", sessionMinutes: -5, stakeLimit: NaN }, sessionStart: "nunca", excludedUntil: "sí" }))],
];

for (const [label, path, seed] of CORRUPT) {
  const { text, errors } = await visit(`${BASE}/${path}`, seed);
  check(`${label}: la página sigue usable`, text.length >= MIN_USABLE_TEXT, `${text.length} caracteres`);
  check(`${label}: sin excepciones`, errors.length === 0, errors.slice(0, 2).join(" | "));
  // A missing date must never be rendered as the epoch: a confidently wrong
  // date is worse than an honest dash.
  check(`${label}: no inventa una fecha de 1970`, !/1970/.test(text), text.match(/.{0,50}1970.{0,20}/)?.[0] ?? "");
}

console.log("\n3. Parámetros de URL que no nombran nada\n");

for (const [label, url] of [
  ["pedido inexistente", `${BASE}/shop/order.html?ref=NX-ZZZ-ZZZZ`],
  ["producto inexistente", `${BASE}/shop/product.html?slug=no-existe-este-producto`],
  ["categoría inexistente", `${BASE}/shop/index.html?cat=inventada`],
  ["página fuera de rango", `${BASE}/shop/index.html?page=99999`],
  ["referencia vacía", `${BASE}/shop/order.html?ref=`],
]) {
  const { text, errors } = await visit(url, null);
  check(`${label}: degrada con contenido útil`, text.length >= MIN_USABLE_TEXT, `${text.length} caracteres`);
  check(`${label}: sin excepciones`, errors.length === 0, errors.slice(0, 2).join(" | "));
}

await browser.close();
server.close();

console.log(`\n${checks - failures}/${checks} comprobaciones de robustez`);
process.exit(failures ? 1 : 0);
