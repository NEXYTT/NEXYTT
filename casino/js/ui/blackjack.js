/**
 * Blackjack 21 — DOM controller.
 *
 * Every rule lives in ../games/blackjack.js. This file owns the table: it deals
 * card by card, keeps the hole card face down until the player is done, enables
 * exactly the buttons the state machine says are legal, and moves the money
 * through `openRound()`.
 *
 * One hand = one provably-fair round: the shoe is shuffled from that round's
 * stream, so a whole hand — including every hit and the dealer's draws — can be
 * replayed from the seed triple alone.
 */

import { el, $, append, toast, wait } from "../../../assets/js/dom.js";
import { credits } from "../../../assets/js/format.js";
import { handValue, SUIT_SYMBOL, SUIT_NAME, isRedSuit } from "../core/cards.js";
import { openRound, wallet, LimitReached } from "../core/context.js";
import {
  mountShell, betControls, historyStrip, statsPanel, playMoneyNote,
} from "./shell.js";
import {
  createGame, deal, hit, stand, double, split, surrender, insurance,
  dealerPlay, settlement, actions, actionCost, basicStrategy,
  DEALER_STANDS_ON, MAX_HANDS,
} from "../games/blackjack.js";

const DECKS = 6;

/* --- Timing --------------------------------------------------------------- */

/** Gap between two cards landing on the felt, and the hole-card flip. */
const DEAL_MS = 240;
const FLIP_MS = 420;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Every pause collapses to zero for players who asked for less motion. */
const pause = (ms) => wait(reducedMotion() ? 0 : ms);

/* --- Card faces ------------------------------------------------------------ */

const RANK_NAME = { A: "as", K: "rey", Q: "reina", J: "jota" };
const rankName = (rank) => RANK_NAME[rank] ?? rank;

function cardNode(card) {
  const face = `${card.rank}${SUIT_SYMBOL[card.suit]}`;
  const node = el(`div.playing-card${isRedSuit(card.suit) ? ".playing-card--red" : ""}`, {
    role: "img",
    "aria-label": `${rankName(card.rank)} de ${SUIT_NAME[card.suit]}`,
  }, [
    el("span.playing-card__corner", { "aria-hidden": "true" }, face),
    el("span.playing-card__pip", { "aria-hidden": "true" }, SUIT_SYMBOL[card.suit]),
    el("span.playing-card__corner.playing-card__corner--flip", { "aria-hidden": "true" }, face),
  ]);
  node.dataset.key = card.id;
  return node;
}

function backNode(key) {
  const node = el("div.playing-card.playing-card--back", {
    role: "img",
    "aria-label": "Carta tapada del crupier",
  });
  node.dataset.key = key;
  return node;
}

/**
 * Reconcile a row of cards against the DOM, keyed by card id.
 *
 * Only genuinely new cards get appended, which is what keeps the deal animation
 * honest: re-rendering the whole hand would replay it on every card each time
 * the player hits. A mismatch (the hole card turning over) drops that node and
 * everything after it so the flip animates too.
 */
function syncCards(container, cards, { hideIndex = -1 } = {}) {
  const keys = cards.map((card, i) => (i === hideIndex ? `back:${card.id}` : card.id));
  const nodes = [...container.children];
  const stale = nodes.findIndex((node, i) => node.dataset.key !== keys[i]);
  if (stale >= 0) for (const node of nodes.slice(stale)) node.remove();
  for (let i = container.children.length; i < keys.length; i++) {
    container.append(i === hideIndex ? backNode(keys[i]) : cardNode(cards[i]));
  }
}

/* --- Hand value readout ---------------------------------------------------- */

/**
 * The counter above each hand. "17 blando" is the useful case: it tells the
 * player the ace can still drop to 1, so the hand cannot bust on the next card.
 */
