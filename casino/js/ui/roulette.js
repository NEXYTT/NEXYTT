/**
 * Ruleta Europea — DOM controller.
 *
 * All the rules live in ../games/roulette.js; this file draws the wheel, the
 * felt, and the chips, and turns clicks into validated bets.
 *
 * ## The animation never decides anything
 * The pocket is drawn from the round's stream *before* the ball moves, and the
 * animation is then solved backwards: the rotor's final rotation is picked
 * first, and the ball's final angle is whatever lands it on that pocket. So the
 * wheel can only ever stop on the number the RNG already produced.
 *
 * ## Placing compound bets
 * A 3×12 felt on a phone leaves ~30 px per square: real corner/split hot zones
 * on the borders would be 7 px wide and unusable. Instead the player picks the
 * kind of chip first (Pleno / Caballo / Calle / Cuadro / Seisena) and only that
 * family's targets are live, each one a proper button with its own label and
 * a hover preview of the numbers it covers. One click, one bet, no guessing.
 */

import { el, $, replace, append, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { credits, percent } from "../../../assets/js/format.js";
import {
  mountShell, betControls, historyStrip, statsPanel, playMoneyNote,
} from "./shell.js";
import { openRound, wallet, LimitReached } from "../core/context.js";
import {
  WHEEL, POCKETS, BET_TYPES, SPLITS, STREETS, CORNERS, SIXLINES, THEORETICAL_RTP,
  spin, payoutFor, betKey, betLabel, betNumbers, colorOf, totalStake, validateBet,
} from "../games/roulette.js";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const mod360 = (deg) => ((deg % 360) + 360) % 360;

/* --- Wheel ----------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

/** Degrees per pocket: 360/37 ≈ 9,73°. */
const STEP = 360 / POCKETS;
const R_OUTER = 114;
const R_INNER = 72;
const R_LABEL = 101;
const R_BALL_TRACK = 124;
const R_BALL_REST = 84;
/** Full turns of the rotor and of the ball in one spin — they counter-rotate. */
const ROTOR_TURNS = 5;
const BALL_TURNS = 8;
const SPIN_MS = 4200;

/** Cartesian point at radius `r`, `deg` measured clockwise from 12 o'clock. */
function point(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** One pocket wedge, drawn as an annular sector. */
function sectorPath(index) {
  const a0 = index * STEP - STEP / 2;
  const a1 = index * STEP + STEP / 2;
  const [x0, y0] = point(R_OUTER, a0);
  const [x1, y1] = point(R_OUTER, a1);
  const [x2, y2] = point(R_INNER, a1);
  const [x3, y3] = point(R_INNER, a0);
  // Each wedge is < 180°, so the large-arc flag is always 0.
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R_OUTER} ${R_OUTER} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}` +
    `L${x2.toFixed(2)} ${y2.toFixed(2)}A${R_INNER} ${R_INNER} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
}

