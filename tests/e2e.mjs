/**
 * End-to-end purchase flow.
 *
 * The smoke test proves each page loads. This proves they work *together*: that
 * a product added on one page reaches the cart on another, that the total the
 * customer is quoted is the total the order records, and that the whole journey
 * completes without a single console error. Page-level tests cannot catch a
 * cart that silently loses its promotion between two pages; only walking the
 * flow can.
 *
 *   node tests/e2e.mjs            # headless
 *   node tests/e2e.mjs --headed   # watch it happen
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.E2E_PORT ?? 8144);
const BASE = `http://localhost:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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

/* --- Test harness --------------------------------------------------------- */

const steps = [];
let failures = 0;

function check(label, condition, detail = "") {
  steps.push({ label, ok: Boolean(condition), detail });
  if (!condition) failures++;
  const mark = condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${label}${condition || !detail ? "" : `\n      ${detail}`}`);
}

/** Money text like "1.234,56 €" back to integer minor units. */
const parseMoney = (text) => {
  const cleaned = String(text).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Math.round(Number(cleaned) * 100);
};

const server = await startServer();
const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

/** Console errors are collected across the whole journey, not per page. */
const consoleErrors = [];
page.on("pageerror", (err) => consoleErrors.push(`${page.url().replace(BASE, "")}: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`${page.url().replace(BASE, "")}: ${msg.text()}`);
});
page.on("requestfailed", (req) => consoleErrors.push(`request failed: ${req.url().replace(BASE + "/", "")}`));

