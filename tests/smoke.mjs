/**
 * Browser smoke test.
 *
 * Loads each page in headless Chromium and fails on: page errors, console
 * errors, failed network requests, missing accessible names on controls, and
 * horizontal overflow at a phone width. Catches the class of bug that unit
 * tests over pure logic structurally cannot — a bad import path, a null
 * dereference during mount, a layout that scrolls sideways on a phone.
 *
 * Usage:
 *   node tests/smoke.mjs                       # every page
 *   node tests/smoke.mjs casino/dice.html      # just these
 *   node tests/smoke.mjs --interact            # also click through key flows
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Playwright is installed globally in this environment, not as a project dep.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.SMOKE_PORT ?? 8123);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const ALL_PAGES = [
  "index.html",
  "casino/index.html",
  "casino/slots.html",
  "casino/blackjack.html",
  "casino/roulette.html",
  "casino/dice.html",
  "casino/crash.html",
  "casino/mines.html",
  "casino/fairness.html",
  "shop/index.html",
  "shop/product.html?slug=lampara-aurora-rgb",
  "shop/cart.html",
  "shop/checkout.html",
  "shop/orders.html",
  "shop/order.html",
  "shop/admin.html",
];

function startServer() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split("?")[0]);
    const filePath = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) throw new Error("directory");
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function checkPage(browser, pagePath, { interact }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const problems = [];
  page.on("pageerror", (err) => problems.push(`JS error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
  });
  page.on("requestfailed", (req) => {
    problems.push(`request failed: ${req.url().replace(`http://localhost:${PORT}/`, "")}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      problems.push(`HTTP ${res.status()}: ${res.url().replace(`http://localhost:${PORT}/`, "")}`);
    }
  });

  try {
    await page.goto(`http://localhost:${PORT}/${pagePath}`, {
      waitUntil: "networkidle",
      timeout: 20000,
    });
    // Modules mount after DOMContentLoaded; give the shell a beat to render.
    await page.waitForTimeout(450);

    const title = await page.title();
    if (!title || title.length < 3) problems.push("missing or trivial <title>");

    const h1 = await page.locator("h1").count();
    if (h1 === 0) problems.push("no <h1> on the page");

    // Interactive controls must expose an accessible name.
    const unnamed = await page.evaluate(() => {
      const bad = [];
      for (const node of document.querySelectorAll("button, a[href], input, select")) {
        if (node.closest("[aria-hidden='true']")) continue;
        const name =
          node.getAttribute("aria-label") ||
          node.getAttribute("title") ||
          node.textContent.trim() ||
          node.getAttribute("placeholder") ||
          (node.labels?.length ? "labelled" : "");
        if (!name) bad.push(node.tagName.toLowerCase() + (node.className ? "." + String(node.className).split(" ")[0] : ""));
      }
      return bad.slice(0, 5);
    });
    if (unnamed.length) problems.push(`controls without accessible name: ${unnamed.join(", ")}`);

    if (interact) {
      // Click the primary action once and re-check for runtime errors.
      const primary = page.locator(".btn--primary:visible").first();
      if (await primary.count()) {
        await primary.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(900);
      }
    }

    // No layout may scroll sideways at any width people actually use.
    //
    // Checking one width is not enough, and this test learned that the hard
    // way: it passed at 390px for weeks while the casino top bar overflowed by
    // 388px at 768px. At 390px a `.hide-sm` rule hides the nav, so the very
    // element that overflowed was not on the page. Small-phone, large-phone,
    // tablet and small-laptop each expose a different breakpoint.
    for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      );
      // A couple of pixels is sub-pixel rounding, not a broken layout.
      if (overflow > 2) {
        const culprit = await page.evaluate(() => {
          const limit = document.documentElement.clientWidth;
          for (const node of document.querySelectorAll("body *")) {
            const box = node.getBoundingClientRect();
            if (box.right > limit + 2 && box.width > 0) {
              return `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]} (right ${Math.round(box.right)})`;
            }
          }
          return "unknown element";
        });
        problems.push(`horizontal overflow at ${width}px: ${overflow}px — ${culprit}`);
      }
    }
  } catch (err) {
    problems.push(`navigation failed: ${err.message}`);
  }

  await context.close();
  return problems;
}

const args = process.argv.slice(2);
const interact = args.includes("--interact");
const requested = args.filter((a) => !a.startsWith("--"));
const pages = requested.length ? requested : ALL_PAGES;

const server = await startServer();
const browser = await chromium.launch();

let failed = 0;
for (const pagePath of pages) {
  const problems = await checkPage(browser, pagePath, { interact });
  if (problems.length) {
    failed++;
    console.log(`\x1b[31m✗\x1b[0m ${pagePath}`);
    for (const p of problems) console.log(`    ${p}`);
  } else {
    console.log(`\x1b[32m✓\x1b[0m ${pagePath}`);
  }
}

await browser.close();
server.close();

console.log(`\n${pages.length - failed}/${pages.length} páginas sin incidencias`);
process.exit(failed ? 1 : 0);
