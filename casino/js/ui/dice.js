/**
 * Dados — DOM controller.
 *
 * All the maths lives in ../games/dice.js; this file turns a target into a
 * bicolour bar, keeps the three headline figures in sync while the player
 * drags, slides the result marker to where the number landed, and drives the
 * autoplay strategy engine.
 *
 * The bar, the handle and the marker all share one 0–100 coordinate space, so
 * the winning zone the player sees is literally the interval that pays.
 */

import { el, $, append, replace, toast, wait, tween, copyText } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { credits, percent, shortHash } from "../../../assets/js/format.js";
import {
  mountShell, betControls, historyStrip, statsPanel, playMoneyNote,
} from "./shell.js";
import { playRound, fairness, LimitReached, UNIT } from "../core/context.js";
import {
  resolve, winChance, multiplierFor, profitFor, normalizeTarget, conditionLabel,
  MIN_TARGET, MAX_TARGET, TARGET_STEP, FACES, HOUSE_EDGE, THEORETICAL_RTP,
  DIRECTION_LABELS, oppositeDirection,
} from "../games/dice.js";

/* --- Formatting ------------------------------------------------------------ */

/**
 * Plain decimals in Spanish notation. `format.js` has `multiplier()`, but it
 * builds its string with `toFixed`, which prints an English decimal point —
 * unusable next to `percent()` and `credits()`, which are es-ES.
 */
const decimalFormat = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = (value) => decimalFormat.format(value);
/** Same, but without forcing decimals on a round number: 99 stays "99". */
const loose = (value) => Number(value.toFixed(4)).toLocaleString("es-ES");
const times = (value) => `${num(value)}×`;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How long the marker takes to slide, and the pause between autoplay rounds. */
const SLIDE_MS = 520;
const AUTO_GAP_MS = 340;

/* --- State ----------------------------------------------------------------- */

let target = 50;
/** @type {"under"|"over"} */
let direction = "under";
let busy = false;
/** Last number shown by the marker, so the next roll counts up from it. */
let lastRoll = null;

/* --- Target bar ------------------------------------------------------------ */

function buildBar() {
  const value = el("div.dice-bar__value", {}, "—");
  const marker = el("div.dice-bar__marker.is-idle", {
    "aria-hidden": "true",
    "data-align": "center",
  }, [value, el("div.dice-bar__needle")]);

  const input = el("input.dice-bar__input", {
    type: "range",
    min: String(MIN_TARGET),
    max: String(MAX_TARGET),
    step: String(TARGET_STEP),
    value: String(target),
    "aria-label": `Objetivo del dado, entre ${num(MIN_TARGET)} y ${num(MAX_TARGET)}`,
  });
  // The slider is inset by exactly the unreachable margins, so its thumb spans
  // 2 %–98 % of the bar and coincides with the drawn handle at every value.
  input.style.left = `${MIN_TARGET}%`;
  input.style.right = `${100 - MAX_TARGET}%`;

  const knob = el("div.dice-bar__knob", { "aria-hidden": "true" }, [
    el("span.dice-bar__grip"), el("span.dice-bar__grip"), el("span.dice-bar__grip"),
  ]);

  const track = el("div.dice-bar__track", { "data-direction": direction }, [
    el("div.dice-bar__zones", { "aria-hidden": "true" }),
    knob,
    input,
  ]);

  // Focus lives on the invisible input, so the visible handle has to borrow it.
  input.addEventListener("focus", () => track.classList.add("is-focused"));
  input.addEventListener("blur", () => track.classList.remove("is-focused"));

  const scale = el("div.dice-bar__scale", { "aria-hidden": "true" },
    [0, 25, 50, 75, 100].map((tick) => {
      const node = el("span.dice-bar__tick", {}, String(tick));
      node.style.setProperty("--at", `${tick}%`);
      return node;
    })
  );

  const root = el("div.dice-bar", {}, [marker, track, scale]);

  return {
    root, track, input, marker, value,

    /** Move the split (and the handle) to `pct` on the 0–100 scale. */
    setSplit(pct) {
      root.style.setProperty("--split", `${pct}%`);
      track.dataset.direction = direction;
    },

    /** Slide the marker to a result and count the number up to it. */
    setRoll(rolled, win) {
      root.style.setProperty("--roll", `${rolled}%`);
      marker.className = `dice-bar__marker dice-bar__marker--${win ? "win" : "loss"}`;
      // Keep the bubble inside the stage near the ends; the needle stays exact.
      marker.dataset.align = rolled < 12 ? "start" : rolled > 88 ? "end" : "center";
      tween(lastRoll ?? rolled, rolled, reducedMotion() ? 0 : SLIDE_MS, (v) => {
        value.textContent = num(v);
      });
      lastRoll = rolled;
    },
  };
}