function buildWheel() {
  const rotor = svgEl("g", { class: "rl-rotor" });

  WHEEL.forEach((number, index) => {
    rotor.append(svgEl("path", {
      class: `rl-sector rl-sector--${colorOf(number)}`,
      d: sectorPath(index),
    }));
  });

  WHEEL.forEach((number, index) => {
    const [x, y] = point(R_LABEL, index * STEP);
    const label = svgEl("text", {
      class: "rl-pocket-label",
      transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(index * STEP).toFixed(2)})`,
    });
    label.textContent = String(number);
    rotor.append(label);
  });

  // Turret: four spokes that make the rotation readable at a glance.
  for (let i = 0; i < 4; i++) {
    const [x, y] = point(R_INNER - 4, i * 90);
    rotor.append(svgEl("line", { class: "rl-spoke", x1: 0, y1: 0, x2: x.toFixed(2), y2: y.toFixed(2) }));
  }
  rotor.append(svgEl("circle", { class: "rl-hub", r: 26 }));

  const ball = svgEl("circle", { class: "rl-ball", r: 5.5 });

  const readout = el("div.rl-readout", { role: "status", "aria-live": "polite" }, [
    el("span.rl-readout__number", {}, "—"),
    el("span.rl-readout__note", {}, "Sin giros todavía"),
  ]);

  const svg = svgEl("svg", {
    class: "rl-wheel__svg",
    viewBox: "-132 -132 264 264",
    role: "img",
    "aria-label": "Rueda de ruleta europea con 37 casillas",
  }, [
    svgEl("circle", { class: "rl-rim", r: 128 }),
    svgEl("circle", { class: "rl-track", r: R_BALL_TRACK }),
    rotor,
    svgEl("circle", { class: "rl-well", r: R_INNER - 6 }),
    ball,
    // Static marker at 12 o'clock: the pocket under it is the winner.
    svgEl("path", { class: "rl-marker", d: "M0 -114L-7 -131L7 -131Z" }),
  ]);

  const root = el("div.rl-wheel", {}, [svg, readout]);
  return { root, svg, rotor, ball, readout };
}

const wheel = buildWheel();

/** Current absolute angles, kept in [0,360) so they never grow unbounded. */
let rotorAngle = 0;
let ballAngle = 0;

function placeBall(deg, radius) {
  const [x, y] = point(radius, deg);
  wheel.ball.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
}

/**
 * Spin to a pocket that has already been decided.
 *
 * A pocket drawn at local angle `index × STEP` appears at `index × STEP +
 * rotorAngle` once the rotor is rotated, so the ball's final angle is derived
 * from the rotor's final angle. Adding whole turns changes the journey, never
 * the destination.
 *
 * @param {number} index pocket index in WHEEL
 */
function animateSpin(index) {
  const pocketAngle = index * STEP;
  // The rotor turns anticlockwise and is stopped so the winning pocket comes to
  // rest under the marker at 12 o'clock — where the player is already looking.
  const rotorEnd = rotorAngle - 360 * ROTOR_TURNS - mod360(rotorAngle + pocketAngle);
  const target = rotorEnd + pocketAngle;      // ≡ 0°, i.e. straight up
  let ballEnd = ballAngle + 360 * BALL_TURNS; // ball travels clockwise
  ballEnd += mod360(target - ballEnd);        // …and lands in that pocket

  const settle = () => {
    rotorAngle = mod360(rotorEnd);
    ballAngle = mod360(ballEnd);
    wheel.rotor.setAttribute("transform", `rotate(${rotorAngle.toFixed(2)})`);
    placeBall(ballAngle, R_BALL_REST);
  };

  if (reducedMotion()) {
    settle();
    return Promise.resolve();
  }

  const rotorFrom = rotorAngle;
  const ballFrom = ballAngle;
  const started = performance.now();

  return new Promise((resolve) => {
    const frame = (now) => {
      const t = Math.min(1, (now - started) / SPIN_MS);
      const eased = 1 - (1 - t) ** 4; // heavy wheel losing speed
      wheel.rotor.setAttribute("transform", `rotate(${(rotorFrom + (rotorEnd - rotorFrom) * eased).toFixed(2)})`);

      // The ball rides the outer track first and only drops into the pockets
      // during the last stretch, with a couple of decaying bounces.
      const drop = Math.max(0, (t - 0.42) / 0.58);
      const dropEase = 1 - (1 - drop) ** 3;
      const bounce = Math.sin(drop * Math.PI * 3) * (1 - drop) * 4;
      const radius = R_BALL_TRACK + (R_BALL_REST - R_BALL_TRACK) * dropEase + bounce;
      placeBall(ballFrom + (ballEnd - ballFrom) * eased, radius);

      if (t < 1) requestAnimationFrame(frame);
      else {
        settle();
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

/* --- Felt geometry --------------------------------------------------------- */

/** The number grid is exactly 12 columns × 3 rows with no gaps, so a cell
 *  centre is a plain percentage — which is what the hot zones are placed with. */
const COL_W = 100 / 12;
const ROW_H = 100 / 3;

/** Top row is 3,6,…,36; bottom row is 1,4,…,34. */
const cellOf = (n) => ({ col: Math.ceil(n / 3), row: 3 - ((n - 1) % 3) });
const centreOf = (n) => {
  const { col, row } = cellOf(n);
  return { x: (col - 0.5) * COL_W, y: (row - 0.5) * ROW_H };
};

/**
 * The zero sits outside the grid, so averaging cell centres would put its bets
 * in the wrong place. Its six spots are pinned to the grid's left edge instead.
 */
const ZERO_ANCHORS = {
  "0-1": { x: 0, y: 2.5 * ROW_H },
  "0-2": { x: 0, y: 1.5 * ROW_H },
  "0-3": { x: 0, y: 0.5 * ROW_H },
  "0-1-2": { x: 0, y: 2 * ROW_H },
  "0-2-3": { x: 0, y: 1 * ROW_H },
  "0-1-2-3": { x: 0, y: 1.5 * ROW_H },
};

/** A compound bet sits at the centroid of the cells it touches: the midpoint of
 *  a split, the crossing of a corner, the axis of a six-line. */
function anchorOf(selection) {
  const pinned = ZERO_ANCHORS[selection.join("-")];
  if (pinned) return pinned;
  const points = selection.map(centreOf);
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

/** Hot-zone size, in percent of the grid. Only one family is live at a time,
 *  so each zone can be as large as its own neighbours allow. */
function zoneBox(typeId, selection) {
  const withZero = selection[0] === 0;
  switch (typeId) {
    case "split": return { w: COL_W * 0.5, h: ROW_H * 0.5 };
    case "corner": return withZero ? { w: COL_W * 0.5, h: ROW_H * 0.5 } : { w: COL_W * 0.62, h: ROW_H * 0.62 };
    case "street": return withZero ? { w: COL_W * 0.5, h: ROW_H * 0.5 } : { w: COL_W * 0.82, h: ROW_H * 2.7 };
    default: return { w: COL_W * 0.5, h: ROW_H * 2.7 }; // six-line
  }
}

/* --- Bet state ------------------------------------------------------------- */

/** key → {type, selection, amount, count}. One entry per betting spot. */
const placed = new Map();
/** Placement stack, so "deshacer" removes exactly the last chip. */
const placements = [];
/** Snapshot of the last spun layout, for "repetir". */
let previousBets = null;
let busy = false;

/** Spot elements by bet key: where a chip is drawn and which tooltip to update. */
const spots = new Map();
const spotLabels = new Map();

const currentBets = () =>
  [...placed.values()].map(({ type, selection, amount }) => ({ type, selection, amount }));

const stakedTotal = () => [...placed.values()].reduce((sum, b) => sum + b.amount, 0);

function placeChip(bet, amount = chipValue()) {
  if (busy) return;
  let key;
  let normalized;
  try {
    normalized = validateBet({ ...bet, amount });
    key = betKey(normalized);
  } catch (err) {
    toast(err.message, { variant: "loss" });
    return;
  }

  // Refuse here rather than at spin time: a table you cannot afford to spin is
  // worse than a chip that never lands.
  if (stakedTotal() + amount > wallet.balance) {
    toast("No te llega el saldo para esa ficha.", { variant: "warn" });
    return;
  }

  const entry = placed.get(key) ?? {
    type: normalized.type,
    selection: normalized.selection,
    amount: 0,
    count: 0,
  };
  entry.amount += amount;
  entry.count += 1;
  placed.set(key, entry);
  placements.push({ key, amount });
  renderBets();
}

function undoChip() {
  const last = placements.pop();
  if (!last) {
    toast("No hay fichas que retirar.", { variant: "info" });
    return;
  }
  const entry = placed.get(last.key);
  if (entry) {
    entry.amount -= last.amount;
    entry.count -= 1;
    if (entry.amount <= 0) placed.delete(last.key);
  }
  renderBets();
}

function clearBets() {
  placed.clear();
  placements.length = 0;
  renderBets();
}

function repeatBets() {
  if (!previousBets?.length) {
    toast("Todavía no hay una apuesta anterior que repetir.", { variant: "info" });
    return;
  }
  const total = previousBets.reduce((sum, b) => sum + b.amount, 0);
  if (total > wallet.balance) {
    toast("No te llega el saldo para repetir esa apuesta.", { variant: "warn" });
    return;
  }
  placed.clear();
  placements.length = 0;
  for (const bet of previousBets) {
    placed.set(betKey(bet), { ...bet, selection: bet.selection, count: bet.count });
    placements.push({ key: betKey(bet), amount: bet.amount });
  }
  renderBets();
}

/* --- Chips ----------------------------------------------------------------- */

/** Chip face value, short enough for a 30 px token. The exact amount lives in
 *  the bet slip and in the spot's tooltip. */
function chipFace(minorUnits) {
  const value = minorUnits / 100;
  if (value >= 1000) {
    const k = value / 1000;
    return `${String(k >= 10 ? Math.round(k) : Math.round(k * 10) / 10).replace(".", ",")}k`;
  }
  return String(Math.round(value * 10) / 10).replace(".", ",");
}

/** Colour tier by size of the pile, the way real chips are colour-coded. */
function chipTier(minorUnits) {
  if (minorUnits < 500) return 1;
  if (minorUnits < 2500) return 2;
  if (minorUnits < 10_000) return 3;
  if (minorUnits < 50_000) return 4;
  return 5;
}

function chipToken(entry) {
  return el(`div.chip-token.rl-chip.rl-chip--t${chipTier(entry.amount)}`, {
    "aria-hidden": "true",
    // More than one chip on the spot gets the stacked-edge shadow.
    dataset: { stacked: entry.count > 1 ? "yes" : "no" },
  }, chipFace(entry.amount));
}

/* --- Felt ------------------------------------------------------------------ */

const numbersBox = el("div.rl-numbers");
const previewClear = () => {
  // The zero cell hangs outside the number grid, so the whole felt is swept.
  for (const node of tapete.querySelectorAll(".is-preview")) node.classList.remove("is-preview");
};

function previewBet(bet) {
  previewClear();
  for (const n of betNumbers(bet)) cells.get(n)?.classList.add("is-preview");
}

/** number → its cell element, for highlighting. */
const cells = new Map();

/** Wire a betting spot: click places a chip, hover/focus previews its numbers. */
function wireSpot(node, bet, label) {
  const key = betKey(bet);
  spots.set(key, node);
  spotLabels.set(key, label);
  node.title = label;
  node.addEventListener("click", () => placeChip(bet));
  node.addEventListener("pointerenter", () => previewBet(bet));
  node.addEventListener("pointerleave", previewClear);
  node.addEventListener("focus", () => previewBet(bet));
  node.addEventListener("blur", previewClear);
  return node;
}

function numberCell(n) {
  const bet = { type: "straight", selection: n };
  const node = el(`button.rl-cell.rl-cell--${colorOf(n)}`, {
    type: "button",
    "aria-label": `Pleno ${n}, paga 35 a 1`,
    style: n === 0 ? undefined : { gridColumn: cellOf(n).col, gridRow: cellOf(n).row },
  }, [el("span.rl-cell__n", {}, String(n))]);
  cells.set(n, node);
  return wireSpot(node, bet, `Pleno ${n} · paga 35 a 1`);
}

function zoneButton(typeId, selection) {
  const bet = { type: typeId, selection };
  const { x, y } = anchorOf(selection);
  const { w, h } = zoneBox(typeId, selection);
  const label = `${betLabel(bet)} · paga ${BET_TYPES[typeId].payout} a 1`;
  const node = el("button.rl-zone", {
    type: "button",
    disabled: true,
    "aria-label": `${betLabel(bet)}, paga ${BET_TYPES[typeId].payout} a 1`,
    style: { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` },
  });
  return wireSpot(node, bet, label);
}