function valueBadge(node, cards, { natural = true, pending = false } = {}) {
  const value = handValue(cards);
  node.className = "bj-value";
  if (!cards.length) {
    node.textContent = "—";
    node.removeAttribute("title");
    return;
  }
  // A hand still waiting for a card — the dealer's hole card, or a split hand
  // that has not reached its turn — shows what is known plus an open question.
  if (pending) {
    node.textContent = `${value.total} + ?`;
    node.title = "Falta una carta por descubrir en esta mano.";
    return;
  }
  if (value.blackjack && natural) {
    node.classList.add("bj-value--blackjack");
    node.textContent = "Blackjack";
    node.title = "As más carta de diez con las dos primeras cartas: paga 3:2.";
  } else if (value.busted) {
    node.classList.add("bj-value--bust");
    node.textContent = `${value.total} · te pasas`;
    node.removeAttribute("title");
  } else if (value.soft) {
    node.classList.add("bj-value--soft");
    node.textContent = `${value.total} blando`;
    node.title = "Mano blanda: el as vale 11 y puede pasar a valer 1.";
  } else {
    node.textContent = String(value.total);
    node.removeAttribute("title");
  }
}

/* --- Table ----------------------------------------------------------------- */

const dealerCards = el("div.card-hand", { "aria-label": "Cartas del crupier" });
const dealerValue = el("span.bj-value", {}, "—");
const dealerNote = el("span.bj-seat__note", {}, `Se planta en ${DEALER_STANDS_ON}, incluso blando`);

const handsRow = el("div.bj-hands", { "aria-label": "Tus manos" });
const bannerText = el("span", {}, "Elige tu apuesta y reparte.");
const bannerDetail = el("span.bj-banner__detail", {}, `${DECKS} barajas · el blackjack paga 3:2`);
const banner = el("div.result.result--idle.bj-banner", { role: "status", "aria-live": "polite" }, [
  el("span", {}, [bannerText, bannerDetail]),
]);

const table = el("section.stage.stage--felt.bj-table", {}, [
  el("div.bj-seat.bj-seat--dealer", {}, [
    el("div.bj-seat__head", {}, [
      el("span.bj-seat__title", {}, "Crupier"),
      dealerValue,
      dealerNote,
    ]),
    dealerCards,
  ]),
  banner,
  el("div.bj-seat.bj-seat--player", {}, [
    el("div.bj-seat__head", {}, [
      el("span.bj-seat__title", {}, "Tu mano"),
      el("span.bj-seat__note", {}, `Divide hasta ${MAX_HANDS} manos`),
    ]),
    handsRow,
  ]),
]);

/** Build (or reuse) the container for player hand `index`. */
function handSlot(index) {
  let node = handsRow.children[index];
  if (!node) {
    node = el("div.bj-hand", {}, [
      el("div.bj-hand__head", {}, [
        el("span.bj-hand__label", {}, `Mano ${index + 1}`),
        el("span.bj-value", {}, "—"),
      ]),
      el("div.card-hand"),
      el("div.bj-hand__foot", {}, [el("span.bj-hand__stake", {}, "")]),
    ]);
    handsRow.append(node);
  }
  return {
    root: node,
    label: node.querySelector(".bj-hand__label"),
    value: node.querySelector(".bj-value"),
    cards: node.querySelector(".card-hand"),
    foot: node.querySelector(".bj-hand__foot"),
    stake: node.querySelector(".bj-hand__stake"),
  };
}

const RESULT_BADGE = {
  win: ["badge badge--win", "Ganada"],
  blackjack: ["badge badge--accent", "Blackjack"],
  push: ["badge", "Empate"],
  lose: ["badge badge--loss", "Perdida"],
};

/**
 * Paint the whole table from the state.
 *
 * `dealerLimit` / `playerLimit` cap how many cards are shown, which is how the
 * opening deal and the dealer's draws are animated: same render, more cards.
 */