/* --- Live figures ---------------------------------------------------------- */

const figure = (label, node) => el("div.stat", {}, [el("div.stat__label", {}, label), node]);

const figures = {
  multiplier: el("div.stat__value", {}, "—"),
  chance: el("div.stat__value", {}, "—"),
  profit: el("div.stat__value.is-profit", {}, "—"),
};

/* --- Page furniture -------------------------------------------------------- */

mountShell({ active: "dice" });

const bar = buildBar();
const verdict = el("div.result.result--idle", { role: "status", "aria-live": "polite" },
  "Elige tu objetivo y tira.");
const condition = el("p.dice-condition");

const targetInput = el("input#dice-target.input", {
  type: "number",
  min: String(MIN_TARGET),
  max: String(MAX_TARGET),
  step: String(TARGET_STEP),
  value: target.toFixed(2),
  inputmode: "decimal",
  "aria-label": `Objetivo exacto, entre ${num(MIN_TARGET)} y ${num(MAX_TARGET)}`,
});

/*
   The label is a stable node that `sync()` writes into, never a subtree it
   replaces. Re-rendering a button's children is enough to lose the click that
   caused it: blurring the target field fires `change` on mousedown, and if the
   element under the pointer is detached before mouseup, no click is dispatched.
*/
const swapLabel = el("span");
const swapButton = el("button.btn.btn--ghost.dice-target__swap", {
  type: "button",
  onclick: () => {
    direction = oppositeDirection(direction);
    sync();
  },
}, [icon("refresh", { size: 16 }), swapLabel]);

const bet = betControls({
  initial: 1000,
  actionLabel: "Tirar",
  onAction: () => { void rollOnce(); },
});

const history = historyStrip();
const stats = statsPanel();

/* --- Fairness receipt ------------------------------------------------------ */

const receiptRow = el("div.dice-receipt__row");
const receiptMath = el("div.dice-receipt__math", {},
  "Aún no has tirado. Aquí verás el nonce, el compromiso y la cuenta exacta que convierte el número aleatorio de la ronda en tu resultado.");

/** The round's first float, printed with enough digits to be re-checked. */
const num0 = (value) => value.toFixed(8).replace(".", ",");

const receiptItem = (key, node) =>
  el("div.dice-receipt__item", {}, [el("span.dice-receipt__key", {}, key), node]);

const receipt = el("div.dice-receipt", {}, [
  receiptRow,
  receiptMath,
  el("a.dice-receipt__link", { href: "fairness.html" }, [
    "Verificar esta ronda en Justicia verificable",
    icon("external", { size: 14 }),
  ]),
]);

/**
 * Show the round's provenance next to the result. Dice is the game where this
 * is worth doing loudly: one float in, one number out, no shuffling in between,
 * so a player can redo the arithmetic on a calculator.
 */
function renderReceipt({ nonce, raw, rolled }) {
  const commitment = fairness.commitment;
  replace(receiptRow, [
    receiptItem("Nonce", el("span.dice-receipt__value", {}, `#${nonce}`)),
    receiptItem("Cliente", el("span.dice-receipt__value.truncate", {}, fairness.clientSeed)),
    receiptItem("Compromiso", el("span.dice-receipt__value", {}, shortHash(commitment))),
    el("button.btn.btn--ghost.btn--sm", {
      type: "button",
      title: "Copiar el compromiso de la ronda",
      "aria-label": "Copiar el compromiso de la ronda",
      onclick: async () => {
        toast((await copyText(commitment)) ? "Compromiso copiado." : "No se pudo copiar.", {
          variant: "info",
        });
      },
    }, [icon("copy", { size: 14 })]),
  ]);

  replace(receiptMath, [
    `piso(${num0(raw)} × ${FACES.toLocaleString("es-ES")}) ÷ 100 = `,
    el("b", {}, num(rolled)),
  ]);
}