function outsideButton(typeId, selection, text, extraClass = "") {
  const bet = selection == null ? { type: typeId } : { type: typeId, selection };
  const label = `${betLabel(bet)} · paga ${BET_TYPES[typeId].payout} a 1`;
  const node = el(`button.rl-outside${extraClass}`, {
    type: "button",
    "aria-label": `${betLabel(bet)}, paga ${BET_TYPES[typeId].payout} a 1`,
  }, [el("span.rl-outside__label", {}, text)]);
  return wireSpot(node, bet, label);
}

/** The five families of inside bets, each on its own layer of hot zones. */
const LAYERS = [
  { mode: "split", list: SPLITS },
  { mode: "street", list: STREETS },
  { mode: "corner", list: CORNERS },
  { mode: "sixline", list: SIXLINES },
];

const layerNodes = new Map();
for (const { mode, list } of LAYERS) {
  const layer = el("div.rl-layer", { dataset: { mode } }, list.map((sel) => zoneButton(mode, sel)));
  layerNodes.set(mode, layer);
  numbersBox.append(layer);
}
for (let n = 1; n <= 36; n++) numbersBox.append(numberCell(n));

const zeroCell = numberCell(0);
zeroCell.classList.add("rl-zero");

// Top row of the felt is the third column (3,6,…,36), so the 2:1 buttons run
// 3, 2, 1 from top to bottom.
const columnButtons = el("div.rl-columns", {},
  [3, 2, 1].map((k) => outsideButton("column", k, "2:1", ".rl-outside--col")));