function renderTable({ dealerLimit = Infinity, playerLimit = Infinity, results = null } = {}) {
  if (!state) return;

  const shownDealer = state.dealer.cards.slice(0, dealerLimit);
  // The hole card only turns over in `dealerPlay`; until then it is a back.
  const hideHole = !state.revealed && shownDealer.length > 1 ? 1 : -1;
  syncCards(dealerCards, shownDealer, { hideIndex: hideHole });

  if (hideHole >= 0) {
    // Only the upcard counts towards the visible total while the hole card is down.
    valueBadge(dealerValue, shownDealer.slice(0, 1), { pending: true });
    dealerValue.title = "La carta tapada no se revela hasta que terminas tu mano.";
  } else {
    valueBadge(dealerValue, shownDealer);
  }
  dealerNote.hidden = state.revealed;

  handsRow.classList.toggle("bj-hands--multi", state.hands.length > 1);
  while (handsRow.children.length > state.hands.length) handsRow.lastElementChild.remove();

  state.hands.forEach((hand, index) => {
    const slot = handSlot(index);
    const shown = hand.cards.slice(0, playerLimit);
    syncCards(slot.cards, shown);
    slot.label.textContent = state.hands.length > 1 ? `Mano ${index + 1}` : "Tu mano";
    // A 21 built on a split hand is never a natural, so it must not be labelled one.
    valueBadge(slot.value, shown, {
      natural: !hand.fromSplit,
      pending: shown.length === 1,
    });

    const active = state.phase === "player" && state.active === index && !hand.done;
    slot.root.classList.toggle("is-active", active);
    slot.root.classList.toggle("is-settled", Boolean(results));
    slot.root.setAttribute("aria-current", active ? "true" : "false");

    const tags = [`${credits(hand.stake)} apostado`];
    if (hand.doubled) tags.push("doblada");
    if (hand.surrendered) tags.push("rendida");
    slot.stake.textContent = tags.join(" · ");

    // Result badges only exist once the hand is settled.
    const badge = slot.foot.querySelector(".badge");
    if (badge) badge.remove();
    const row = results?.perHand[index];
    if (row) {
      const [cls, label] = RESULT_BADGE[row.result];
      slot.foot.append(el(`span.${cls.split(" ").join(".")}`, {}, row.surrendered ? "Rendida" : label));
    }
  });
}

function setBanner(text, detail, tone = "idle") {
  banner.className = `result bj-banner result--${tone}`;
  bannerText.textContent = text;
  bannerDetail.textContent = detail;
}

/* --- Controls -------------------------------------------------------------- */

const actionButton = (label, hint, onclick) =>
  el("button.btn.btn--ghost", { onclick, title: hint, disabled: true }, label);

const buttons = {
  hit: actionButton("Pedir carta", "Recibe una carta más", () => act(hit)),
  stand: actionButton("Plantarse", "Cierra la mano con el total actual", () => act(stand)),
  double: actionButton("Doblar", "Dobla la apuesta y recibe una única carta", () => act(double, "double")),
  split: actionButton("Dividir", "Separa la pareja en dos manos", () => act(split, "split")),
  surrender: actionButton("Rendirse", "Abandona la mano y recupera la mitad", () => act(surrender)),
};
buttons.hit.classList.replace("btn--ghost", "btn--primary");

const insuranceBox = el("div.bj-insurance", { hidden: true }, [
  el("span", {}, "El crupier enseña un As. El seguro cuesta la mitad de tu apuesta y paga 2:1 si tiene blackjack."),
  el("div.bj-insurance__row", {}, [
    el("button.btn.btn--sm", {
      onclick: () => decideInsurance(true),
      title: "Contratar el seguro",
    }, "Asegurar"),
    el("button.btn.btn--ghost.btn--sm", {
      onclick: () => decideInsurance(false),
      title: "Jugar sin seguro",
    }, "No, gracias"),
  ]),
]);

const hintButton = el("button.btn.btn--ghost.btn--sm.btn--block", {
  onclick: showHint,
  title: "Consultar la estrategia básica para esta situación",
}, "Sugerencia de estrategia básica");

const actionsPanel = el("div.panel.stack.bj-panel--play", { style: { "--stack-gap": "var(--space-3)" } }, [
  el("span.label", {}, "Tu turno"),
  insuranceBox,
  el("div.bj-actions", {}, [
    buttons.hit,
    buttons.stand,
    buttons.double,
    buttons.split,
    buttons.surrender,
  ]),
  hintButton,
]);
// Surrender ends the round, so it gets its own full-width row away from the rest.
buttons.surrender.classList.add("btn--wide");

