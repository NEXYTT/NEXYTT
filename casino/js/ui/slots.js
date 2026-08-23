/**
 * Neon Reels — DOM controller.
 *
 * All the maths lives in ../games/slots.js; this file only turns a spin result
 * into pixels: it spins the reels, walks the winning lines one by one, plays the
 * free-spin feature out loud, and drives autoplay.
 *
 * Money rule: the player sets a **total** stake, the game is priced per line, so
 * the stake is snapped to a multiple of 20 minor units. The line bet is then an
 * exact integer and `lineBet × totalMultiplier` never needs rounding.
 */

import { el, $, replace, append, toast, wait } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { credits, percent } from "../../../assets/js/format.js";
import {
  mountShell, betControls, historyStrip, statsPanel, playMoneyNote,
} from "./shell.js";
import { openRound, fairness, persistFairness, LimitReached } from "../core/context.js";
import {
  REELS, SYMBOLS, SYMBOL_BY_ID, PAYLINES, PAYTABLE, LINES, ROWS,
  FREE_SPINS, FREE_SPIN_MULTIPLIER, SCATTER_TRIGGER, THEORETICAL_RTP, spin, featureChance,
} from "../games/slots.js";

/* --- Animation timing ----------------------------------------------------- */

/** Strip stops that scroll past before a reel settles. */
const PREROLL = 16;
const PREROLL_FAST = 9;
/** How long one reel takes to stop, and the gap between consecutive reels. */
const REEL_MS = 620;
const REEL_MS_FAST = 320;
const STAGGER_MS = 120;
const STAGGER_MS_FAST = 65;
/** Pause between autoplay rounds, and after the feature banner. */
const AUTO_GAP_MS = 320;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const SVG_NS = "http://www.w3.org/2000/svg";

/* --- Symbol rendering ------------------------------------------------------ */

/**
 * One symbol face. Icons come from the shared set; the card ranks and the seven
 * are drawn as characters, which is why no symbol is ever an emoji.
 */
function symbolFace(id) {
  const symbol = SYMBOL_BY_ID[id];
  const node = el(`div.sym.sym--${id}`, { title: symbol.label });
  node.append(symbol.icon ? icon(symbol.icon, { size: 32, stroke: 2 }) : el("span.sym__glyph", {}, symbol.glyph));
  return node;
}

/* --- Machine --------------------------------------------------------------- */

function buildMachine() {
  const strips = REELS.map(() => el("div.reel__strip"));
  const overlay = document.createElementNS(SVG_NS, "svg");
  overlay.setAttribute("class", "payline-overlay");
  overlay.setAttribute("preserveAspectRatio", "none");
  overlay.setAttribute("aria-hidden", "true");

  const reels = el("div.reels", { "aria-hidden": "true" }, [
    ...strips.map((strip) => el("div.reel", {}, [strip])),
    overlay,
  ]);

  // The reels are decorative for assistive tech; this line is the spoken result.
  const readout = el("div.slots-readout.slots-readout--idle", {
    role: "status",
    "aria-live": "polite",
  }, [el("span.slots-readout__detail", {}, "Ajusta tu apuesta y gira.")]);

  const winList = el("div.win-list");
  const freeBanner = el("div.free-banner", { hidden: true });

  const root = el("div.slots-machine", {}, [freeBanner, reels, readout, winList]);
  return { root, reels, strips, overlay, readout, winList, freeBanner };
}

/* --- Reel motion ----------------------------------------------------------- */

/**
 * Fill a reel with the stops it is about to show and park it `preroll` stops
 * early. Tile `j` is strip[position + j], so scrolling the strip back down to
 * zero walks the reel through real consecutive stops rather than random filler.
 * @returns {number} the pixel distance the reel has to travel
 */
function primeReel(stripEl, index, position, preroll) {
  const reel = REELS[index];
  replace(stripEl, Array.from({ length: preroll + ROWS }, (_, j) =>
    el("div.reel__tile", {}, [symbolFace(reel[(position + j) % reel.length])])
  ));

  const tileHeight = stripEl.firstElementChild?.getBoundingClientRect().height ?? 0;
  const distance = preroll * tileHeight;
  stripEl.style.transform = `translate3d(0, ${-distance}px, 0)`;
  return distance;
}