const dozenRow = el("div.rl-dozens", {}, [
  outsideButton("dozen", 1, "1ª docena · 1-12"),
  outsideButton("dozen", 2, "2ª docena · 13-24"),
  outsideButton("dozen", 3, "3ª docena · 25-36"),
]);

const simpleRow = el("div.rl-simple", {}, [
  outsideButton("low", null, "1-18"),
  outsideButton("even", null, "Par"),
  outsideButton("red", null, "Rojo", ".rl-outside--red"),
  outsideButton("black", null, "Negro", ".rl-outside--black"),
  outsideButton("odd", null, "Impar"),
  outsideButton("high", null, "19-36"),
]);

const tapete = el("div.rl-tapete", {}, [zeroCell, numbersBox, columnButtons, dozenRow, simpleRow]);

/* --- Chip mode selector ---------------------------------------------------- */

const MODES = [
  { id: "straight", label: "Pleno" },
  { id: "split", label: "Caballo" },
  { id: "street", label: "Calle" },
  { id: "corner", label: "Cuadro" },
  { id: "sixline", label: "Seisena" },
];

let mode = "straight";

const modeHint = el("p.rl-hint.text-xs.muted");

const modeButtons = MODES.map(({ id, label }) => {
  const type = BET_TYPES[id];
  return el("button.chip", {
    type: "button",
    "aria-pressed": id === mode ? "true" : "false",
    "aria-label": `Colocar fichas a ${label.toLowerCase()}, paga ${type.payout} a 1`,
    title: `${label} · paga ${type.payout} a 1`,
    onclick: () => setMode(id),
  }, [label, el("span.rl-chip-odds", {}, `${type.payout}:1`)]);
});