/* --- Synchronisation ------------------------------------------------------- */

/**
 * Push the current target/direction/stake into every part of the screen.
 * Called on drag, on typing, on chip clicks and after each strategy step, so
 * the three headline figures can never drift from the bet that will be placed.
 *
 * @param {{fromField?: boolean}} [opts] skip rewriting the numeric field while
 *   the player is still typing in it, or "5" would become "5,00" mid-keystroke.
 */
function sync({ fromField = false } = {}) {
  const chance = winChance(target, direction);

  bar.setSplit(target);
  bar.input.value = String(target);
  bar.input.setAttribute("aria-valuetext", num(target));
  if (!fromField) targetInput.value = target.toFixed(2);

  figures.multiplier.textContent = times(multiplierFor(target, direction));
  figures.chance.textContent = percent(chance / 100, { decimals: 2 });
  figures.profit.textContent = credits(profitFor(bet.stake, target, direction));

  const other = oppositeDirection(direction);
  swapLabel.textContent = DIRECTION_LABELS[direction];
  swapButton.setAttribute(
    "aria-label",
    `Apuestas a ${DIRECTION_LABELS[direction].toLowerCase()}. Pulsa para apostar a ${DIRECTION_LABELS[other].toLowerCase()}.`
  );
  swapButton.title = `Cambiar a ${DIRECTION_LABELS[other].toLowerCase()}`;

  condition.textContent = `${conditionLabel(target, direction)} · paga ${times(multiplierFor(target, direction))}`;
}

bar.input.addEventListener("input", () => {
  target = normalizeTarget(bar.input.value);
  sync();
});

targetInput.addEventListener("input", () => {
  // A comma is what a Spanish keyboard produces; `type=number` hands back an
  // empty string for it, so fall back to the previous target instead of 2,00.
  const raw = String(targetInput.value).replace(",", ".");
  if (raw.trim() === "") return;
  target = normalizeTarget(raw);
  sync({ fromField: true });
});
targetInput.addEventListener("change", () => sync());

// Chips and ½ / ×2 / Máx mutate the stake without firing an input event, so the
// profit figure is refreshed on any click inside the widget as well.
bet.input.addEventListener("input", () => sync());
bet.root.addEventListener("click", () => sync());

/* --- Autoplay -------------------------------------------------------------- */

const autoCount = el("input.input", {
  type: "number", min: "0", step: "1", value: "25",
  "aria-label": "Número de tiradas automáticas (0 para no poner límite)",
});

const strategySelect = (label) => el("select.select", { "aria-label": label }, [
  el("option", { value: "keep" }, "Mantener apuesta"),
  el("option", { value: "increase" }, "Aumentar un %"),
  el("option", { value: "reset" }, "Volver a la base"),
]);

const onWin = strategySelect("Estrategia al ganar");
const onLoss = strategySelect("Estrategia al perder");

const pctInput = (label, value) => el("input.input", {
  type: "number", min: "1", max: "1000", step: "1", value,
  "aria-label": label,
});
const onWinPct = pctInput("Porcentaje de aumento al ganar", "50");
const onLossPct = pctInput("Porcentaje de aumento al perder", "100");

const onWinPctField = el("div.dice-auto__pct", { hidden: true }, [
  el("span.field__hint", {}, "Aumentar al ganar (%)"), onWinPct,
]);
const onLossPctField = el("div.dice-auto__pct", { hidden: true }, [
  el("span.field__hint", {}, "Aumentar al perder (%)"), onLossPct,
]);

// The percentage box only exists for the strategy that uses it.
const togglePct = () => {
  onWinPctField.hidden = onWin.value !== "increase";
  onLossPctField.hidden = onLoss.value !== "increase";
};
onWin.addEventListener("change", togglePct);
onLoss.addEventListener("change", togglePct);
togglePct();

const stopProfit = el("input.input", {
  type: "number", min: "0", step: "0.01", placeholder: "Sin límite",
  "aria-label": "Detener el modo automático si el beneficio acumulado supera este importe en créditos",
});
const stopLoss = el("input.input", {
  type: "number", min: "0", step: "0.01", placeholder: "Sin límite",
  "aria-label": "Detener el modo automático si la pérdida acumulada supera este importe en créditos",
});

const autoStatus = el("div.dice-auto__status", { role: "status", "aria-live": "polite" });