/** Ease a single reel home. Quartic ease-out reads as a heavy wheel slowing. */
function runReel(stripEl, distance, duration) {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 4;
      stripEl.style.transform = `translate3d(0, ${-distance * (1 - eased)}px, 0)`;
      if (t < 1) requestAnimationFrame(frame);
      else {
        stripEl.style.transform = "translate3d(0, 0, 0)";
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Spin all five reels, each stopping `STAGGER_MS` after the previous one.
 * With reduced motion the grid simply appears — no transform, no waiting.
 */
async function spinReels(machine, positions, { fast = false } = {}) {
  if (reducedMotion()) {
    positions.forEach((position, i) => primeReel(machine.strips[i], i, position, 0));
    return;
  }

  const preroll = fast ? PREROLL_FAST : PREROLL;
  const duration = fast ? REEL_MS_FAST : REEL_MS;
  const stagger = fast ? STAGGER_MS_FAST : STAGGER_MS;

  const distances = positions.map((position, i) =>
    primeReel(machine.strips[i], i, position, preroll)
  );

  await Promise.all(distances.map(async (distance, i) => {
    if (i) await wait(i * stagger);
    // A zero-height measurement means the page is not laid out (hidden tab):
    // snap instead of animating nothing.
    if (distance > 0) await runReel(machine.strips[i], distance, duration);
    else machine.strips[i].style.transform = "translate3d(0, 0, 0)";
  }));
}

/* --- Win presentation ------------------------------------------------------ */

/** The tile currently visible at (reel, row) — the strip is parked at zero. */
const visibleTile = (machine, reel, row) => machine.strips[reel].children[row];

function clearHighlight(machine) {
  machine.reels.classList.remove("is-showing");
  for (const tile of machine.reels.querySelectorAll(".reel__tile.is-win")) {
    tile.classList.remove("is-win");
  }
  machine.overlay.replaceChildren();
}

/** Light up one win's cells and trace its payline over the cabinet. */
function highlight(machine, win) {
  clearHighlight(machine);
  machine.reels.classList.add("is-showing");
  for (const [reel, row] of win.cells) {
    visibleTile(machine, reel, row)?.classList.add("is-win");
  }

  // Scatters belong to no line, so they get the glow but no polyline.
  if (win.line == null) return;

  const box = machine.reels.getBoundingClientRect();
  if (!box.width || !box.height) return;
  machine.overlay.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);

  // Full-width trace: the line is drawn across all five reels, with the winning
  // stretch highlighted by the glowing cells underneath it.
  const points = PAYLINES[win.line].map((row, reel) => {
    const rect = visibleTile(machine, reel, row).getBoundingClientRect();
    return `${(rect.left + rect.width / 2 - box.left).toFixed(1)},${(rect.top + rect.height / 2 - box.top).toFixed(1)}`;
  });

  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("points", points.join(" "));
  machine.overlay.replaceChildren(polyline);
}

const winLabel = (win) =>
  win.line == null
    ? `${win.count} estrellas`
    : `Línea ${win.line + 1} · ${win.count}× ${SYMBOL_BY_ID[win.symbol].label}`;

function setReadout(machine, { tone = "idle", amount = null, detail = "" }) {
  machine.readout.className = `slots-readout slots-readout--${tone}`;
  replace(machine.readout, [
    amount == null ? null : el("span.slots-readout__amount", {}, `+${credits(amount)}`),
    detail ? el("span.slots-readout__detail", {}, detail) : null,
  ]);
}

/**
 * Walk the winning lines one at a time, announcing the amount each one pays.
 * The dwell time shrinks as the number of lines grows so a ten-line hit still
 * finishes in a couple of seconds.
 */
async function presentWins(machine, result, lineBet) {
  replace(machine.winList, result.wins.map((win) =>
    el("span.win-list__item", {}, `${winLabel(win)} · ${credits(win.amount * lineBet * result.multiplier)}`)
  ));

  if (!result.wins.length) {
    setReadout(machine, { detail: "Sin premio. Otra vuelta." });
    return;
  }

  const total = result.totalMultiplier * lineBet;
  const feature = result.freeSpinsAwarded > 0;
  setReadout(machine, {
    tone: feature ? "feature" : "win",
    amount: total,
    detail: feature
      ? `${result.scatterCount} estrellas · ${result.freeSpinsAwarded} tiradas gratis con ×${FREE_SPIN_MULTIPLIER}`
      : `${result.wins.length} ${result.wins.length === 1 ? "combinación" : "combinaciones"}${result.multiplier > 1 ? ` · ×${result.multiplier}` : ""}`,
  });

  // Announce the lines one at a time. Skipped under reduced motion, where the
  // whole win is simply shown at once by the block below.
  if (!reducedMotion()) {
    const hold = Math.min(950, Math.max(360, Math.round(2600 / result.wins.length)));
    const chips = [...machine.winList.children];
    for (const [i, win] of result.wins.entries()) {
      highlight(machine, win);
      chips.forEach((chip, j) => chip.classList.toggle("is-active", i === j));
      await wait(hold);
    }
    chips.forEach((chip) => chip.classList.remove("is-active"));
  }

  // Leave the whole win lit afterwards, but drop the dimming so the rest of the
  // grid is readable again while the player decides on the next spin.
  clearHighlight(machine);
  for (const win of result.wins) {
    for (const [reel, row] of win.cells) visibleTile(machine, reel, row)?.classList.add("is-win");
  }
}

/* --- Paytable -------------------------------------------------------------- */

function paytablePanel() {
  const lineSymbols = SYMBOLS.filter((s) => PAYTABLE[s.id] && s.id !== "scatter");

  /** One paytable line: face, name, the pays from five down to two, and a note. */
  const payRow = (symbol, pays, note) =>
    el("div.paytable__row", {}, [
      el("div.paytable__icon", {}, [symbolFace(symbol.id)]),
      el("div", {}, [
        el("div.paytable__name", {}, symbol.label),
        el("div.paytable__pays", {}, [
          ...Object.entries(pays ?? {})
            // Highest count first: that is the number players look for.
            .sort((a, b) => b[0] - a[0])
            .map(([count, value]) => el("span", {}, [`${count}× `, el("b", {}, String(value))])),
          note ? el("span.paytable__note.subtle", {}, note) : null,
        ]),
      ]),
    ]);

  return el("details.paytable", {}, [
    el("summary", {}, ["Tabla de pagos", icon("chevronDown", { size: 18 })]),
    el("div.paytable__body.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
      el("p.text-xs.muted", {}, [
        "Los pagos de línea multiplican la ", el("b", {}, "apuesta por línea"),
        ` (1/${LINES} de la apuesta total) y se cobran de izquierda a derecha desde el rodillo 1. `,
        "Cada línea paga una sola combinación: la más larga.",
      ]),
      ...lineSymbols.map((symbol) => payRow(symbol, PAYTABLE[symbol.id])),
      el("hr.divider"),
      payRow(SYMBOL_BY_ID.scatter, PAYTABLE.scatter,
        "Multiplican la apuesta total y pagan caigan donde caigan, sin depender de las líneas."),
      payRow(SYMBOL_BY_ID.wild, null,
        "Sustituye a cualquier símbolo salvo la Estrella. No forma combinación propia: una línea entera de comodines paga como cinco trofeos."),
      el("p.text-xs.muted", {}, [
        `${SCATTER_TRIGGER} o más estrellas conceden ${FREE_SPINS} tiradas gratis con todos los premios ×${FREE_SPIN_MULTIPLIER}. `,
        `Se activan en 1 de cada ${Math.round(1 / featureChance())} tiradas y no se pueden reactivar durante la ronda gratuita. `,
        `RTP teórico ${percent(THEORETICAL_RTP, { decimals: 1 })} · volatilidad media.`,
      ]),
    ]),
  ]);
}