const MODE_HINTS = {
  straight: "Haz clic en cualquier número, el cero incluido.",
  split: "Haz clic entre dos casillas contiguas. El cero forma caballo con el 1, el 2 y el 3.",
  street: "Haz clic sobre una columna de tres. Junto al cero están los tríos 0/1/2 y 0/2/3.",
  corner: "Haz clic en el cruce de cuatro casillas. En el borde del cero está el «primeros cuatro».",
  sixline: "Haz clic entre dos calles contiguas para cubrir seis números.",
};

function setMode(id) {
  mode = id;
  for (const [i, button] of modeButtons.entries()) {
    button.setAttribute("aria-pressed", MODES[i].id === id ? "true" : "false");
  }
  // Only the live family is clickable; the rest are disabled so they neither
  // steal a click nor become a keyboard trap.
  for (const [layerMode, layer] of layerNodes) {
    const active = layerMode === id;
    layer.classList.toggle("is-active", active);
    for (const zone of layer.children) zone.disabled = !active || busy;
  }
  for (const cell of cells.values()) cell.disabled = id !== "straight" || busy;
  modeHint.textContent = MODE_HINTS[id];
  previewClear();
}

/* --- Bet slip -------------------------------------------------------------- */

const slipTotal = el("span.rl-slip__amount", {}, credits(0));
const slipList = el("div.rl-slip__list");
const slipPrize = el("div.rl-slip__prize", {}, [
  el("span.label", {}, "Premio de la ronda"),
  el("span.rl-slip__amount", {}, "—"),
]);

