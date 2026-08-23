/**
 * Minas — DOM controller.
 *
 * All the maths lives in ../games/mines.js; this file owns the 25 flip tiles,
 * keeps the live panel honest between clicks, and drives the multi-stage bet
 * through `openRound()` — stake debited when the board opens, settled either by
 * a mine or by the cash-out button.
 *
 * Two invariants the UI exists to make visible:
 *   · the layout is fixed before the first click (the provenance line says so
 *     while the round is live, and proves it by listing the mines afterwards);
 *   · cashing out is only offered once something has actually been risked,
 *     because `multiplierFor(m, 0)` is 1 and paying the edge on it would be a
 *     guaranteed 1 % loss for pressing a button.
 */

import { el, $, append, replace, toast, wait, delegate } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { credits, percent } from "../../../assets/js/format.js";
import {
  mountShell, betControls, historyStrip, statsPanel, playMoneyNote,
} from "./shell.js";
import { openRound, LimitReached } from "../core/context.js";
import {
  createBoard, reveal, cashOut, randomHiddenTile, isHidden, hiddenTiles,
  multiplierFor, nextMultiplier, winChanceOfNext, maxMultiplier, payoutFor,
  positionOf, GRID, MIN_MINES, MAX_MINES, HOUSE_EDGE, THEORETICAL_RTP, STATUS,
} from "../games/mines.js";

/* --- Formatting ------------------------------------------------------------ */

/**
 * Multipliers in Spanish notation. `format.js` has `multiplier()`, but it builds
 * its string with `toFixed`, which prints an English decimal point — unusable
 * next to `credits()` and `percent()`, which are es-ES.
 */
const decimalFormat = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const bigFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
/** Clearing a 12-mine board pays over five million ×; decimals there are noise. */
const times = (value) =>
  `${value >= 10_000 ? bigFormat.format(value) : decimalFormat.format(value)}×`;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Flip duration (mirrors --dur-slow) and the gap between tiles in a cascade. */
const FLIP_MS = 420;
const STAGGER_MS = 24;

/* --- State ----------------------------------------------------------------- */

let mineCount = 3;
/** @type {{hand: object, stake: number, state: import('../games/mines.js').MinesState}|null} */
let session = null;
/** True while the end-of-round cascade plays, so nothing else can be clicked. */
let busy = false;

/* --- Tiles ----------------------------------------------------------------- */

/** Gem for a safe tile, mine for a fatal one. Filled sparkle reads as a gem. */
const faceIcon = (kind) =>
  kind === "mine" ? icon("mine", { size: 24 }) : icon("sparkle", { size: 24, fill: true });

function buildTile(index) {
  const { row, col } = positionOf(index);
  const back = el("span.mines-tile__face.mines-tile__face--back");
  const root = el("button.mines-tile", {
    type: "button",
    disabled: true,
    "aria-label": `Casilla fila ${row}, columna ${col}`,
  }, [
    // The faces are decoration: the button's aria-label carries the state, so
    // a screen reader hears "gema" instead of an unlabelled graphic.
    el("span.mines-tile__inner", { "aria-hidden": "true" }, [
      el("span.mines-tile__face.mines-tile__face--front", {}, "?"),
      back,
    ]),
  ]);
  root.dataset.index = String(index);
  return { root, back, index, row, col };
}

const tiles = Array.from({ length: GRID }, (_, i) => buildTile(i));

const grid = el("div.mines-grid", {
  role: "group",
  "aria-label": "Tablero de minas de 5 por 5",
}, tiles.map((t) => t.root));

/**
 * Flip one tile face up.
 * @param {number} index
 * @param {"gem"|"mine"} kind
 * @param {{delay?: number, boom?: boolean, ghost?: boolean}} [opts]
 *   `boom` marks the mine the player actually hit; `ghost` dims the tiles
 *   uncovered by the end-of-round sweep, which the player never chose.
 */
function paintTile(index, kind, { delay = 0, boom = false, ghost = false } = {}) {
  const tile = tiles[index];
  replace(tile.back, [faceIcon(kind)]);
  tile.root.style.setProperty("--flip-delay", `${delay}ms`);
  tile.root.classList.add("is-revealed", kind === "mine" ? "mines-tile--mine" : "mines-tile--gem");
  if (boom) tile.root.classList.add("mines-tile--boom");
  if (ghost) tile.root.classList.add("mines-tile--ghost");
  tile.root.disabled = true;
  tile.root.setAttribute(
    "aria-label",
    `Casilla fila ${tile.row}, columna ${tile.col}: ${kind === "mine" ? "mina" : "gema"}`
  );
}

function resetBoard() {
  for (const tile of tiles) {
    tile.root.className = "mines-tile";
    tile.root.style.removeProperty("--flip-delay");
    tile.root.disabled = true;
    tile.root.setAttribute("aria-label", `Casilla fila ${tile.row}, columna ${tile.col}`);
    tile.back.replaceChildren();
  }
}

