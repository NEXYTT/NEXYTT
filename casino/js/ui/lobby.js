/**
 * Lobby controller.
 *
 * Renders the game grid from the GAMES catalogue, the live session panel and
 * the last movements of the ledger. It owns no game logic at all: everything
 * shown here is derived from `wallet` and `fairness`, so the lobby can never
 * disagree with what the games recorded.
 */

import { el, $, replace } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { credits, percent, relative, shortHash } from "../../../assets/js/format.js";
import { wallet, fairness, GAMES } from "../core/context.js";
import { mountShell, statsPanel, playMoneyNote } from "./shell.js";

/** Ledger entries store the game id; the lobby shows the commercial name. */
const GAME_TITLES = new Map(GAMES.map((g) => [g.id, g.title]));

/** `cashier` is the pseudo-game used by top-ups, so it needs a label too. */
const gameLabel = (id) => GAME_TITLES.get(id) ?? (id === "cashier" ? "Caja" : id);

const KIND_LABELS = {
  bet: "Apuesta",
  payout: "Pago",
  grant: "Recarga",
  adjust: "Devolución",
};

mountShell({ active: "lobby" });

/* --- Game grid ------------------------------------------------------------ */

const gameTile = (game) =>
  el("a.game-tile", { href: game.href, "aria-label": `Jugar a ${game.title}` }, [
    el("div.game-tile__art", {}, [icon(game.glyph, { size: 64, stroke: 1.25 })]),
    el("div", {}, [
      el("h3", {}, game.title),
      el("p.muted.text-sm", {}, game.tagline),
    ]),
    el("div.game-tile__meta", {}, [
      el("span.badge.badge--accent", {}, `RTP ${percent(game.rtp, { decimals: 1 })}`),
      el("span.badge", {}, `Volatilidad ${game.volatility}`),
    ]),
  ]);

replace($("#game-grid"), GAMES.map(gameTile));

/* --- Session panel -------------------------------------------------------- */

$("#side-stats").append(statsPanel().root);

/* --- Ledger --------------------------------------------------------------- */

/** Signed amount: the sign is the fastest read in a ledger, so it is explicit. */
const signedCredits = (minorUnits) =>
  `${minorUnits > 0 ? "+" : minorUnits < 0 ? "−" : ""}${credits(Math.abs(minorUnits))}`;

const ledgerHost = $("#ledger-host");

function renderLedger() {
  const entries = wallet.history(10);

  if (!entries.length) {
    replace(ledgerHost, [
      el("div.empty", {}, [
        el("div.empty__icon", {}, [icon("wallet", { size: 40 })]),
        el("p", {}, "Todavía no has jugado ninguna ronda."),
        el("p.text-sm.subtle", {}, "Elige un juego y aquí aparecerá cada movimiento."),
      ]),
    ]);
    return;
  }

  replace(ledgerHost, [
    el("table.table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { scope: "col" }, "Juego"),
          el("th", { scope: "col" }, "Importe"),
          el("th", { scope: "col" }, "Saldo"),
          el("th", { scope: "col" }, "Cuándo"),
        ]),
      ]),
      el("tbody", {}, entries.map((entry) =>
        el("tr", {}, [
          el("td", {}, [
            el("div.truncate", {}, gameLabel(entry.game)),
            el("div.text-xs.subtle", {}, KIND_LABELS[entry.kind] ?? entry.kind),
          ]),
          el("td.mono", {
            class: entry.amount > 0 ? "text-win" : entry.amount < 0 ? "text-loss" : "",
          }, signedCredits(entry.amount)),
          el("td.mono", {}, credits(entry.balanceAfter)),
          el("td.text-sm.muted", {}, relative(entry.at)),
        ])
      )),
    ]),
  ]);
}

renderLedger();
// Any movement anywhere (including the top-up button in the shell) rewrites the table.
wallet.on("change", renderLedger);

/* --- Fairness teaser ------------------------------------------------------ */

$("#lobby-commitment").textContent = shortHash(fairness.commitment, 12);

/* --- Footer --------------------------------------------------------------- */

$("#app").append(playMoneyNote());