/** Enable exactly what the state machine allows, and nothing else. */
function updateActions() {
  const legal = state && !busy
    ? actions(state)
    : { canHit: false, canStand: false, canDouble: false, canSplit: false, canSurrender: false, canInsure: false };

  // Extra stakes also need funds in the wallet, or the button would fail on click.
  const affordable = (kind) => state != null && wallet.canAfford(actionCost(state, kind));

  buttons.hit.disabled = !legal.canHit;
  buttons.stand.disabled = !legal.canStand;
  buttons.double.disabled = !legal.canDouble || !affordable("double");
  buttons.split.disabled = !legal.canSplit || !affordable("split");
  buttons.surrender.disabled = !legal.canSurrender;

  insuranceBox.hidden = !legal.canInsure;
  if (legal.canInsure) {
    const cost = actionCost(state, "insurance");
    insuranceBox.querySelector(".btn").disabled = !wallet.canAfford(cost);
    insuranceBox.querySelector(".btn").textContent = `Asegurar (${credits(cost)})`;
  }
  hintButton.disabled = !state || busy || (state.phase !== "player" && state.phase !== "insurance");

  for (const node of [...Object.values(buttons), ...insuranceBox.querySelectorAll(".btn")]) {
    node.classList.remove("is-suggested");
  }
}

/* --- Hint ------------------------------------------------------------------ */

const SUGGESTION_TARGET = {
  hit: () => buttons.hit,
  stand: () => buttons.stand,
  double: () => buttons.double,
  split: () => buttons.split,
  surrender: () => buttons.surrender,
  decline: () => insuranceBox.querySelectorAll(".btn")[1],
};

function showHint() {
  const advice = state ? basicStrategy(state) : null;
  if (!advice) {
    toast("La sugerencia solo está disponible cuando te toca decidir.", { variant: "info" });
    return;
  }

  let context = "Con un As a la vista, el seguro pierde dinero a largo plazo";
  if (state.phase === "player") {
    const hand = state.hands[state.active];
    const value = handValue(hand.cards);
    const up = state.dealer.cards[0];
    context = `${value.total}${value.soft ? " blando" : " duro"} contra ${up.rank === "A" ? "un As" : up.rank} del crupier`;
  }

  toast(`${context}: ${advice.label.toLowerCase()}.`, {
    title: "Estrategia básica",
    variant: "info",
    timeout: 6000,
  });

  const target = SUGGESTION_TARGET[advice.action]?.();
  if (target && !target.disabled) target.classList.add("is-suggested");
}

/* --- Hand flow -------------------------------------------------------------- */

/** @type {ReturnType<typeof deal>|null} */
let state = null;
/** @type {ReturnType<typeof openRound>|null} */
let handle = null;
let busy = false;

const inProgress = () => Boolean(handle);

/**
 * Commit an extra stake (double, split, insurance) before applying the move.
 * @returns {boolean} false when the wallet cannot cover it
 */
function commitExtra(kind) {
  const cost = actionCost(state, kind);
  if (!wallet.canAfford(cost)) {
    toast(`Necesitas ${credits(cost)} más de saldo para eso.`, { variant: "warn" });
    return false;
  }
  handle.addStake(cost);
  return true;
}

/**
 * Apply one player action.
 * @param {(state:any)=>any} apply pure transition from the rules module
 * @param {'double'|'split'} [costKey] extra stake this move commits
 */
async function act(apply, costKey) {
  if (!state || busy || state.phase !== "player") return;
  if (costKey && !commitExtra(costKey)) return;

  busy = true;
  updateActions();
  try {
    state = apply(state);
  } catch (err) {
    busy = false;
    abandon(err);
    return;
  }

  renderTable();
  await pause(DEAL_MS);

  if (state.phase === "dealer") await finish();
  else {
    busy = false;
    updateActions();
  }
}