/** Only face-down tiles of a live round are clickable. */
function setTilesEnabled(enabled) {
  for (const tile of tiles) {
    tile.root.disabled =
      !enabled || !session || session.state.status !== STATUS.PLAYING || !isHidden(session.state, tile.index);
  }
}

/**
 * Uncover everything still face down — the transparency step. After a loss the
 * player gets to see where the other mines were; after a cash-out, what they
 * walked away from.
 */
async function revealAll(state) {
  const rest = hiddenTiles(state);
  rest.forEach((index, n) => {
    paintTile(index, state.mines.includes(index) ? "mine" : "gem", {
      delay: reducedMotion() ? 0 : n * STAGGER_MS,
      ghost: true,
    });
  });
  await wait(reducedMotion() ? 0 : FLIP_MS + rest.length * STAGGER_MS);
}

/* --- Live panel ------------------------------------------------------------ */

const figures = {
  multiplier: el("div.stat__value.is-live", {}, times(1)),
  cashout: el("div.stat__value", {}, "—"),
  cashoutNote: el("div.mines-live__note", {}, "aún no hay nada que cobrar"),
  next: el("div.stat__value", {}, "—"),
  nextNote: el("div.mines-live__note", {}, "—"),
};

const liveStat = (label, value, note) =>
  el("div.stat", {}, [el("div.stat__label", {}, label), value, note]);

const banner = el("div.result.result--idle", { role: "status", "aria-live": "polite" },
  "Elige cuántas minas quieres y pulsa Jugar.");

const cashButton = el("button.btn.btn--lg.btn--block.mines-cashout", {
  type: "button",
  disabled: true,
  title: "Cobrar la apuesta multiplicada y cerrar la ronda",
  onclick: () => { void finishRound({ cashed: true }); },
}, "Retirar");

const randomButton = el("button.btn.btn--ghost.btn--lg.mines-random", {
  type: "button",
  disabled: true,
  title: "Destapar una casilla al azar, elegida con el propio azar de la ronda",
  onclick: () => { void randomPick(); },
}, [icon("refresh", { size: 18 }), "Aleatoria"]);

const provenance = el("div.mines-provenance", {}, [
  el("span", {}, "Las minas se colocan al abrir la ronda, antes de tu primer clic. Nada de lo que pulses las mueve."),
]);

/**
 * Push the whole live panel from the current state. Called after every reveal,
 * every mine-count change and every stake edit, so the "si te retiras" figure
 * is never a stale promise.
 */
function syncLive() {
  const playing = session?.state.status === STATUS.PLAYING;
  const revealed = session ? session.state.revealed.length : 0;
  const stake = session ? session.stake : bet.stake;

  // The state's own multiplier, not a recomputation: it is 0 once a mine has
  // been hit, so the panel drops to 0,00× on the spot instead of still showing
  // what the board was worth a click ago while the cascade plays.
  figures.multiplier.textContent = times(session ? session.state.multiplier : 1);

  if (playing && revealed > 0) {
    const payout = payoutFor(stake, mineCount, revealed);
    figures.cashout.textContent = credits(payout);
    figures.cashoutNote.textContent = `beneficio ${credits(payout - stake)}`;
    cashButton.disabled = busy;
    cashButton.textContent = `Retirar ${credits(payout)}`;
  } else {
    figures.cashout.textContent = "—";
    figures.cashoutNote.textContent = playing
      ? "destapa una casilla para poder retirarte"
      : "aún no hay nada que cobrar";
    cashButton.disabled = true;
    cashButton.textContent = "Retirar";
  }

  const next = nextMultiplier(mineCount, revealed);
  const chance = winChanceOfNext(mineCount, revealed);
  figures.next.textContent = next == null ? "—" : times(next);
  figures.nextNote.textContent = next == null
    ? "no quedan casillas seguras"
    : `${percent(chance, { decimals: 1 })} de acertar`;
}

/* --- Mine picker ----------------------------------------------------------- */

const mineSelect = el("select.select", {
  "aria-label": "Número de minas en el tablero, entre 1 y 24",
}, Array.from({ length: MAX_MINES - MIN_MINES + 1 }, (_, i) => {
  const value = MIN_MINES + i;
  return el("option", { value: String(value), selected: value === mineCount },
    value === 1 ? "1 mina" : `${value} minas`);
}));

const pickerHint = el("p.mines-picker__hint");

const presetChips = el("div.chip-row", {}, [1, 3, 5, 10, 24].map((value) =>
  el("button.chip-btn", {
    type: "button",
    title: `Jugar con ${value === 1 ? "1 mina" : `${value} minas`}`,
    onclick: () => setMineCount(value),
  }, String(value))
));