/* --- Page ------------------------------------------------------------------ */

mountShell({ active: "slots" });

const machine = buildMachine();
const stage = el("section.stage", {}, [machine.root]);
const history = historyStrip();
const stats = statsPanel();

/** Round the total stake to a whole number of line bets. */
const snapStake = (total) => Math.max(LINES, Math.round(total / LINES) * LINES);

const lineBetHint = el("span.field__hint");
const updateHint = () => {
  lineBetHint.textContent = `${credits(snapStake(bet.stake) / LINES)} por línea × ${LINES} líneas = ${credits(snapStake(bet.stake))}`;
};

const bet = betControls({
  initial: 2000,
  actionLabel: "Girar",
  extra: [lineBetHint],
  onAction: () => { void playRound(); },
});
bet.input.addEventListener("input", updateHint);
updateHint();

/* --- Autoplay -------------------------------------------------------------- */

let busy = false;
let autoLeft = 0;
let autoStop = false;

const autoStatus = el("div.auto-status", { role: "status", "aria-live": "polite" });
const autoThreshold = el("input.input", {
  type: "number",
  min: "0",
  step: "0.01",
  placeholder: "Sin límite",
  "aria-label": "Detener el giro automático si un premio supera este importe en créditos",
});

const stopButton = el("button.btn.btn--ghost.btn--block", {
  disabled: true,
  onclick: () => {
    autoStop = true;
    autoStatus.textContent = "Se detendrá al terminar la ronda…";
  },
}, "Detener");