async function decideInsurance(take) {
  if (!state || busy || state.phase !== "insurance") return;
  if (take && !commitExtra("insurance")) return;

  busy = true;
  updateActions();
  state = insurance(state, take);
  if (take) setBanner("Seguro contratado", "Paga 2:1 solo si el crupier tiene blackjack.", "idle");
  renderTable();
  await pause(DEAL_MS);

  if (state.phase === "dealer") await finish();
  else {
    busy = false;
    updateActions();
  }
}

/** Turn the hole card over, play the dealer out, pay the hand. */
async function finish() {
  const played = dealerPlay(state);
  state = played;

  // The flip first, then one card at a time — the dealer's draw is the tensest
  // part of the hand and deserves the same rhythm as the deal.
  renderTable({ dealerLimit: 2 });
  await pause(FLIP_MS);
  for (let shown = 3; shown <= played.dealer.cards.length; shown++) {
    renderTable({ dealerLimit: shown });
    await pause(DEAL_MS);
  }

  const result = settlement(state);
  try {
    handle.settle(result.payout, {
      hands: result.perHand.map((h) => ({ result: h.result, stake: h.stake, payout: h.payout })),
      dealerTotal: result.dealerTotal,
      dealerBlackjack: result.dealerBlackjack,
      insurance: result.insurance.taken ? result.insurance : undefined,
      wagered: result.wagered,
      decks: DECKS,
    });
  } catch (err) {
    abandon(err);
    return;
  }

  renderTable({ results: result });
  announce(result);

  handle = null;
  busy = false;
  bet.setBusy(false);
  updateActions();
}

/** Something went wrong mid-hand: give the money back rather than eat it. */
function abandon(err) {
  handle?.cancel("error");
  handle = null;
  busy = false;
  bet.setBusy(false);
  updateActions();
  setBanner("La mano se ha cancelado", "Se te ha devuelto todo lo apostado.", "loss");
  toast("La mano ha fallado y se te ha devuelto la apuesta.", { variant: "loss" });
  console.error(err);
}

/** Banner + history strip for a settled hand. */
function announce(result) {
  const net = result.payout - result.wagered;
  const tone = net > 0 ? "win" : net < 0 ? "loss" : "idle";

  const wins = result.perHand.filter((h) => h.result === "win" || h.result === "blackjack").length;
  const pushes = result.perHand.filter((h) => h.result === "push").length;
  const total = result.perHand.length;

  let headline;
  if (total === 1) {
    const only = result.perHand[0];
    if (only.surrendered) headline = "Te has rendido";
    else if (only.result === "blackjack") headline = "¡Blackjack!";
    else if (only.busted) headline = "Te has pasado";
    else if (only.result === "win") headline = "Ganas la mano";
    else if (only.result === "push") headline = "Empate";
    else headline = "Gana el crupier";
  } else {
    headline = `${wins} de ${total} manos ganadas`;
  }

  const detail = [
    result.dealerBlackjack
      ? "Blackjack del crupier: solo se pierde la apuesta inicial"
      : result.dealerBusted
        ? "El crupier se pasa"
        : `El crupier suma ${result.dealerTotal}`,
    pushes && total > 1 ? `${pushes} en empate` : null,
    result.insurance.taken
      ? result.insurance.payout > 0
        ? `El seguro paga ${credits(result.insurance.payout)}`
        : "El seguro se pierde"
      : null,
    net === 0 ? "Recuperas lo apostado" : `${net > 0 ? "+" : "−"}${credits(Math.abs(net))}`,
  ].filter(Boolean).join(" · ");

  setBanner(headline, detail, tone);
  history.push({
    label: net === 0 ? "Empate" : `${net > 0 ? "+" : "−"}${credits(Math.abs(net))}`,
    win: net > 0,
  });
}