const startButton = el("button.btn.btn--block", {
  type: "button",
  onclick: () => { void runAuto(); },
}, "Iniciar automático");

const stopButton = el("button.btn.btn--ghost.btn--block", {
  type: "button",
  disabled: true,
  onclick: () => {
    if (!auto) return;
    auto.stop = true;
    autoStatus.textContent = "Se detendrá al terminar la tirada…";
  },
}, "Detener");

const autoPanel = el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
  el("span.label", {}, "Modo automático"),
  el("div.field", {}, [
    el("span.field__hint", {}, "Número de tiradas (0 = sin límite)"),
    autoCount,
  ]),
  el("div.dice-auto__rows", {}, [
    el("div.field", {}, [el("span.field__hint", {}, "Al ganar"), onWin, onWinPctField]),
    el("div.field", {}, [el("span.field__hint", {}, "Al perder"), onLoss, onLossPctField]),
  ]),
  el("div.dice-auto__grid", {}, [
    el("div.field", {}, [el("span.field__hint", {}, "Parar si gano (créditos)"), stopProfit]),
    el("div.field", {}, [el("span.field__hint", {}, "Parar si pierdo (créditos)"), stopLoss]),
  ]),
  startButton,
  stopButton,
  autoStatus,
]);

/** Read a credits field as minor units; 0 means "no limit". */
function limitOf(input) {
  const parsed = Math.round(Number(String(input.value).replace(",", ".")) * UNIT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Apply a betting strategy to the current stake.
 * @param {"keep"|"increase"|"reset"} mode
 * @param {number} current minor units
 * @param {number} base the stake the automatic run started from
 * @param {number} pct percentage increase, only used by "increase"
 */
function nextStake(mode, current, base, pct) {
  if (mode === "reset") return base;
  if (mode === "increase") return Math.round(current * (1 + Math.max(0, pct) / 100));
  return current;
}

/** @type {{left:number, base:number, net:number, stop:boolean}|null} */
let auto = null;

function setBusy(value) {
  busy = value;
  bet.setBusy(value, value ? "Tirando…" : undefined);
  startButton.disabled = value || auto != null;
  // The stop button is the one control that must never be out of reach while
  // an automatic run is in flight.
  stopButton.disabled = auto == null;
}

/**
 * Automatic run: a plain loop, because each round already awaits its own
 * animation. It ends when the batch runs out, when the player presses Detener,
 * when a profit/loss limit trips, or when a bet is refused.
 */
async function runAuto() {
  if (busy || auto) return;

  const requested = Math.max(0, Math.floor(Number(autoCount.value) || 0));
  const profitLimit = limitOf(stopProfit);
  const lossLimit = limitOf(stopLoss);
  auto = { left: requested === 0 ? Infinity : requested, base: bet.stake, net: 0, stop: false };
  setBusy(false);

  while (auto.left > 0 && !auto.stop) {
    autoStatus.textContent = `${Number.isFinite(auto.left) ? `Quedan ${auto.left} tiradas` : "Tiradas ilimitadas"} · resultado ${credits(auto.net)}`;

    const outcome = await rollOnce();
    if (!outcome) break;

    auto.left--;
    auto.net += outcome.net;

    const mode = outcome.win ? onWin.value : onLoss.value;
    const pct = Number(outcome.win ? onWinPct.value : onLossPct.value) || 0;
    bet.setStake(nextStake(mode, bet.stake, auto.base, pct));
    sync();

    if (profitLimit && auto.net >= profitLimit) {
      toast(`Automático detenido: llevas ${credits(auto.net)} de beneficio.`, { variant: "win" });
      break;
    }
    if (lossLimit && -auto.net >= lossLimit) {
      toast(`Automático detenido: llevas ${credits(-auto.net)} de pérdida.`, { variant: "warn" });
      break;
    }
    if (auto.left > 0 && !auto.stop) await wait(reducedMotion() ? 0 : AUTO_GAP_MS);
  }

  const summary = auto.net;
  auto = null;
  autoStatus.textContent = `Automático terminado · resultado ${credits(summary)}`;
  setBusy(false);
}

/* --- One roll -------------------------------------------------------------- */

/**
 * Place one bet and present it.
 * @returns {Promise<{win:boolean, net:number, payout:number}|null>} null if the
 *   bet was refused (no funds, responsible-play limit), which also stops autoplay.
 */
async function rollOnce() {
  if (busy) return null;

  const stake = bet.stake;
  const bettedTarget = target;
  const bettedDirection = direction;

  // The round is captured so the receipt can show the raw float it produced;
  // the resolver itself stays pure and reads nothing else.
  let stream = null;

  let outcome;
  try {
    outcome = playRound({
      stake,
      game: "dice",
      resolve: (round) => {
        stream = round;
        return resolve(round, { target: bettedTarget, direction: bettedDirection, stake });
      },
    });
  } catch (err) {
    const message = err.name === "InsufficientFunds"
      ? "Saldo insuficiente para esa apuesta."
      : err.message;
    toast(message, { variant: err instanceof LimitReached ? "warn" : "loss" });
    if (auto) auto.stop = true;
    return null;
  }

  setBusy(true);
  bar.setRoll(outcome.roll, outcome.win);
  renderReceipt({ nonce: outcome.nonce, raw: stream.at(0), rolled: outcome.roll });

  verdict.className = `result result--${outcome.win ? "win" : "loss"}`;
  verdict.textContent = outcome.win
    ? `¡Ganas ${credits(outcome.net)}! ${num(outcome.roll)} es ${bettedDirection === "under" ? "menor" : "mayor"} que ${num(bettedTarget)}`
    : `Pierdes ${credits(stake)}. ${num(outcome.roll)} no es ${bettedDirection === "under" ? "menor" : "mayor"} que ${num(bettedTarget)}`;

  history.push({ label: num(outcome.roll), win: outcome.win });

  await wait(reducedMotion() ? 0 : SLIDE_MS);
  if (!auto) setBusy(false);
  else busy = false;

  return outcome;
}

/* --- Explainer ------------------------------------------------------------- */

/** The pricing, written out. Dice is the game where the maths fits on screen. */
const explainer = el("details.panel.dice-explain", {}, [
  el("summary", {}, ["Cómo se calcula el pago", icon("chevronDown", { size: 18 })]),
  el("div.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
    el("p", {}, [
      "Cada ronda produce un número entre 0 y 1. Se multiplica por ",
      el("code", {}, FACES.toLocaleString("es-ES")),
      ", se trunca y se divide entre 100: sale uno de los 10 000 resultados posibles, de ",
      el("code", {}, "0,00"), " a ", el("code", {}, "99,99"), ", todos igual de probables.",
    ]),
    el("p", {}, [
      "El multiplicador es ",
      el("code", {}, `${loose(100 * (1 - HOUSE_EDGE))} ÷ probabilidad`),
      ", así que multiplicador × probabilidad = ",
      el("code", {}, loose(100 * THEORETICAL_RTP)),
      " siempre. El RTP es del ",
      percent(THEORETICAL_RTP, { decimals: 0 }),
      " exacto en cualquier objetivo: arriesgar más no sale ni mejor ni peor, solo más volátil.",
    ]),
    el("p", {}, [
      "Caer justo en el objetivo pierde en las dos direcciones, por eso ",
      el("code", {}, "menor"), " y ", el("code", {}, "mayor"),
      " suman 99,99 % y no 100 %.",
    ]),
  ]),
]);

/* --- Mount ----------------------------------------------------------------- */

append($("#dice"), [
  el("div.game-layout", {}, [
    el("section.stage.stage--dice", {}, [
      el("div.dice-board", {}, [
        bar.root,
        verdict,
        el("div.dice-figures", {}, [
          figure("Multiplicador", figures.multiplier),
          figure("Probabilidad", figures.chance),
          figure("Beneficio", figures.profit),
        ]),
        el("div.dice-target", {}, [
          el("div.field", {}, [
            el("label.label", { for: "dice-target" }, "Objetivo"),
            targetInput,
          ]),
          swapButton,
        ]),
        condition,
        receipt,
      ]),
    ]),
    el("aside.game-controls", {}, [bet.root, autoPanel, explainer, stats.root]),
  ]),
  el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)", marginTop: "var(--space-5)" } }, [
    el("span.label", {}, "Últimas tiradas"),
    history.root,
    el("span.field__hint", {}, "Cada ficha es el número que salió; verde si pagó."),
  ]),
  playMoneyNote(),
]);

sync();