/** Repaint every chip and the bet slip from `placed`. Cheap: ~10 nodes. */
function renderBets() {
  for (const chip of tapete.querySelectorAll(".rl-chip")) chip.remove();

  for (const [key, node] of spots) {
    const entry = placed.get(key);
    const base = spotLabels.get(key);
    node.title = entry ? `${base} · ${credits(entry.amount)} apostados` : base;
    if (entry) node.append(chipToken(entry));
  }

  const bets = [...placed.values()];
  slipTotal.textContent = credits(stakedTotal());

  replace(slipList, bets.length
    ? bets.map((bet) => el("div.rl-slip__row", { dataset: { key: betKey(bet) } }, [
        el("span.rl-slip__name", {}, betLabel(bet)),
        el("span.rl-slip__cover.subtle", {}, `${BET_TYPES[bet.type].size} nº`),
        el("span.mono", {}, credits(bet.amount)),
      ]))
    : [el("p.text-xs.subtle", {}, "Aún no has colocado ninguna ficha.")]);

  bet.action.disabled = busy || bets.length === 0;
}

/* --- Session tally --------------------------------------------------------- */

const tally = { spins: 0, red: 0, black: 0, green: 0, odd: 0, even: 0, dozens: [0, 0, 0] };
const tallyBody = el("div.rl-tally");

function renderTally() {
  const share = (n) => (tally.spins ? percent(n / tally.spins, { decimals: 1 }) : "—");
  const row = (label, count, tone = "") =>
    el(`div.rl-tally__row${tone}`, {}, [
      el("span", {}, label),
      el("span.mono", {}, String(count)),
      el("span.mono.subtle", {}, share(count)),
    ]);

  replace(tallyBody, [
    row("Rojo", tally.red, ".rl-tally__row--red"),
    row("Negro", tally.black, ".rl-tally__row--black"),
    row("Cero", tally.green, ".rl-tally__row--green"),
    row("Par", tally.even),
    row("Impar", tally.odd),
    row("1ª docena", tally.dozens[0]),
    row("2ª docena", tally.dozens[1]),
    row("3ª docena", tally.dozens[2]),
  ]);
}

function recordNumber(number) {
  tally.spins += 1;
  tally[colorOf(number)] += 1;
  if (number !== 0) {
    tally[number % 2 === 0 ? "even" : "odd"] += 1;
    tally.dozens[Math.ceil(number / 12) - 1] += 1;
  }
  renderTally();
}

/* --- Round ----------------------------------------------------------------- */

const banner = el("div.result.result--idle", { role: "status", "aria-live": "polite" },
  "Coloca tus fichas y gira la ruleta.");

const strip = historyStrip(15);

function setBusy(value) {
  busy = value;
  bet.setBusy(value, value ? "Girando…" : undefined);
  for (const button of [...modeButtons, undoButton, repeatButton, clearButton]) button.disabled = value;
  setMode(mode); // re-applies the disabled state to cells and zones
  if (!value) renderBets();
}