/** Deal a new hand: one wallet round, one fairness round, one fresh shoe. */
async function startHand(stake) {
  if (busy || inProgress()) return;

  try {
    handle = openRound({ stake, game: "blackjack" });
  } catch (err) {
    const message = err instanceof LimitReached
      ? err.message
      : err.name === "InsufficientFunds"
        ? "Saldo insuficiente para esa apuesta."
        : err.message;
    toast(message, { variant: err instanceof LimitReached ? "warn" : "loss" });
    return;
  }

  busy = true;
  bet.setBusy(true, "Mano en curso");
  setBanner("Repartiendo…", `${credits(stake)} por mano`, "idle");

  try {
    state = deal(createGame(handle.round, { decks: DECKS }), stake);
  } catch (err) {
    abandon(err);
    return;
  }

  // Player, dealer, player, dealer — the same order as the shoe is consumed.
  handsRow.replaceChildren();
  dealerCards.replaceChildren();
  renderTable({ dealerLimit: 0, playerLimit: 0 });
  for (const [dealerLimit, playerLimit] of [[0, 1], [1, 1], [1, 2], [2, 2]]) {
    renderTable({ dealerLimit, playerLimit });
    await pause(DEAL_MS);
  }
  renderTable();

  if (state.phase === "insurance") {
    setBanner("¿Quieres seguro?", "El crupier enseña un As.", "idle");
    busy = false;
    updateActions();
    return;
  }

  if (state.phase === "dealer") {
    // A natural leaves nothing to decide — straight to the reveal.
    await finish();
    return;
  }

  setBanner("Te toca", "Pide, plántate, dobla o divide.", "idle");
  busy = false;
  updateActions();
}

/* --- Side panels ------------------------------------------------------------ */

const rulesPanel = () =>
  el("div.panel.stack.bj-panel--rules", { style: { "--stack-gap": "var(--space-3)" } }, [
    el("span.label", {}, "Reglas de la mesa"),
    el("dl.bj-rules", {}, [
      el("div", {}, [el("dt", {}, "Barajas"), el("dd", {}, String(DECKS))]),
      el("div", {}, [el("dt", {}, "Crupier"), el("dd", {}, `se planta en ${DEALER_STANDS_ON} blando`)]),
      el("div", {}, [el("dt", {}, "Blackjack"), el("dd", {}, "paga 3:2")]),
      el("div", {}, [el("dt", {}, "Doblar"), el("dd", {}, "dos cartas · tras dividir")]),
      el("div", {}, [el("dt", {}, "Dividir"), el("dd", {}, `hasta ${MAX_HANDS} manos`)]),
      el("div", {}, [el("dt", {}, "Ases divididos"), el("dd", {}, "una carta cada uno")]),
      el("div", {}, [el("dt", {}, "Seguro"), el("dd", {}, "paga 2:1")]),
      el("div", {}, [el("dt", {}, "Rendición"), el("dd", {}, "tardía · mitad")]),
    ]),
    el("p.text-xs.muted", {}, [
      "La carta tapada no se mira hasta que terminas. Si al descubrirla el crupier tiene blackjack, ",
      "la mano acaba ahí: se te devuelve todo lo apostado de más al doblar o dividir y solo pierdes la apuesta inicial.",
    ]),
  ]);

/* --- Mount ------------------------------------------------------------------ */

mountShell({ active: "blackjack" });

const history = historyStrip();
const stats = statsPanel();
const bet = betControls({
  actionLabel: "Repartir",
  onAction: (stake) => startHand(stake),
});

// Panel roles the phone layout reorders around the felt (see blackjack.css).
bet.root.classList.add("bj-panel--bet");
stats.root.classList.add("bj-panel--stats");

append($("#blackjack"), [
  el("div.game-layout.bj-layout", {}, [
    table,
    el("aside.game-controls", {}, [bet.root, actionsPanel, rulesPanel(), stats.root]),
  ]),
  el("div.panel.stack", {
    style: { "--stack-gap": "var(--space-3)", marginTop: "var(--space-5)" },
  }, [
    el("span.label", {}, "Últimas manos"),
    history.root,
  ]),
  playMoneyNote(),
]);

// Empty seats until the first deal, so the felt is never a blank rectangle.
handSlot(0);
updateActions();