const autoButtons = [10, 25, 50].map((count) =>
  el("button.chip-btn", {
    type: "button",
    // The visible label is just the number, so the accessible name spells the
    // action out while still containing it (WCAG "label in name").
    "aria-label": `Girar ${count} veces automáticamente`,
    title: `Girar ${count} veces automáticamente`,
    onclick: () => { void runAuto(count); },
  }, String(count))
);

const autoPanel = el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
  el("span.label", {}, "Giro automático"),
  el("div.chip-row", {}, autoButtons),
  el("div.field", {}, [
    el("span.label", {}, "Parar si gano más de"),
    autoThreshold,
  ]),
  stopButton,
  autoStatus,
]);

function setBusy(value) {
  busy = value;
  bet.setBusy(value, value ? "Girando…" : undefined);
  for (const button of autoButtons) button.disabled = value || autoLeft > 0;
  stopButton.disabled = autoLeft === 0;
}

/**
 * Autoplay: a plain loop, because every round already awaits its own animation.
 * It stops when the batch runs out, when the player asks, or when a single round
 * pays more than the threshold.
 */
async function runAuto(count) {
  if (busy || autoLeft > 0) return;
  autoLeft = count;
  autoStop = false;
  const threshold = Math.round(Number(String(autoThreshold.value).replace(",", ".")) * 100);
  const limit = Number.isFinite(threshold) && threshold > 0 ? threshold : 0;

  while (autoLeft > 0 && !autoStop) {
    autoStatus.textContent = `Quedan ${autoLeft} tiradas automáticas.`;
    const outcome = await playRound();
    if (!outcome) break;
    autoLeft--;
    if (limit && outcome.payout >= limit) {
      toast(`Giro automático detenido: has ganado ${credits(outcome.payout)}.`, { variant: "win" });
      break;
    }
    if (autoLeft > 0 && !autoStop) await wait(AUTO_GAP_MS);
  }

  autoLeft = 0;
  autoStop = false;
  autoStatus.textContent = "";
  setBusy(false);
}

/* --- Round ----------------------------------------------------------------- */

function showFreeBanner(spinsLeft, wonSoFar) {
  machine.freeBanner.hidden = false;
  replace(machine.freeBanner, [
    icon("sparkle", { size: 20 }),
    el("span", {}, `Tiradas gratis ×${FREE_SPIN_MULTIPLIER}`),
    el("span.free-banner__count", {}, `${spinsLeft} restantes`),
    el("span.free-banner__count", {}, `Acumulado ${credits(wonSoFar)}`),
  ]);
}