function clearMarks() {
  for (const node of tapete.querySelectorAll(".is-win")) node.classList.remove("is-win");
  for (const row of slipList.children) row.classList.remove("is-win");
}

function showOutcome({ number, color }, { payout, winning, stake }) {
  const paid = payout > 0;
  const net = payout - stake;

  // A round can pay something and still lose money on the table, so the wording
  // and the colour follow the net result, not the payout.
  const headline = net > 0
    ? `Ganas ${credits(payout)} · ${credits(net)} netos`
    : net === 0
      ? `Recuperas la apuesta · ${credits(stake)}`
      : paid
        ? `Recuperas ${credits(payout)} de ${credits(stake)} · −${credits(-net)}`
        : `Pierdes ${credits(stake)}`;

  replace(wheel.readout, [
    el(`span.rl-readout__number.rl-readout__number--${color}`, {}, String(number)),
    el("span.rl-readout__note", {}, paid
      ? `Devuelve ${credits(payout)} de ${credits(stake)} apostados`
      : `Sin premio · ${credits(stake)} apostados`),
  ]);

  banner.className = `result ${net > 0 ? "result--win" : net === 0 ? "result--idle" : "result--loss"}`;
  replace(banner, [
    el(`span.rl-badge.rl-badge--${color}`, {}, String(number)),
    el("span", {}, headline),
  ]);

  cells.get(number)?.classList.add("is-win");
  const winners = new Set(winning.map((w) => betKey({ type: w.type, selection: w.selection })));
  for (const key of winners) spots.get(key)?.classList.add("is-win");
  for (const row of slipList.children) {
    if (winners.has(row.dataset.key)) row.classList.add("is-win");
  }

  replace(slipPrize, [
    el("span.label", {}, "Premio de la ronda"),
    el(`span.rl-slip__amount${net > 0 ? ".text-win" : ""}`, {}, credits(payout)),
  ]);

  strip.push({ label: String(number), win: net > 0 });
  strip.root.firstElementChild?.setAttribute("data-color", color);
  recordNumber(number);
}

async function spinRound() {
  if (busy) return;

  const bets = currentBets();
  if (!bets.length) {
    toast("Coloca al menos una ficha en el tapete.", { variant: "warn" });
    return;
  }

  const stake = totalStake(bets);
  let hand;
  try {
    hand = openRound({ stake, game: "roulette" });
  } catch (err) {
    toast(err.name === "InsufficientFunds" ? "Saldo insuficiente para esa apuesta." : err.message, {
      variant: err instanceof LimitReached ? "warn" : "loss",
    });
    return;
  }

  setBusy(true);
  clearMarks();
  banner.className = "result result--idle";
  replace(banner, "La bola está girando…");

  try {
    // Decided here, before a single pixel moves.
    const outcome = spin(hand.round);
    const { payout, winning } = payoutFor(bets, outcome.number);

    await animateSpin(outcome.index);

    hand.settle(payout, {
      number: outcome.number,
      color: outcome.color,
      bets: bets.length,
      winners: winning.length,
    });
    previousBets = [...placed.values()].map((b) => ({ ...b }));
    showOutcome(outcome, { payout, winning, stake });

    if (payout > stake) {
      toast(`El ${outcome.number} paga ${credits(payout)}.`, { variant: "win" });
    }
  } catch (err) {
    // A crash mid-animation must not swallow the stake.
    hand.cancel("error");
    toast("La ronda ha fallado y se te ha devuelto la apuesta.", { variant: "loss" });
    throw err;
  } finally {
    setBusy(false);
  }
}

/* --- Controls -------------------------------------------------------------- */

const chipHint = el("span.field__hint", {},
  "Es el valor de cada ficha que colocas, no el total: el total es la suma del tapete.");

const bet = betControls({
  initial: 500,
  actionLabel: "Girar",
  extra: [chipHint],
  onAction: () => { void spinRound(); },
});

const chipValue = () => bet.stake;

