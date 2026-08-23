/**
 * Fairness page controller.
 *
 * The point of this page is that it re-derives everything from scratch: it
 * calls the same `verifyRound()` any third party would call, with seeds the
 * user typed, and never reads a stored result. If the recomputed numbers
 * matched the games only because both read the same cache, the page would
 * prove nothing.
 */

import { el, $, replace, delegate, toast, copyText } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { shortHash } from "../../../assets/js/format.js";
import { fairness, persistFairness, GAMES } from "../core/context.js";
import { verifyRound } from "../core/rng.js";
import { mountShell, playMoneyNote } from "./shell.js";

/** Upper bound on the numbers we will draw, mirroring the input's `max`. */
const MAX_FLOATS = 64;

mountShell({ active: "fairness" });

/* --- Session state -------------------------------------------------------- */

const state = {
  commitment: $("#fs-commitment"),
  next: $("#fs-next"),
  client: $("#fs-client"),
  nonce: $("#fs-nonce"),
};

function renderState() {
  // Full hashes here rather than shortened ones: this is the panel people copy
  // out to check a round elsewhere, and half a hash verifies nothing.
  state.commitment.textContent = fairness.commitment;
  state.next.textContent = fairness.nextCommitment;
  state.client.textContent = fairness.clientSeed;
  state.nonce.textContent = String(fairness.nonce);
}

renderState();

delegate(document, "click", "[data-copy]", async (_ev, button) => {
  const source = document.getElementById(button.dataset.copy);
  const ok = source && (await copyText(source.textContent));
  toast(ok ? "Copiado al portapapeles." : "No se pudo copiar.", { variant: ok ? "win" : "loss" });
});

/* --- Verifier ------------------------------------------------------------- */

const form = $("#verify-form");
const output = $("#verify-output");
const fields = {
  server: $("#fv-server"),
  client: $("#fv-client"),
  nonce: $("#fv-nonce"),
  count: $("#fv-count"),
  commitment: $("#fv-commitment"),
};

/** Prefill what the session already knows. The server seed stays secret until rotation. */
function fillFromSession() {
  fields.client.value = fairness.clientSeed;
  fields.commitment.value = fairness.commitment;
  // The last round played is nonce - 1; before any round there is nothing to check yet.
  fields.nonce.value = String(Math.max(0, fairness.nonce - 1));
}

fillFromSession();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const flag = (kind, text) =>
  el(`div.verify-flag.verify-flag--${kind}`, {}, [
    icon(kind === "ok" ? "check" : kind === "bad" ? "close" : "info", { size: 18 }),
    el("span", {}, text),
  ]);

function runVerification() {
  const serverSeed = fields.server.value.trim();
  if (!serverSeed) {
    fields.server.setAttribute("aria-invalid", "true");
    replace(output, [flag("bad", "Escribe una semilla del servidor: sin ella no hay nada que recalcular.")]);
    return;
  }
  fields.server.removeAttribute("aria-invalid");

  const nonce = Math.max(0, Math.floor(Number(fields.nonce.value) || 0));
  const floatCount = clamp(Math.floor(Number(fields.count.value) || 8), 1, MAX_FLOATS);
  fields.count.value = String(floatCount);
  const commitment = fields.commitment.value.trim();

  const result = verifyRound({
    serverSeed,
    clientSeed: fields.client.value.trim(),
    nonce,
    commitment: commitment || undefined,
    floatCount,
  });

  // `commitmentValid` is deliberately tri-state: null means "the user gave us
  // nothing to compare against", which is not the same as a failed check.
  const verdict =
    result.commitmentValid === true
      ? flag("ok", "El hash coincide con el compromiso: la semilla es la que se publicó.")
      : result.commitmentValid === false
        ? flag("bad", "El hash NO coincide con el compromiso. Esa semilla no es la comprometida.")
        : flag("info", "Pega un compromiso para comprobar que la semilla es la que se publicó.");

  replace(output, [
    el("div.field", {}, [
      el("span.label", {}, "SHA-256 de la semilla del servidor"),
      el("div.seed-value", {}, result.computedCommitment),
    ]),
    verdict,
    el("div.field", {}, [
      el("span.label", {}, `Números de la ronda ${nonce} · ${floatCount} valores`),
      el("ol.number-grid", {}, result.floats.map((value, index) =>
        el("li.number-grid__item", {}, [
          el("span.number-grid__index", {}, `#${index}`),
          el("code.mono.number-grid__value", {}, value.toFixed(8)),
          // The bar is the same number read as a length: it makes a biased
          // stream visible at a glance instead of hiding in eight decimals.
          el("span.number-grid__bar", { "aria-hidden": "true" }, [
            el("span", { style: { width: `${(value * 100).toFixed(2)}%` } }),
          ]),
        ])
      )),
    ]),
    el("p.text-xs.subtle", {}, [
      "Cadena firmada: ",
      el("code.mono", {}, `${fields.client.value.trim()}:${nonce}:0`),
      " · clave: la semilla del servidor · función: HMAC-SHA256.",
    ]),
  ]);
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  runVerification();
});

