/**
 * Crash — DOM controller.
 *
 * The maths lives in ../games/crash.js. This file does four things:
 *   1. opens a seeded round and reads its crash point *before* the first frame,
 *   2. draws the curve on a canvas with requestAnimationFrame,
 *   3. pays out on cash-out (manual or automatic) against that fixed number,
 *   4. makes sure a round in flight is always settled — including when the
 *      player closes the tab or switches away mid-flight.
 *
 * The animation is a *view* of `timeToReach(crashPoint)`: every instant that
 * matters (the crash, the automatic cash-out, each simulated player leaving)
 * is a millisecond computed at take-off. A dropped frame or a slow device
 * changes what you see, never what you get.
 */

import { el, $, append, replace, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { credits, percent } from "../../../assets/js/format.js";
import {
  mountShell, betControls, historyStrip, statsPanel, playMoneyNote,
} from "./shell.js";
import { openRound, wallet, LimitReached } from "../core/context.js";
import {
  crashPointFrom, multiplierAt, timeToReach, resolve, payoutAt, winProbability,
  simulatedPlayers, bracketOf, normalizeCashout,
  MIN_CASHOUT, MAX_CASHOUT, HOUSE_EDGE, THEORETICAL_RTP, GROWTH_RATE,
} from "../games/crash.js";

/* --- Formatting ------------------------------------------------------------ */

/**
 * Plain decimals in Spanish notation. `format.js` has `multiplier()`, but it
 * builds its string with `toFixed`, which prints an English decimal point —
 * unusable next to `credits()` and `percent()`, which are es-ES.
 */
const decimalFormat = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = (value) => decimalFormat.format(value);
/** Seconds with one decimal, for the intermission clock: "4,3 s". */
const seconds = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const times = (value) => `${num(value)}×`;
/** Axis labels: drop the decimals a round number does not need. */
const loose = (value) => Number(value.toFixed(2)).toLocaleString("es-ES");

/** Truncate, never round: the number on screen must not outrun the curve. */
const floor2 = (value) => Math.floor(value * 100) / 100;

/* --- Timing ---------------------------------------------------------------- */

/** Gap between rounds, in which a bet can be left armed for the next one. */
const INTERMISSION_MS = 5000;
/** Beat between the bang and the countdown, so the crash can be read. */
const CRASH_HOLD_MS = 1400;

/* --- Canvas graph ---------------------------------------------------------- */

const PAD = { left: 48, right: 16, top: 16, bottom: 28 };
/** Points sampled along the curve. Enough to look smooth at 4K, cheap at 60 Hz. */
const SAMPLES = 140;

/**
 * "Nice" axis step (1, 2, 5 × 10ⁿ) so the grid keeps round labels while the
 * scale grows by orders of magnitude during a single round.
 */
function niceStep(range, targetTicks) {
  const raw = Math.max(range, Number.EPSILON) / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function buildGraph() {
  const canvas = el("canvas.crash-canvas", {
    role: "img",
    "aria-label": "Gráfica del multiplicador de la ronda en curso",
  });
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  /** Colours and fonts come from the tokens, never from a literal in JS. */
  let ink = null;
  /** Last frame's inputs, so a resize can redraw without waiting for rAF. */
  let last = { elapsed: 0, multiplier: 1, crashed: false, cashedLine: null, autoLine: null };

  function readTokens() {
    const style = getComputedStyle(document.documentElement);
    const token = (name) => style.getPropertyValue(name).trim();
    ink = {
      accent: token("--accent"),
      accentHi: token("--accent-hi"),
      loss: token("--loss"),
      win: token("--win"),
      grid: token("--border"),
      axis: token("--fg-subtle"),
      mono: token("--font-mono"),
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Cap the device pixel ratio at 2: beyond that the extra pixels cost frame
    // time on phones and buy nothing on a 1 px line.
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    readTokens();
    draw(last);
  }

  /**
   * `cashedLine` and `autoLine` are multipliers, drawn as dashed references.
   * @param {{elapsed:number, multiplier:number, crashed:boolean, cashedLine:number|null, autoLine:number|null}} state
   */
  function draw(state) {
    last = state;
    if (!width || !height || !ink) return;

    const { elapsed, multiplier, crashed, cashedLine, autoLine } = state;
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const plotH = Math.max(1, height - PAD.top - PAD.bottom);

    // Both axes chase the curve with a margin, so the head never touches the
    // edge and the whole flight stays visible without ever redrawing history.
    const yMax = Math.max(2, multiplier * 1.2, cashedLine ? cashedLine * 1.2 : 0);
    const xMax = Math.max(5000, elapsed * 1.12);

    const xOf = (ms) => PAD.left + (ms / xMax) * plotW;
    const yOf = (m) => PAD.top + plotH - ((m - 1) / (yMax - 1)) * plotH;

    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.font = `600 11px ${ink.mono}`;

    /* Grid + axis labels. */
    ctx.strokeStyle = ink.grid;
    ctx.fillStyle = ink.axis;
    ctx.lineWidth = 1;

    const yStep = niceStep(yMax - 1, 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let m = 1; m <= yMax + 1e-9; m += yStep) {
      const py = Math.round(yOf(m)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, py);
      ctx.lineTo(width - PAD.right, py);
      ctx.stroke();
      ctx.fillText(`${loose(m)}×`, PAD.left - 8, py);
    }

    const xStep = niceStep(xMax / 1000, 5) * 1000;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let t = 0; t <= xMax + 1e-9; t += xStep) {
      const px = Math.round(xOf(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, PAD.top);
      ctx.lineTo(px, height - PAD.bottom);
      ctx.stroke();
      ctx.fillText(`${loose(t / 1000)} s`, px, height - PAD.bottom + 8);
    }

    /* The curve: the exponential itself, sampled — not a polyline of frames,
       so it looks identical whether the round ran at 60 fps or at 12. */
    const stroke = crashed ? ink.loss : cashedLine != null ? ink.win : ink.accent;
    const points = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (elapsed * i) / SAMPLES;
      points.push([xOf(t), yOf(multiplierAt(t))]);
    }

    ctx.beginPath();
    ctx.moveTo(points[0][0], height - PAD.bottom);
    for (const [px, py] of points) ctx.lineTo(px, py);
    ctx.lineTo(points[points.length - 1][0], height - PAD.bottom);
    ctx.closePath();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = stroke;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    for (const [i, [px, py]] of points.entries()) {
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();

    /* Reference lines: where the automatic target sits, where the money left. */
    const dashed = (m, colour) => {
      if (m == null || m > yMax || m < 1) return;
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.5;
      const py = Math.round(yOf(m)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, py);
      ctx.lineTo(width - PAD.right, py);
      ctx.stroke();
      ctx.restore();
    };
    if (cashedLine == null && !crashed) dashed(autoLine, ink.accentHi);
    dashed(cashedLine, ink.win);

    /* Head of the rocket. */
    const [hx, hy] = points[points.length - 1];
    ctx.save();
    ctx.shadowColor = stroke;
    ctx.shadowBlur = crashed ? 24 : 14;
    ctx.fillStyle = crashed ? ink.loss : ink.accentHi;
    ctx.beginPath();
    ctx.arc(hx, hy, crashed ? 8 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const root = el("div.crash-graph", {}, [canvas]);
  // ResizeObserver rather than a window listener: the stage also changes width
  // when the sidebar wraps underneath at 1024 px, with no resize event at all.
  new ResizeObserver(resize).observe(canvas);
  readTokens();

  return { root, canvas, draw, resize };
}

/* --- Page furniture -------------------------------------------------------- */

mountShell({ active: "crash" });

const graph = buildGraph();

/** Huge, updated every frame — hidden from screen readers, which get `status`. */
const readoutValue = el("div.crash-readout__value", { "aria-hidden": "true" }, times(1));
const readoutNote = el("div.crash-readout__note", { "aria-hidden": "true" }, "Esperando apuesta");
const readout = el("div.crash-readout", {}, [readoutValue, readoutNote]);

/**
 * Discrete announcements only (take-off, cash-out, crash). A polite live region
 * fed at 60 Hz would make the page unusable with a screen reader.
 */
const status = el("p.crash-status", { role: "status", "aria-live": "polite" },
  "Prepara tu apuesta: la ronda despega cuando termine la cuenta atrás.");

const cashoutLabel = el("span.crash-cashout__label", {}, "Retirar");
const cashoutAmount = el("span.crash-cashout__amount", {}, "—");
const cashoutButton = el("button.btn.crash-cashout", {
  type: "button",
  disabled: true,
  "aria-label": "Retirar la apuesta ahora",
  onclick: () => cashOutManually(),
}, [cashoutLabel, cashoutAmount]);

/* --- Automatic cash-out ---------------------------------------------------- */

const autoInput = el("input#crash-auto.input", {
  type: "number",
  min: String(MIN_CASHOUT),
  max: String(MAX_CASHOUT),
  step: "0.01",
  placeholder: "Sin retirada automática",
  inputmode: "decimal",
  "aria-label": `Multiplicador de retirada automática, entre ${num(MIN_CASHOUT)} y ${num(MAX_CASHOUT)}`,
});

const autoHint = el("span.field__hint", {}, "Vacío: retiras a mano.");

const autoPresets = el("div.chip-row", {},
  [1.5, 2, 5, 10].map((value) =>
    el("button.chip-btn", {
      type: "button",
      title: `Retirada automática a ${times(value)}`,
      onclick: () => {
        autoInput.value = value.toFixed(2);
        syncAuto();
      },
    }, times(value))
  )
);

/**
 * The target the player has armed, or null when the field is empty.
 * Read straight from the field at take-off, so editing it mid-flight cannot
 * change a round that is already in the air.
 * @returns {number|null}
 */
function autoTarget() {
  const raw = String(autoInput.value).trim();
  if (raw === "") return null;
  return normalizeCashout(raw);
}

/** Keep the odds line honest with whatever is typed in the field. */
function syncAuto() {
  const target = autoTarget();
  if (target == null) {
    autoHint.textContent = "Vacío: retiras a mano.";
    return;
  }
  autoHint.textContent =
    `Llega a ${times(target)} el ${percent(winProbability(target), { decimals: 2 })} de las rondas · pagaría ${credits(payoutAt(bet.stake, target))}`;
}

/* --- Simulated lobby ------------------------------------------------------- */

const botList = el("ul.crash-bots__list", { "aria-label": "Apuestas simuladas de esta ronda" });
/** @type {{bot:object, node:HTMLElement, out:HTMLElement, done:boolean}[]} */
let botRows = [];

function renderBots(bots) {
  botRows = bots.map((bot) => {
    const out = el("span.crash-bot__out", {}, "En vuelo");
    const node = el("li.crash-bot", {}, [
      el("span.crash-bot__name.truncate", {}, bot.name),
      el("span.crash-bot__stake.mono", {}, credits(bot.stake)),
      out,
    ]);
    return { bot, node, out, done: false };
  });
  replace(botList, botRows.map((row) => row.node));
}

/** A bot leaves the round the millisecond its own target says it does. */
function updateBots(elapsed) {
  for (const row of botRows) {
    if (row.done || !row.bot.win || elapsed < row.bot.at) continue;
    row.done = true;
    row.node.classList.add("is-out");
    row.out.textContent = `${times(row.bot.cashoutAt)} · ${credits(row.bot.payout)}`;
  }
}

function bustBots() {
  for (const row of botRows) {
    if (row.done) continue;
    row.done = true;
    row.node.classList.add("is-busted");
    row.out.textContent = "Reventó";
  }
}

/* --- Bet controls ---------------------------------------------------------- */

const bet = betControls({
  initial: 1000,
  actionLabel: "Apostar en la próxima",
  onAction: () => toggleBet(),
});

bet.input.addEventListener("input", () => syncAuto());
bet.root.addEventListener("click", () => syncAuto());
autoInput.addEventListener("input", () => syncAuto());
autoInput.addEventListener("change", () => {
  const target = autoTarget();
  if (target != null) autoInput.value = target.toFixed(2);
  syncAuto();
});

const history = historyStrip();
const stats = statsPanel();

/* --- Round state ----------------------------------------------------------- */

/** @type {"countdown"|"ready"|"flying"} */
let phase = "countdown";
/** Bet left prepared for the next take-off. */
let armed = false;

/**
 * The round in flight. Everything in it except `cashedOut` is decided before
 * the first frame is drawn.
 * @type {null | {
 *   handle: ReturnType<typeof openRound>, stake: number, crashPoint: number,
 *   crashAt: number, auto: number|null, autoAt: number|null, startedAt: number,
 *   cashedOut: number|null, settled: boolean,
 * }}
 */
let flight = null;

let frameId = 0;
let countdownId = 0;
let countdownEndsAt = 0;

/* --- Action button --------------------------------------------------------- */

function updateActionButton() {
  if (phase === "flying") {
    bet.setBusy(true, "Ronda en vuelo");
    bet.action.classList.remove("btn--success");
    return;
  }
  bet.setBusy(false, phase === "ready"
    ? "Despegar ahora"
    : armed ? "Apuesta preparada · anular" : "Apostar en la próxima");
  // `.btn--success` already exists in base.css: an armed bet turns the action
  // green rather than inventing a state class of its own.
  bet.action.classList.toggle("btn--success", armed && phase === "countdown");
}

function toggleBet() {
  if (phase === "flying") return;
  if (phase === "ready") {
    launch();
    return;
  }
  armed = !armed;
  if (armed && !wallet.canAfford(bet.stake)) {
    toast("No te llega el saldo para esa apuesta.", { variant: "warn" });
    armed = false;
  }
  updateActionButton();
}

/* --- Intermission ---------------------------------------------------------- */

function startCountdown() {
  phase = "countdown";
  countdownEndsAt = performance.now() + INTERMISSION_MS;
  updateActionButton();
  clearInterval(countdownId);
  countdownId = setInterval(tickCountdown, 100);
  tickCountdown();
}

function tickCountdown() {
  const left = countdownEndsAt - performance.now();
  if (left <= 0) {
    clearInterval(countdownId);
    countdownId = 0;
    if (armed) {
      launch();
    } else {
      phase = "ready";
      readoutNote.textContent = "Listo para despegar";
      updateActionButton();
    }
    return;
  }
  readoutNote.textContent = `Próxima ronda en ${seconds.format(left / 1000)} s`;
}

/* --- Take-off -------------------------------------------------------------- */

function launch() {
  if (phase === "flying") return;

  const stake = bet.stake;
  let handle;
  try {
    handle = openRound({ stake, game: "crash" });
  } catch (err) {
    const message = err instanceof LimitReached
      ? err.message
      : err.name === "InsufficientFunds"
        ? "Saldo insuficiente para esa apuesta."
        : err.message;
    toast(message, { variant: err instanceof LimitReached ? "warn" : "loss" });
    armed = false;
    startCountdown();
    return;
  }

  // THE decision of the game, taken here and never revisited: the crash point
  // comes out of the seeded round before a single frame is drawn.
  const crashPoint = crashPointFrom(handle.round);
  const auto = autoTarget();
  // Whether the automatic target survives is decided by the same comparison
  // that settles the bet, so the animation cannot disagree with the payout.
  const autoWins = auto != null && resolve({ crashPoint, cashoutAt: auto, stake }).win;

  flight = {
    handle,
    stake,
    crashPoint,
    crashAt: timeToReach(crashPoint),
    auto,
    autoAt: autoWins ? timeToReach(auto) : null,
    startedAt: performance.now(),
    cashedOut: null,
    settled: false,
  };

  phase = "flying";
  armed = false;
  updateActionButton();
  renderBots(simulatedPlayers(handle.round, { crashPoint }));

  readout.classList.remove("is-crashed", "is-cashed");
  readoutNote.textContent = "En vuelo · retira antes del reventón";
  cashoutButton.disabled = false;
  cashoutLabel.textContent = "Retirar";
  status.textContent = `Ronda ${credits(stake)} en el aire.${auto ? ` Retirada automática a ${times(auto)}.` : ""}`;

  frameId = requestAnimationFrame(step);
}

/* --- The animation loop ---------------------------------------------------- */

function step(now) {
  if (!flight) return;
  const elapsed = now - flight.startedAt;

  // Order matters: on a round whose crash point *is* the automatic target, the
  // player cashes out — reaching the multiplier is reaching it (see resolve()).
  if (flight.autoAt != null && flight.cashedOut == null && elapsed >= flight.autoAt) {
    cashOut(flight.auto, "automática");
  }

  if (elapsed >= flight.crashAt) {
    bust();
    return;
  }

  const multiplier = multiplierAt(elapsed);
  paint(elapsed, multiplier, false);
  updateBots(elapsed);
  frameId = requestAnimationFrame(step);
}

/** One frame of everything that shows a live number. */
function paint(elapsed, multiplier, crashed) {
  const shown = floor2(multiplier);
  readoutValue.textContent = times(shown);
  graph.draw({
    elapsed,
    multiplier,
    crashed,
    cashedLine: flight?.cashedOut ?? null,
    autoLine: flight?.auto ?? null,
  });

  if (flight && flight.cashedOut == null && !crashed) {
    // The button states the exact figure that would be credited, computed with
    // the same rounding as the settlement.
    cashoutAmount.textContent = credits(payoutAt(flight.stake, shown));
    cashoutButton.setAttribute("aria-label", `Retirar ahora a ${times(shown)}`);
  }
}

/* --- Cashing out ----------------------------------------------------------- */

function cashOutManually() {
  if (!flight || phase !== "flying" || flight.cashedOut != null) return;
  const elapsed = performance.now() - flight.startedAt;
  // The frame that crosses the crash instant ends the round; a click landing
  // after it is simply late, and late is a loss.
  if (elapsed >= flight.crashAt) return;
  // Priced at the instant of the click, not at the last frame: the curve is a
  // continuous function of time and the frame on screen is up to ~16 ms stale,
  // which can only ever pay a hundredth *more* than the button was showing.
  cashOut(floor2(multiplierAt(elapsed)), "manual");
}

/**
 * Settle the round in the player's favour. The curve keeps climbing to the
 * crash point afterwards — seeing what you left on the table is half the game.
 * @param {number} multiplier
 * @param {"manual"|"automática"} kind
 */
function cashOut(multiplier, kind) {
  if (!flight || flight.settled) return;
  const outcome = resolve({
    crashPoint: flight.crashPoint,
    cashoutAt: multiplier,
    stake: flight.stake,
  });

  flight.cashedOut = outcome.multiplier;
  flight.settled = true;
  flight.handle.settle(outcome.payout, {
    crashPoint: flight.crashPoint,
    cashoutAt: outcome.multiplier,
    kind,
  });

  const profit = outcome.payout - flight.stake;
  readout.classList.add("is-cashed");
  cashoutButton.disabled = true;
  cashoutLabel.textContent = `Retirada ${kind} a ${times(outcome.multiplier)}`;
  cashoutAmount.textContent = credits(outcome.payout);
  status.textContent = `Te has retirado a ${times(outcome.multiplier)}: ${credits(outcome.payout)} (${profit >= 0 ? "+" : "−"}${credits(Math.abs(profit))}).`;
  toast(`Retirada a ${times(outcome.multiplier)} · ${credits(outcome.payout)}`, { variant: "win" });
}

/* --- The bang -------------------------------------------------------------- */

function bust() {
  if (!flight) return;
  const { crashPoint, stake, cashedOut } = flight;

  if (!flight.settled) {
    flight.settled = true;
    flight.handle.settle(0, { crashPoint, cashoutAt: null, kind: "reventón" });
  }

  cancelAnimationFrame(frameId);
  frameId = 0;

  paint(flight.crashAt, crashPoint, true);
  bustBots();

  readout.classList.add("is-crashed");
  readoutValue.textContent = times(crashPoint);
  readoutNote.textContent = `REVENTÓ EN ${times(crashPoint)}`;
  cashoutButton.disabled = true;
  if (cashedOut == null) {
    cashoutLabel.textContent = "Reventó";
    cashoutAmount.textContent = `−${credits(stake)}`;
    status.textContent = `Reventó en ${times(crashPoint)}. Pierdes ${credits(stake)}.`;
  } else {
    status.textContent += ` Habría reventado en ${times(crashPoint)}.`;
  }

  pushHistory(crashPoint);
  finishRound();
}

/** Crash multipliers, coloured by bracket: rojo <2×, normal 2–10×, dorado >10×. */
function pushHistory(crashPoint) {
  const bracket = bracketOf(crashPoint);
  history.push({ label: times(crashPoint), win: bracket !== "low" });
  history.root.firstElementChild?.classList.add(`crash-pill--${bracket}`);
}

function finishRound() {
  flight = null;
  phase = "countdown";
  updateActionButton();
  // Hold the wreckage on screen for a beat before the countdown takes over.
  setTimeout(() => {
    if (phase === "countdown" && !flight) startCountdown();
  }, CRASH_HOLD_MS);
}

/* --- Leaving mid-flight ---------------------------------------------------- */

/**
 * A round in the air must never be left hanging: the stake is already debited
 * and the wallet would keep an open bet forever. Closing the tab or switching
 * away without having cashed out loses the round — the same as if the rocket
 * had blown up while nobody was looking. `requestAnimationFrame` is throttled
 * to a standstill in a hidden tab, so there is no honest alternative.
 *
 * @param {string} reason
 */
function abandon(reason) {
  if (!flight) return;
  const lost = !flight.settled;
  if (lost) {
    flight.settled = true;
    flight.handle.settle(0, { crashPoint: flight.crashPoint, cashoutAt: null, kind: reason });
  }

  cancelAnimationFrame(frameId);
  frameId = 0;
  const { crashPoint, stake } = flight;

  bustBots();
  readout.classList.add("is-crashed");
  readoutValue.textContent = times(crashPoint);
  readoutNote.textContent = `REVENTÓ EN ${times(crashPoint)}`;
  cashoutButton.disabled = true;
  if (lost) {
    cashoutLabel.textContent = "Ronda abandonada";
    cashoutAmount.textContent = `−${credits(stake)}`;
    status.textContent = `Dejaste la ronda en el aire sin retirar: pierdes ${credits(stake)}. Reventó en ${times(crashPoint)}.`;
  }

  pushHistory(crashPoint);
  finishRound();
}

addEventListener("beforeunload", () => abandon("página cerrada"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") abandon("pestaña oculta");
});

/* --- Explainer ------------------------------------------------------------- */

const explainer = el("details.panel.crash-explain", {}, [
  el("summary", {}, ["Cómo se decide el reventón", icon("chevronDown", { size: 18 })]),
  el("div.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
    el("p", {}, [
      "Al aceptar la apuesta se saca un número ", el("code", {}, "u"),
      " entre 0 y 1 de la ronda sembrada y se calcula ",
      el("code", {}, "piso(99 ÷ (1 − u)) ÷ 100"),
      ". Ese es el punto de reventón, fijado ", el("b", {}, "antes"),
      " de la animación: la curva solo lo dibuja. Cuándo pulses no lo cambia.",
    ]),
    el("p", {}, [
      "La probabilidad de llegar a un multiplicador ", el("code", {}, "m"), " es ",
      el("code", {}, "0,99 ÷ m"), ", así que retirar siempre en ", el("code", {}, "m"),
      " devuelve ", el("code", {}, "(0,99 ÷ m) × m = 0,99"),
      ": un RTP del ", percent(THEORETICAL_RTP, { decimals: 0 }),
      " en cualquier objetivo. Toda la ventaja de la casa (",
      percent(HOUSE_EDGE, { decimals: 0 }),
      ") está en que una ronda de cada cien revienta en 1,00× de salida.",
    ]),
    el("p", {}, [
      "La curva es ", el("code", {}, `m(t) = e^(${loose(GROWTH_RATE * 1000)} · t)`),
      " con ", el("code", {}, "t"), " en segundos: el multiplicador se dobla cada ",
      num(Math.LN2 / GROWTH_RATE / 1000), " s. Retirar justo en el multiplicador del reventón cuenta como retirada a tiempo.",
    ]),
  ]),
]);

/* --- Mount ----------------------------------------------------------------- */

const autoPanel = el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
  el("span.label", {}, "Retirada automática"),
  el("div.field", {}, [
    el("label.field__hint", { for: "crash-auto" }, "Multiplicador objetivo"),
    autoInput,
    autoHint,
  ]),
  autoPresets,
  el("button.btn.btn--ghost.btn--sm", {
    type: "button",
    onclick: () => {
      autoInput.value = "";
      syncAuto();
    },
  }, "Quitar objetivo"),
]);

const botsPanel = el("div.panel.stack.crash-bots", { style: { "--stack-gap": "var(--space-3)" } }, [
  el("div.row.row--between", {}, [
    el("span.label", {}, "En esta ronda"),
    el("span.badge.badge--info", {}, "Simulados"),
  ]),
  botList,
  el("span.field__hint", {}, "Jugadores de mentira: sus apuestas y sus retiradas salen de la misma ronda sembrada que tu resultado, así que se reproducen igual al verificar el nonce. No hay nadie más jugando."),
]);

append($("#crash"), [
  el("div.game-layout.crash-layout", {}, [
    el("section.stage.stage--crash", {}, [
      el("div.crash-stage", {}, [graph.root, readout]),
      cashoutButton,
      status,
    ]),
    el("aside.game-controls", {}, [bet.root, autoPanel, botsPanel, explainer, stats.root]),
  ]),
  el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)", marginTop: "var(--space-5)" } }, [
    el("span.label", {}, "Últimos reventones"),
    history.root,
    el("span.field__hint", {}, "Rojo por debajo de 2×, dorado por encima de 10×."),
  ]),
  playMoneyNote(),
]);

// The canvas has no size until it is in the document.
graph.resize();
graph.draw({ elapsed: 0, multiplier: 1, crashed: false, cashedLine: null, autoLine: null });
syncAuto();
updateActionButton();
startCountdown();