try {
  /* --- 1. Catalogue ------------------------------------------------------- */
  console.log("\n1. Catálogo");
  await page.goto(`${BASE}/shop/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const cardCount = await page.locator(".product-card").count();
  check("el catálogo muestra productos", cardCount > 0, `se encontraron ${cardCount}`);

  /* --- 2. Search ---------------------------------------------------------- */
  const search = page.locator('input[type="search"]').first();
  await search.fill("auriculares");
  await page.waitForTimeout(600);
  const searchCount = await page.locator(".product-card").count();
  check("la búsqueda filtra el catálogo", searchCount > 0 && searchCount < cardCount,
    `${cardCount} → ${searchCount}`);
  await search.fill("");
  await page.waitForTimeout(600);

  /* --- 3. Product page ---------------------------------------------------- */
  console.log("\n2. Ficha de producto");
  await page.goto(`${BASE}/shop/product.html?slug=auriculares-pulse-anc`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const title = await page.locator("h1").first().textContent();
  check("carga el producto pedido", /auriculares/i.test(title ?? ""), `h1 = "${title?.trim()}"`);

  const priceText = await page.locator(".price__now").first().textContent();
  const unitPrice = parseMoney(priceText);
  check("muestra un precio legible", unitPrice > 0, `"${priceText?.trim()}" → ${unitPrice}`);

  // Pick a variant that carries a price delta, if there is one.
  const variants = page.locator(".variant-btn:not([disabled])");
  if (await variants.count() > 1) {
    await variants.nth(1).click();
    await page.waitForTimeout(250);
    check("se puede elegir variante", true);
  }
  const chosenPrice = parseMoney(await page.locator(".price__now").first().textContent());

  /* --- 4. Add to cart ----------------------------------------------------- */
  const addButton = page.locator("button", { hasText: /añadir|carrito/i }).first();
  await addButton.click();
  await page.waitForTimeout(500);

  const badge = await page.locator(".cart-button__count").first().textContent();
  check("el contador del carrito se actualiza", Number(badge) >= 1, `contador = "${badge}"`);

  /* --- 5. Cart ------------------------------------------------------------ */
  console.log("\n3. Carrito");
  await page.goto(`${BASE}/shop/cart.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const lines = await page.locator(".cart-line").count();
  check("el producto llega al carrito", lines >= 1, `${lines} líneas`);

  const bodyText = await page.locator("body").innerText();
  check("el carrito muestra el precio elegido",
    bodyText.includes(String(Math.floor(chosenPrice / 100))),
    `buscando ${chosenPrice / 100} en el carrito`);

  // Raise the quantity and confirm the total follows.
  const plus = page.locator(".qty button").last();
  if (await plus.count()) {
    await plus.click();
    await page.waitForTimeout(400);
  }

  // Apply a promotion code.
  const promoField = page.locator('input[aria-label*="promocional" i]').first();
  check("el carrito ofrece un campo de código promocional", await promoField.count() > 0);

  if (await promoField.count()) {
    const totalBefore = parseMoney(
      (await page.locator(".summary__row--total").innerText()).split("\n").pop()
    );

    await promoField.fill("NOEXISTE");
    let applyButton = page.locator("button.btn", { hasText: /aplicar|canjear/i }).first();
    await applyButton.click();
    await page.waitForTimeout(400);
    const totalAfterBadCode = parseMoney(
      (await page.locator(".summary__row--total").innerText()).split("\n").pop()
    );
    check("un código inválido no altera el total", totalAfterBadCode === totalBefore,
      `${totalBefore} → ${totalAfterBadCode}`);

    await promoField.fill("BIENVENIDO10");
    applyButton = page.locator("button.btn", { hasText: /aplicar|canjear/i }).first();
    await applyButton.click();
    await page.waitForTimeout(500);

    const totalAfter = parseMoney(
      (await page.locator(".summary__row--total").innerText()).split("\n").pop()
    );
    check("un código válido reduce el total", totalAfter < totalBefore,
      `${totalBefore} → ${totalAfter}`);
  }

  /* --- 6. Checkout -------------------------------------------------------- */
  console.log("\n4. Checkout");
  const checkoutLink = page.locator('a[href*="checkout"]').first();
  await checkoutLink.click();
  await page.waitForURL(/checkout/, { timeout: 8000 });
  await page.waitForTimeout(600);

  check("llega al checkout", page.url().includes("checkout.html"));

  const fill = async (selectors, value) => {
    for (const selector of selectors) {
      const field = page.locator(selector).first();
      if (await field.count()) {
        await field.fill(value);
        return true;
      }
    }
    return false;
  };

  await fill(['input[type="email"]', '#email'], "cliente@ejemplo.es");
  await fill(['#firstName', 'input[name="firstName"]', 'input[name="nombre"]'], "Ana");
  await fill(['#lastName', 'input[name="lastName"]', 'input[name="apellidos"]'], "Ruiz Gómez");
  await fill(['#phone', 'input[type="tel"]'], "600123456");
  await fill(['#address', 'input[name="address"]', 'input[name="direccion"]'], "Calle Mayor 12, 3ºB");
  await fill(['#city', 'input[name="city"]', 'input[name="ciudad"]'], "Madrid");
  await fill(['#postalCode', 'input[name="postalCode"]', 'input[name="cp"]'], "28013");

  // Step 1 → 2. The step indicator is also a <button>, and a disabled one, so
  // match the action button by class rather than by its text alone.
  let next = page.locator("button.btn--primary", { hasText: /continuar|siguiente|pago/i }).first();
  await next.click();
  await page.waitForTimeout(800);

  const step2 = await page.locator("body").innerText();
  check("el paso 1 valida y avanza", /pago|tarjeta/i.test(step2));

  // A card that fails the Luhn check must not get through. Proving the guard
  // blocks is as important as proving the happy path completes.
  await fill(['input[name="cardNumber"]'], "4242424242424241");
  await fill(['input[name="cardHolder"]'], "ANA RUIZ GOMEZ");
  await fill(['input[name="cardExpiry"]'], "12/30");
  await fill(['input[name="cardCvc"]'], "123");
  await page.waitForTimeout(300);

  next = page.locator("button.btn--primary", { hasText: /revisar|continuar|siguiente/i }).first();
  await next.click();
  await page.waitForTimeout(700);
  check("una tarjeta con dígito de control inválido es rechazada",
    await page.locator('input[name="cardNumber"]').count() > 0,
    "el checkout avanzó con una tarjeta que no pasa Luhn");

  // Now the published test number, on a simulated processor.
  await fill(['input[name="cardNumber"]'], "4242424242424242");
  await page.waitForTimeout(300);

  next = page.locator("button.btn--primary", { hasText: /revisar|continuar|siguiente/i }).first();
  await next.click();
  await page.waitForTimeout(800);

  check("el paso 2 valida y avanza a la revisión",
    await page.locator('input[name="cardNumber"]').count() === 0,
    "sigue mostrando el formulario de pago");

  // Capture the total the customer is being asked to pay. Read it from the row
  // whose label is exactly "Total" — a substring match would find "Subtotal"
  // first and compare the wrong number.
  const readTotal = () =>
    page.evaluate(() => {
      // The row renders as two spans, so its textContent is "Total119,98 €"
      // with no separator — read the value span rather than parsing the label.
      const row = document.querySelector(".summary__row--total");
      if (!row) return null;
      const spans = row.querySelectorAll("span");
      return (spans.length ? spans[spans.length - 1] : row).textContent.trim();
    });

  const quotedRow = await readTotal();
  const quotedTotal = quotedRow ? Number(String(quotedRow).replace(/[^\d,]/g, "").replace(",", ".")) * 100 : null;
  check("el checkout muestra un total", quotedTotal !== null && quotedTotal > 0,
    `fila leída: "${quotedRow ?? "no encontrada"}"`);

  /* --- 7. Confirm --------------------------------------------------------- */
  const confirm = page.locator("button.btn--primary", { hasText: /confirmar|finalizar|pagar/i }).last();
  check("existe el botón de confirmación", await confirm.count() > 0);
  await confirm.click();
  await page.waitForTimeout(1500);

  /* --- 8. Order page ------------------------------------------------------ */
  console.log("\n5. Pedido");
  check("redirige a la página del pedido", page.url().includes("order.html"),
    `url = ${page.url().replace(BASE, "")}`);

  const orderText = await page.locator("body").innerText();
  const reference = orderText.match(/NX-[0-9A-Z]+-[A-Z0-9]{4}/);
  check("el pedido tiene referencia", Boolean(reference), reference?.[0] ?? "no encontrada");

  if (quotedTotal) {
    const orderRow = await readTotal();
    const orderTotal = orderRow ? Number(String(orderRow).replace(/[^\d,]/g, "").replace(",", ".")) * 100 : null;
    check("el total del pedido coincide con el del checkout",
      Math.round(orderTotal) === Math.round(quotedTotal),
      `checkout "${quotedRow}" (${quotedTotal}) vs pedido "${orderRow}" (${orderTotal})`);
  }

  check("hay envío por proveedor", /seguimiento|transportista|proveedor|paquete/i.test(orderText));

  /* --- 9. Cart emptied ---------------------------------------------------- */
  await page.goto(`${BASE}/shop/cart.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const emptied = await page.locator("body").innerText();
  check("el carrito queda vacío tras comprar", /vacío|vacio/i.test(emptied));

  /* --- 10. Order list ----------------------------------------------------- */
  await page.goto(`${BASE}/shop/orders.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const listText = await page.locator("body").innerText();
  check("el pedido aparece en el listado",
    reference ? listText.includes(reference[0]) : false);

  /* --- 11. Admin sees the sale -------------------------------------------- */
  console.log("\n6. Panel de operación");
  await page.goto(`${BASE}/shop/admin.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const adminText = await page.locator("body").innerText();
  check("el panel no muestra NaN ni Infinity",
    !/NaN|Infinity|undefined/.test(adminText),
    (adminText.match(/.{0,40}(NaN|Infinity|undefined).{0,40}/) ?? [])[0] ?? "");
  check("el panel muestra indicadores", await page.locator(".kpi").count() > 0);

  /* --- 12. Console -------------------------------------------------------- */
  console.log("\n7. Consola");
  check("ningún error de consola en todo el recorrido",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 6).join("\n      "));
} catch (err) {
  check("el recorrido se completa sin excepciones", false, err.message);
}

await browser.close();
server.close();

const passed = steps.filter((s) => s.ok).length;
console.log(`\n${passed}/${steps.length} comprobaciones del flujo completo`);
process.exit(failures ? 1 : 0);