const undoButton = el("button.btn.btn--ghost.btn--sm", {
  type: "button",
  onclick: undoChip,
  title: "Retirar la última ficha colocada",
}, "Deshacer");

const repeatButton = el("button.btn.btn--ghost.btn--sm", {
  type: "button",
  onclick: repeatBets,
  title: "Volver a colocar la apuesta de la ronda anterior",
}, "Repetir");

const clearButton = el("button.btn.btn--ghost.btn--sm", {
  type: "button",
  onclick: clearBets,
  title: "Retirar todas las fichas del tapete",
}, "Limpiar");

const toolbar = el("div.rl-toolbar", {}, [
  el("div.rl-modes", { role: "group", "aria-label": "Tipo de ficha" }, modeButtons),
  el("div.rl-actions", {}, [undoButton, repeatButton, clearButton]),
]);

/* --- Paytable -------------------------------------------------------------- */

function paytable() {
  const rows = Object.values(BET_TYPES).map((type) =>
    el("tr", {}, [
      el("td", {}, type.label),
      el("td.num.mono", {}, String(type.size)),
      el("td.num.mono", {}, `${type.payout}:1`),
      el("td.num.mono", {}, percent((type.size * (type.payout + 1)) / 37, { decimals: 3 })),
    ])
  );

  return el("details.rl-paytable", {}, [
    el("summary", {}, ["Pagos y RTP", icon("chevronDown", { size: 18 })]),
    el("div.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
      el("div.table-wrap", {}, [
        el("table.table", {}, [
          el("thead", {}, [el("tr", {}, [
            el("th", {}, "Apuesta"),
            el("th.num", {}, "Números"),
            el("th.num", {}, "Paga"),
            el("th.num", {}, "RTP"),
          ])]),
          el("tbody", {}, rows),
        ]),
      ]),
      el("p.text-xs.muted", {}, [
        "Los pagos son «a 1»: un pleno acertado devuelve la ficha más 35. Como cada apuesta cubre ",
        el("b", {}, "n"), " números y paga ", el("b", {}, "36/n − 1"), " a 1, el retorno es siempre ",
        `36/37 = ${percent(THEORETICAL_RTP, { decimals: 3 })}`,
        ". La ventaja de la casa es exactamente el cero: ",
        percent(1 - THEORETICAL_RTP, { decimals: 3 }),
        ". No aplicamos «en prisión» ni «la partage».",
      ]),
    ]),
  ]);
}

/* --- Mount ----------------------------------------------------------------- */

mountShell({ active: "roulette" });

const stage = el("section.stage.stage--felt.rl-stage", {}, [
  el("div.rl-top", {}, [wheel.root, banner]),
  toolbar,
  modeHint,
  el("div.scroll-x.rl-table-scroll", {}, [tapete]),
]);

const slip = el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
  el("div.row.row--between", {}, [
    el("span.label", {}, "Total apostado"),
    slipTotal,
  ]),
  slipList,
  el("hr.divider"),
  slipPrize,
]);

const tallyPanel = el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
  el("span.label", {}, "Números de la sesión"),
  tallyBody,
  el("p.text-xs.subtle", {}, [
    "Cada giro es independiente: estos recuentos cuentan lo que ya ha salido y ",
    el("b", {}, "no"),
    " dicen nada sobre el siguiente número.",
  ]),
]);

append($("#roulette"), [
  el("div.game-layout", {}, [
    stage,
    el("aside.game-controls", {}, [bet.root, slip, statsPanel().root]),
  ]),
  el("div.rl-below", {}, [
    el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
      el("span.label", {}, "Últimos 15 números"),
      strip.root,
      el("span.field__hint", {}, "Verde el cero, rojo y negro según la casilla."),
    ]),
    tallyPanel,
  ]),
  paytable(),
  playMoneyNote(),
]);

setMode("straight");
renderBets();
renderTally();
// Park the ball on the zero so the wheel is never empty before the first spin.
placeBall(0, R_BALL_REST);
