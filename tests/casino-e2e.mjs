/**
 * Casino end-to-end.
 *
 * Loading a game page proves nothing about whether it plays. This drives each
 * game through a real round in a browser and checks the two things that must
 * hold everywhere: the balance moves by the amount the ledger says, and a
 * responsible-play limit blocks a bet instead of breaking the page.
 *
 *   node tests/casino-e2e.mjs
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.CASINO_E2E_PORT ?? 8155);
const BASE = `http://localhost:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
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

let failures = 0;
let checks = 0;
function check(label, condition, detail = "") {
  checks++;
  if (!condition) failures++;
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${condition || !detail ? "" : `\n      ${detail}`}`);
}

const OPENING_BALANCE = 500_000;

/**
 * Read the wallet straight out of the page's own storage — the source of truth.
 * Nothing is written until the first ledger entry, so an absent record means an
 * untouched wallet, not a failure.
 */
const readWallet = (page) =>
  page.evaluate((opening) => {
    const raw = localStorage.getItem("nexytt.casino:wallet");
    return raw ? JSON.parse(raw) : { balance: opening, ledger: [] };
  }, OPENING_BALANCE);

const server = await startServer();
const browser = await chromium.launch();

const GAMES = [
  { id: "slots", page: "slots.html", action: /girar|jugar|spin/i },
  { id: "blackjack", page: "blackjack.html", action: /repartir|jugar|deal/i },
  { id: "roulette", page: "roulette.html", action: /girar|lanzar|jugar/i },
  { id: "dice", page: "dice.html", action: /tirar|lanzar|apostar/i },
  { id: "crash", page: "crash.html", action: /apostar|jugar|empezar/i },
  { id: "mines", page: "mines.html", action: /empezar|jugar|apostar/i },
];

console.log("\nJugando una ronda real en cada juego\n");

for (const game of GAMES) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  try {
    await page.goto(`${BASE}/casino/${game.page}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    const before = await readWallet(page);
    check(`${game.id}: la cartera arranca con saldo`, Number.isInteger(before.balance) && before.balance > 0,
      `saldo ${before.balance}`);

    // Press the game's primary action.
    const action = page.locator("button.btn--primary", { hasText: game.action }).first();
    const found = await action.count() > 0;
    check(`${game.id}: tiene un botón de acción`, found);

    if (game.id === "roulette") {
      // The wheel must refuse to spin on an empty layout.
      check("roulette: no gira sin apuestas en el tapete", await action.isDisabled());
      const pocket = page.locator('[aria-label^="Pleno 17"]').first();
      if (await pocket.count()) {
        await pocket.click();
        await page.waitForTimeout(400);
      }
      check("roulette: colocar una ficha habilita el giro", await action.isEnabled());
    }

    if (found && await action.isEnabled()) {
      await action.click();
      // Reels, wheels and curves animate; give the round time to resolve.
      await page.waitForTimeout(3500);

      // Multi-stage games need a second interaction to settle the round.
      if (game.id === "mines") {
        const tiles = page.locator(".stage button:not([disabled])");
        if (await tiles.count() > 0) {
          await tiles.first().click();
          await page.waitForTimeout(800);
        }
      }
      if (game.id === "blackjack") {
        const stand = page.locator("button", { hasText: /plantar|stand/i }).first();
        if (await stand.count() && await stand.isEnabled()) {
          await stand.click();
          await page.waitForTimeout(2500);
        }
      }
      if (game.id === "crash") {
        await page.waitForTimeout(9000); // let the round run to its crash
      }

      const after = await readWallet(page);
      const staked = after.ledger.filter((e) => e.kind === "bet").length;
      check(`${game.id}: la apuesta llega al libro mayor`, staked >= 1,
        `entradas de apuesta: ${staked}`);
      check(`${game.id}: el saldo cambió`, after.balance !== before.balance,
        `${before.balance} → ${after.balance}`);

      // The ledger must reconcile with the balance, always.
      const reconstructed = after.ledger.reduce((sum, e) => sum + e.amount, OPENING_BALANCE);
      check(`${game.id}: el libro mayor cuadra con el saldo`, reconstructed === after.balance,
        `libro ${reconstructed} vs saldo ${after.balance}`);
    }

    check(`${game.id}: sin errores de consola`, errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (err) {
    check(`${game.id}: la ronda se completa`, false, err.message);
  }

  await context.close();
}

/* --- Responsible play ------------------------------------------------------ */

console.log("\nJuego responsable\n");
{
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`${BASE}/casino/dice.html`, { waitUntil: "networkidle" });

  // Set a stake ceiling below the default bet, straight into the same storage
  // the app reads, then reload so the limit is live.
  await page.evaluate(() => {
    localStorage.setItem("nexytt.casino:responsible", JSON.stringify({
      limits: { lossLimit: null, sessionMinutes: null, reminderMinutes: 30, stakeLimit: 100 },
      sessionStart: Date.now(),
      excludedUntil: null,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const before = await readWallet(page);
  // Bet well above the 1,00 credit ceiling.
  const betButton = page.locator("button.btn--primary", { hasText: /tirar|lanzar|apostar/i }).first();
  const stakeField = page.locator('input[type="number"]').first();
  await stakeField.fill("500");
  await betButton.click();
  await page.waitForTimeout(1200);

  const after = await readWallet(page);
  check("una apuesta por encima del límite no se cobra", after.balance === before.balance,
    `${before.balance} → ${after.balance}`);
  check("el límite se comunica al jugador", await page.locator(".toast").count() > 0);
  check("el límite no rompe la página", errors.length === 0, errors.slice(0, 3).join(" | "));

  // Self-exclusion must block outright.
  await page.evaluate(() => {
    localStorage.setItem("nexytt.casino:responsible", JSON.stringify({
      limits: { lossLimit: null, sessionMinutes: null, reminderMinutes: 30, stakeLimit: null },
      sessionStart: Date.now(),
      excludedUntil: Date.now() + 3_600_000,
    }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const beforeExcluded = await readWallet(page);
  await page.locator("button.btn--primary", { hasText: /tirar|lanzar|apostar/i }).first().click();
  await page.waitForTimeout(1000);
  const afterExcluded = await readWallet(page);
  check("la autoexclusión bloquea el juego", afterExcluded.balance === beforeExcluded.balance,
    `${beforeExcluded.balance} → ${afterExcluded.balance}`);

  await context.close();
}

/* --- Fairness verifier ----------------------------------------------------- */

console.log("\nJusticia verificable\n");
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/casino/fairness.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const body = await page.locator("body").innerText();
  check("el verificador explica el esquema", /hmac|sha-?256/i.test(body));
  check("muestra el compromiso activo", /[0-9a-f]{16}/i.test(body));

  await context.close();
}

await browser.close();
server.close();

console.log(`\n${checks - failures}/${checks} comprobaciones del casino`);
process.exit(failures ? 1 : 0);