$("#fv-fill").addEventListener("click", () => {
  fillFromSession();
  toast("Formulario rellenado con los datos de la sesión.", { variant: "info" });
});

/* --- Rotation ------------------------------------------------------------- */

$("#fs-rotate").addEventListener("click", () => {
  const { revealedServerSeed, revealedCommitment, roundsPlayed } = fairness.rotate();
  persistFairness();
  renderState();

  // Hand the revealed seed straight to the form: the whole reason to rotate is
  // to check the rounds you just played, and re-typing 64 hex chars is friction.
  fields.server.value = revealedServerSeed;
  fields.commitment.value = revealedCommitment;
  fields.client.value = fairness.clientSeed;
  fields.nonce.value = "0";
  runVerification();

  toast(
    roundsPlayed > 0
      ? `Semilla revelada tras ${roundsPlayed} ronda${roundsPlayed === 1 ? "" : "s"}. Ya puedes comprobarlas una a una.`
      : "Semilla revelada. No habías jugado ninguna ronda con ella.",
    { variant: "win", title: `Compromiso cumplido · ${shortHash(revealedCommitment)}`, timeout: 8000 }
  );
});

/* --- How each game reads the stream --------------------------------------- */

/**
 * Index usage per game. Kept in sync with the game modules by hand — it
 * describes the contract each one relies on, not an implementation detail.
 */
const STREAM_MAP = {
  slots: {
    uses: "5 · índices 0–4",
    how: "Un número por rodillo, de izquierda a derecha: round.int(símbolos, i) elige el símbolo del rodillo i.",
  },
  blackjack: {
    uses: "n−1 · 311 con 6 barajas",
    how: "round.shuffle() baraja el zapato entero con Fisher–Yates antes de repartir; las cartas salen de ese orden.",
  },
  roulette: {
    uses: "1 · índice 0",
    how: "round.int(37, 0) da la casilla ganadora, de 0 a 36. Un solo cero, sin doble cero.",
  },
  dice: {
    uses: "1 · índice 0",
    how: "round.at(0) × 100 es la tirada de 0,00 a 99,99 que se compara con el objetivo que hayas fijado.",
  },
  crash: {
    uses: "1 · índice 0",
    how: "round.at(0) determina el multiplicador en el que la curva revienta; el margen de la casa se aplica sobre esa curva.",
  },
  mines: {
    uses: "k · índices 0…k−1",
    how: "round.pick(minas, 25) coloca las minas en la cuadrícula de 5×5 sin repetir casilla.",
  },
};

replace($("#mapping-host"), [
  el("table.table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col" }, "Juego"),
        el("th", { scope: "col" }, "Números que consume"),
        el("th", { scope: "col" }, "Cómo se traduce"),
      ]),
    ]),
    el("tbody", {}, GAMES.map((game) => {
      const entry = STREAM_MAP[game.id];
      return el("tr", {}, [
        el("td", {}, [
          el("div.row", { style: { gap: "var(--space-2)" } }, [
            icon(game.glyph, { size: 18 }),
            el("span", {}, game.title),
          ]),
        ]),
        el("td.text-sm.mono", {}, entry.uses),
        el("td.text-sm.muted", {}, entry.how),
      ]);
    })),
  ]),
]);

$("#app").append(playMoneyNote());