/**
 * Play the feature out for real: every free spin is its own provably-fair round
 * with its own nonce, costs nothing, and adds to the running total.
 * @returns {Promise<number>} minor units won across the feature
 */
async function playFreeSpins(count, lineBet) {
  let won = 0;
  showFreeBanner(count, 0);
  await wait(reducedMotion() ? 0 : 700);

  for (let i = 0; i < count; i++) {
    const round = fairness.nextRound();
    persistFairness();

    const result = spin(round, { freeSpin: true });
    await spinReels(machine, result.positions, { fast: true });
    won += result.totalMultiplier * lineBet;
    await presentWins(machine, result, lineBet);
    showFreeBanner(count - i - 1, won);
    if (!reducedMotion()) await wait(260);
    clearHighlight(machine);
  }

  setReadout(machine, {
    tone: won > 0 ? "win" : "idle",
    amount: won > 0 ? won : null,
    detail: won > 0 ? `Total de las ${count} tiradas gratis` : "Las tiradas gratis no han pagado.",
  });
  await wait(reducedMotion() ? 0 : 900);
  machine.freeBanner.hidden = true;
  return won;
}

/**
 * One paid round: base spin, then the feature if it triggered.
 * The whole thing settles as a single bet so the ledger shows one payout per
 * round, with the free spins recorded in the detail.
 * @returns {Promise<{payout:number, stake:number}|null>} null if the bet was refused
 */
async function playRound() {
  if (busy) return null;

  const stake = snapStake(bet.stake);
  bet.setStake(stake);
  updateHint();
  const lineBet = stake / LINES;

  let hand;
  try {
    hand = openRound({ stake, game: "slots" });
  } catch (err) {
    const message = err.name === "InsufficientFunds"
      ? "Saldo insuficiente para esa apuesta."
      : err.message;
    toast(message, { variant: err instanceof LimitReached ? "warn" : "loss" });
    return null;
  }

  setBusy(true);
  clearHighlight(machine);
  machine.winList.replaceChildren();
  setReadout(machine, { detail: "Girando…" });

  let payout = 0;
  try {
    const base = spin(hand.round);
    await spinReels(machine, base.positions);
    payout += base.totalMultiplier * lineBet;
    await presentWins(machine, base, lineBet);

    if (base.freeSpinsAwarded > 0) {
      toast(`¡${base.scatterCount} estrellas! ${base.freeSpinsAwarded} tiradas gratis con ×${FREE_SPIN_MULTIPLIER}.`, {
        variant: "win",
        title: "Ronda de bonificación",
        timeout: 6000,
      });
      payout += await playFreeSpins(base.freeSpinsAwarded, lineBet);
    }

    hand.settle(payout, {
      lines: base.wins.filter((w) => w.line != null).length,
      scatterCount: base.scatterCount,
      freeSpins: base.freeSpinsAwarded,
      totalMultiplier: base.totalMultiplier,
    });
  } catch (err) {
    // A crash mid-animation must not swallow the stake.
    hand.cancel("error");
    toast("La ronda ha fallado y se te ha devuelto la apuesta.", { variant: "loss" });
    throw err;
  } finally {
    if (autoLeft === 0) setBusy(false);
    else busy = false;
  }

  history.push({
    label: payout > 0 ? `+${credits(payout)}` : `−${credits(stake)}`,
    win: payout > 0,
  });
  if (payout === 0) clearHighlight(machine);

  return { payout, stake };
}

/* --- Mount ----------------------------------------------------------------- */

append($("#slots"), [
  el("div.game-layout", {}, [
    stage,
    el("aside.game-controls", {}, [bet.root, autoPanel, paytablePanel(), stats.root]),
  ]),
  el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)", marginTop: "var(--space-5)" } }, [
    el("span.label", {}, "Últimas rondas"),
    history.root,
    el("span.field__hint", {}, "Cada ficha es una ronda completa, tiradas gratis incluidas."),
  ]),
  playMoneyNote(),
]);

// Park the reels on a plausible-looking grid so the cabinet is never empty.
REELS.forEach((reel, i) => primeReel(machine.strips[i], i, (i * 7 + 3) % reel.length, 0));