/** The consequences of the choice, spelled out before the money moves. */
function renderPickerHint() {
  const safeTiles = GRID - mineCount;
  replace(pickerHint, [
    "Primer acierto: ",
    el("b", {}, times(multiplierFor(mineCount, 1))),
    ` con ${percent(winChanceOfNext(mineCount, 0), { decimals: 1 })} de probabilidad. `,
    // With 24 mines there is exactly one safe tile, and "las 1 seguras" reads
    // like a bug even though the number is right.
    safeTiles === 1 ? "Destapar la única segura paga " : `Destapar las ${safeTiles} seguras paga `,
    el("b", {}, times(maxMultiplier(mineCount))),
    ".",
  ]);
}

function setMineCount(value) {
  if (session) return; // the layout of a live round cannot change under the player
  mineCount = Math.min(MAX_MINES, Math.max(MIN_MINES, Math.round(value)));
  mineSelect.value = String(mineCount);
  renderPickerHint();
  syncLive();
}

mineSelect.addEventListener("change", () => setMineCount(Number(mineSelect.value)));

/** Lock the picker while a board is live. */
function setPickerEnabled(enabled) {
  mineSelect.disabled = !enabled;
  for (const chip of presetChips.querySelectorAll(".chip-btn")) chip.disabled = !enabled;
}

const picker = el("div.mines-picker", {}, [
  el("span.label", {}, "Minas"),
  mineSelect,
  presetChips,
  pickerHint,
]);

/* --- Page furniture -------------------------------------------------------- */

mountShell({ active: "mines" });

const bet = betControls({
  initial: 1000,
  actionLabel: "Jugar",
  extra: [picker],
  onAction: (stake) => { void startRound(stake); },
});

const history = historyStrip();
const stats = statsPanel();

// Chips and ½ / ×2 / Máx mutate the stake without firing an input event, so the
// live figures are refreshed on any interaction inside the widget as well.
bet.input.addEventListener("input", () => syncLive());
bet.root.addEventListener("click", () => syncLive());

/* --- Round flow ------------------------------------------------------------ */

/**
 * Open a board. `openRound()` debits the stake here; from this point the round
 * can only end by hitting a mine or by cashing out.
 */
function startRound(stake) {
  if (session || busy) return;

  let hand;
  try {
    hand = openRound({ stake, game: "mines" });
  } catch (err) {
    toast(
      err.name === "InsufficientFunds" ? "Saldo insuficiente para esa apuesta." : err.message,
      { variant: err instanceof LimitReached ? "warn" : "loss" }
    );
    return;
  }

  resetBoard();
  session = { hand, stake, state: createBoard(hand.round, { mineCount }) };

  bet.setBusy(true, "Ronda en curso…");
  setPickerEnabled(false);
  setTilesEnabled(true);
  randomButton.disabled = false;

  banner.className = "result result--idle";
  banner.textContent = `${mineCount === 1 ? "1 mina" : `${mineCount} minas`} escondidas. Destapa tu primera casilla.`;
  replace(provenance, [
    el("span", {}, `Ronda #${hand.nonce}: las minas ya están colocadas. Nada de lo que pulses las mueve.`),
  ]);

  syncLive();
}

/** One tile click, from the board or from the random button. */
async function openTile(index) {
  if (!session || busy || session.state.status !== STATUS.PLAYING) return;
  if (!isHidden(session.state, index)) return;

  session.state = reveal(session.state, index);
  const lost = session.state.status === STATUS.LOST;
  paintTile(index, lost ? "mine" : "gem", { boom: lost });

  if (lost) {
    await finishRound({ cashed: false });
    return;
  }

  setTilesEnabled(true);
  syncLive();

  const k = session.state.revealed.length;
  banner.className = "result result--idle";
  banner.textContent = `${k} ${k === 1 ? "acierto" : "aciertos"} · ${times(multiplierFor(mineCount, k))} · sigue o retírate.`;

  // `reveal()` cashes a cleared board by itself: there is nothing left to risk.
  if (session.state.cleared) await finishRound({ cashed: true });
}

/** Uncover a face-down tile chosen from the round's own stream. */
async function randomPick() {
  if (!session || busy || session.state.status !== STATUS.PLAYING) return;
  const index = randomHiddenTile(session.state);
  if (index != null) await openTile(index);
}

/**
 * Settle and present the end of a round.
 * @param {{cashed: boolean}} outcome
 */
async function finishRound({ cashed }) {
  if (!session || busy) return;
  busy = true;
  setTilesEnabled(false);
  randomButton.disabled = true;
  cashButton.disabled = true;

  const { hand, stake } = session;
  // A voluntary cash-out still has to pass through the state machine, which is
  // what refuses a cash-out with nothing opened.
  if (cashed && session.state.status === STATUS.PLAYING) session.state = cashOut(session.state);
  const state = session.state;
  const k = state.revealed.length;
  const mult = cashed ? multiplierFor(mineCount, k) : 0;
  const payout = cashed ? payoutFor(stake, mineCount, k) : 0;

  hand.settle(payout, {
    mineCount,
    revealed: k,
    mines: state.mines,
    hitMine: state.hitMine,
    multiplier: mult,
    cleared: state.cleared,
  });
  syncLive();

  if (cashed) {
    banner.className = "result result--win";
    banner.textContent = state.cleared
      ? `¡Tablero limpio! ${times(mult)} · ganas ${credits(payout - stake)}`
      : `Te retiras en ${times(mult)} · ganas ${credits(payout - stake)}`;
    history.push({ label: times(mult), win: true });
    toast(`Retirada cobrada: ${credits(payout)}.`, { variant: "win" });
  } else {
    banner.className = "result result--loss";
    banner.textContent = k === 0
      ? `Mina a la primera. Pierdes ${credits(stake)}.`
      : `Mina tras ${k} ${k === 1 ? "acierto" : "aciertos"}. Pierdes ${credits(stake)}.`;
    history.push({ label: `✗${k}`, win: false });
  }

  await revealAll(state);

  // The layout is only disclosed once it can no longer help anyone: the round
  // is settled, so listing the mines is transparency rather than a spoiler.
  // Tiles are numbered 1–25 for a human, not 0–24 like the indices.
  const positions = state.mines.map((i) => i + 1).join(", ");
  replace(provenance, [
    el("span", {}, `Ronda #${hand.nonce} · ${state.mines.length === 1 ? "la mina estaba" : "las minas estaban"} en `),
    el("b", {}, `${positions} de 25`),
    el("a", { href: "fairness.html" }, "Verificar esta ronda"),
  ]);

  session = null;
  busy = false;
  bet.setBusy(false);
  setPickerEnabled(true);
  syncLive();
}

delegate(grid, "click", ".mines-tile", (_ev, target) => {
  void openTile(Number(target.dataset.index));
});

/* --- Explainer ------------------------------------------------------------- */

const explainer = el("details.panel.mines-explain", {}, [
  el("summary", {}, ["Cómo se calcula el pago", icon("chevronDown", { size: 18 })]),
  el("div.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
    el("p", {}, [
      "Con ", el("code", {}, "m"), " minas, destapar ", el("code", {}, "k"),
      " casillas sin tocar ninguna tiene probabilidad ",
      el("code", {}, "C(25−m, k) ÷ C(25, k)"),
      ". El pago es su inverso menos la comisión: ",
      el("code", {}, `mult(k) = ${decimalFormat.format(1 - HOUSE_EDGE)} × C(25, k) ÷ C(25−m, k)`),
      ".",
    ]),
    el("p", {}, [
      "Multiplicador × probabilidad = ",
      el("code", {}, decimalFormat.format(THEORETICAL_RTP)),
      ` siempre, así que el RTP es del ${percent(THEORETICAL_RTP, { decimals: 0 })} con 1 mina o con 24, te retires pronto o tarde. Elegir muchas minas no compra un trato mejor, solo más volatilidad.`,
    ]),
    el("p", {}, [
      "La comisión se cobra una sola vez, en el primer acierto: a partir de ahí cada casilla multiplica por el inverso exacto de su probabilidad. Por eso ",
      el("code", {}, "mult(0)"), " vale ", el("code", {}, "1,00"),
      " y no ", el("code", {}, decimalFormat.format(1 - HOUSE_EDGE)),
      " — sin riesgo no hay ventaja que cobrar — y por eso el botón de retirada no se activa hasta el primer acierto.",
    ]),
  ]),
]);

/* --- Mount ----------------------------------------------------------------- */

append($("#mines"), [
  el("div.game-layout", {}, [
    el("section.stage.stage--mines", {}, [
      el("div.mines-board", {}, [
        grid,
        banner,
        el("div.mines-live", {}, [
          liveStat("Multiplicador", figures.multiplier, null),
          liveStat("Si te retiras", figures.cashout, figures.cashoutNote),
          liveStat("Siguiente acierto", figures.next, figures.nextNote),
        ]),
        el("div.mines-actions", {}, [cashButton, randomButton]),
        provenance,
      ]),
    ]),
    el("aside.game-controls", {}, [bet.root, explainer, stats.root]),
  ]),
  el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)", marginTop: "var(--space-5)" } }, [
    el("span.label", {}, "Últimas rondas"),
    history.root,
    el("span.field__hint", {}, "Verde: el multiplicador al que te retiraste. Rojo: cuántos aciertos llevabas cuando saltó la mina."),
  ]),
  playMoneyNote(),
]);

renderPickerHint();
syncLive();
