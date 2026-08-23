/**
 * Casino chrome: top bar, live balance, fairness dialog, responsible-play
 * dialog, and the reusable bet-control widget every game mounts.
 *
 * Games call `mountShell()` once and then compose `betControls()` into their
 * sidebar, so the betting UX is identical across all six titles.
 */

import { el, $, replace, toast, copyText, tween, delegate } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { credits, shortHash, duration, percent } from "../../../assets/js/format.js";
import { wallet, fairness, responsible, persistFairness, CHIPS, GAMES, UNIT } from "../core/context.js";
import { verifyRound } from "../core/rng.js";

/* --- Top bar -------------------------------------------------------------- */

/**
 * @param {{active?: string}} opts id of the current page for nav highlighting
 */
export function mountShell({ active = "" } = {}) {
  const balanceValue = el("span.balance__value", { id: "balance-value" }, credits(wallet.balance));

  const header = el("header.topbar", {}, [
    el("div.topbar__inner", {}, [
      el("a.brand", { href: "index.html", "aria-label": "NEXYTT Casino, ir al lobby" }, [
        el("span.brand__mark", {}, "N"),
        el("span", {}, [
          el("span", { style: { display: "block", lineHeight: "1.1" } }, "NEXYTT"),
          el("span.brand__sub", {}, "Casino · créditos virtuales"),
        ]),
      ]),

      el("nav.topnav.hide-sm", { "aria-label": "Juegos" }, [
        navLink("index.html", "Lobby", active === "lobby"),
        ...GAMES.map((g) => navLink(g.href, g.title, active === g.id)),
      ]),

      el("span.spacer"),

      el("div.balance", {}, [
        el("span", {}, [
          el("span.balance__label", {}, "Saldo"),
          balanceValue,
        ]),
        el("button.btn.btn--sm.btn--primary", {
          onclick: () => {
            wallet.grant(100_000, "recarga");
            toast("+1.000,00 créditos añadidos.", { variant: "win" });
          },
          title: "Recargar créditos de juego",
        }, "+1.000"),
      ]),

      iconButton("shield", "Juego responsable", openResponsibleDialog),
      iconButton("lock", "Justicia verificable", openFairnessDialog),
    ]),
  ]);

  document.body.prepend(header);

  // Keep the pill in sync with every ledger movement, animating the count.
  let previous = wallet.balance;
  wallet.on("change", (balance) => {
    const node = $("#balance-value");
    if (!node) return;
    node.classList.remove("is-up", "is-down");
    // Force a reflow so the animation restarts on consecutive wins.
    void node.offsetWidth;
    node.classList.add(balance > previous ? "is-up" : balance < previous ? "is-down" : "");
    tween(previous, balance, 420, (v) => {
      node.textContent = credits(Math.round(v));
    });
    previous = balance;
  });

  responsible.on("reminder", (minutes) => {
    toast(`Llevas ${minutes} minutos jugando. Considera hacer una pausa.`, {
      variant: "warn",
      title: "Recordatorio de sesión",
      timeout: 9000,
    });
  });

  // Poll the session clock once a minute — cheap, and the only way to fire the
  // reminder for a player who is idle between rounds.
  setInterval(() => responsible.tick(), 60_000);

  return header;
}

const navLink = (href, label, current) =>
  el("a", { href, ...(current ? { "aria-current": "page" } : {}) }, label);

function iconButton(name, label, onclick) {
  const button = el("button.btn.btn--ghost.btn--icon", { onclick, title: label, "aria-label": label });
  button.append(icon(name));
  return button;
}

/* --- Bet controls --------------------------------------------------------- */

/**
 * The stake widget: amount input, quick chips, ½ / ×2 / máx, and the action
 * button. Returns handles so the game can read the stake and toggle busy state.
 *
 * @param {{min?:number, max?:number, initial?:number, actionLabel?:string, onAction:(stake:number)=>void, extra?:Node[]}} opts
 */
export function betControls({
  min = 100,
  max = 100_000,
  initial = 1000,
  actionLabel = "Apostar",
  onAction,
  extra = [],
}) {
  const input = el("input.input", {
    type: "number",
    min: min / UNIT,
    max: max / UNIT,
    step: "0.01",
    value: (initial / UNIT).toFixed(2),
    inputmode: "decimal",
    "aria-label": "Importe de la apuesta en créditos",
  });

  /** Read the stake as validated minor units. */
  const readStake = () => {
    const parsed = Math.round(Number(input.value.replace(",", ".")) * UNIT);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
  };

  const writeStake = (minorUnits) => {
    const clamped = Math.min(max, Math.max(min, Math.round(minorUnits)));
    input.value = (clamped / UNIT).toFixed(2);
    return clamped;
  };

  const action = el("button.btn.btn--primary.btn--lg.btn--block", {
    onclick: () => onAction(readStake()),
  }, actionLabel);

  const chipRow = el("div.chip-row", {},
    CHIPS.filter((c) => c <= max).map((amount) =>
      el("button.chip-btn", {
        type: "button",
        onclick: () => writeStake(amount),
        title: `Apostar ${credits(amount)}`,
      }, credits(amount))
    )
  );

  const modifiers = el("div.chip-row", {}, [
    el("button.chip-btn", { type: "button", onclick: () => writeStake(readStake() / 2) }, "½"),
    el("button.chip-btn", { type: "button", onclick: () => writeStake(readStake() * 2) }, "×2"),
    el("button.chip-btn", {
      type: "button",
      onclick: () => writeStake(Math.min(max, wallet.balance)),
    }, "Máx"),
  ]);

  const root = el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
    el("span.label", {}, "Apuesta"),
    el("div.bet-amount", {}, [input]),
    chipRow,
    modifiers,
    ...extra,
    action,
  ]);

  return {
    root,
    input,
    action,
    get stake() { return readStake(); },
    setStake: writeStake,
    /** Disable the whole widget while a round animates. */
    setBusy(busy, label) {
      action.disabled = busy;
      input.disabled = busy;
      if (label) action.textContent = label;
      else if (!busy) action.textContent = actionLabel;
      for (const chip of root.querySelectorAll(".chip-btn")) chip.disabled = busy;
    },
  };
}

/* --- History strip -------------------------------------------------------- */

/**
 * Rolling strip of recent round outcomes.
 * @param {number} keep maximum pills retained
 */
export function historyStrip(keep = 24) {
  const root = el("div.history-strip", { "aria-label": "Resultados recientes", role: "log" });
  return {
    root,
    /** @param {{label:string, win:boolean}} entry */
    push({ label, win }) {
      root.prepend(el(`div.history-pill.history-pill--${win ? "win" : "loss"}`, {}, label));
      while (root.children.length > keep) root.lastElementChild.remove();
    },
    clear() { root.replaceChildren(); },
  };
}

/* --- Session stats panel -------------------------------------------------- */

export function statsPanel() {
  const cells = {
    rounds: el("div.stat__value", {}, "0"),
    wagered: el("div.stat__value", {}, "0,00"),
    net: el("div.stat__value", {}, "0,00"),
    rtp: el("div.stat__value", {}, "—"),
  };

  const render = () => {
    const s = wallet.stats();
    cells.rounds.textContent = String(s.rounds);
    cells.wagered.textContent = credits(s.wagered);
    cells.net.textContent = credits(s.net);
    cells.net.className = `stat__value ${s.net > 0 ? "text-win" : s.net < 0 ? "text-loss" : ""}`;
    cells.rtp.textContent = s.rtp == null ? "—" : percent(s.rtp, { decimals: 1 });
  };

  wallet.on("change", render);
  render();

  const root = el("div.panel.stack", { style: { "--stack-gap": "var(--space-3)" } }, [
    el("span.label", {}, "Tu sesión"),
    el("div.stat-grid", {}, [
      el("div.stat", {}, [el("div.stat__label", {}, "Rondas"), cells.rounds]),
      el("div.stat", {}, [el("div.stat__label", {}, "Apostado"), cells.wagered]),
      el("div.stat", {}, [el("div.stat__label", {}, "Resultado"), cells.net]),
      el("div.stat", {}, [el("div.stat__label", {}, "RTP real"), cells.rtp]),
    ]),
  ]);

  return { root, render };
}

/* --- Dialogs -------------------------------------------------------------- */

function dialog(title, body, footer = []) {
  const node = el("dialog.modal", {}, [
    el("div.modal__head", {}, [
      el("h3", {}, title),
      el("button.btn.btn--ghost.btn--icon", {
        onclick: () => node.close(),
        "aria-label": "Cerrar",
      }, [icon("close")]),
    ]),
    el("div.modal__body", {}, body),
    footer.length ? el("div.modal__foot", {}, footer) : null,
  ]);

  document.body.append(node);
  node.addEventListener("close", () => node.remove());
  node.showModal();
  return node;
}

/** Seed management + round verifier. */
export function openFairnessDialog() {
  const commitment = el("div.seed-value", {}, fairness.commitment);
  const clientInput = el("input.input", { value: fairness.clientSeed, "aria-label": "Semilla de cliente" });
  const nonceValue = el("div.seed-value", {}, String(fairness.nonce));

  const verifyOut = el("div.seed-value.subtle", {}, "Introduce una semilla revelada para comprobar una ronda.");
  const vServer = el("input.input", { placeholder: "Semilla del servidor revelada" });
  const vNonce = el("input.input", { type: "number", value: "0", min: "0" });

  const body = el("div.stack", {}, [
    el("p.text-sm.muted", {}, [
      "Cada ronda se genera con ",
      el("code.mono", {}, "HMAC-SHA256(semilla_servidor, cliente:nonce:cursor)"),
      ". Publicamos el hash de la semilla del servidor antes de jugar, así que no puede cambiarse después. Al rotarla se revela la original y puedes recalcular todas tus rondas.",
    ]),

    el("div.field", {}, [
      el("span.label", {}, "Compromiso actual · SHA-256 de la semilla del servidor"),
      el("div.seed-row", {}, [
        commitment,
        el("button.btn.btn--ghost.btn--sm", {
          onclick: async () => {
            toast((await copyText(fairness.commitment)) ? "Compromiso copiado." : "No se pudo copiar.", {
              variant: "info",
            });
          },
        }, [icon("copy", { size: 16 })]),
      ]),
    ]),

    el("div.field", {}, [
      el("span.label", {}, "Tu semilla de cliente"),
      el("div.seed-row", {}, [
        clientInput,
        el("button.btn.btn--ghost.btn--sm", {
          onclick: () => {
            try {
              fairness.setClientSeed(clientInput.value);
              persistFairness();
              nonceValue.textContent = String(fairness.nonce);
              toast("Semilla de cliente actualizada. El nonce vuelve a 0.", { variant: "win" });
            } catch (err) {
              toast(err.message, { variant: "loss" });
            }
          },
        }, "Guardar"),
      ]),
      el("span.field__hint", {}, "Cámbiala cuando quieras: influye en todos los resultados futuros."),
    ]),

    el("div.field", {}, [
      el("span.label", {}, "Nonce (rondas jugadas con esta semilla)"),
      nonceValue,
    ]),

    el("hr.divider"),

    el("div.field", {}, [
      el("span.label", {}, "Verificar una ronda"),
      vServer,
      el("div.seed-row", {}, [
        vNonce,
        el("button.btn.btn--ghost.btn--sm", {
          onclick: () => {
            const result = verifyRound({
              serverSeed: vServer.value.trim(),
              clientSeed: clientInput.value.trim(),
              nonce: Number(vNonce.value) || 0,
              floatCount: 5,
            });
            replace(verifyOut, [
              el("div", {}, `SHA-256 → ${shortHash(result.computedCommitment)}`),
              el("div", {}, `Números: ${result.floats.map((f) => f.toFixed(6)).join(", ")}`),
            ]);
          },
        }, "Comprobar"),
      ]),
      verifyOut,
    ]),
  ]);

  return dialog("Justicia verificable", body, [
    el("button.btn.btn--ghost", {
      onclick: () => {
        const { revealedServerSeed, roundsPlayed } = fairness.rotate();
        persistFairness();
        commitment.textContent = fairness.commitment;
        nonceValue.textContent = "0";
        vServer.value = revealedServerSeed;
        toast(`Semilla rotada tras ${roundsPlayed} rondas. La anterior ya es pública.`, {
          variant: "win",
          timeout: 7000,
        });
      },
    }, "Rotar y revelar semilla"),
  ]);
}

/** Limits and self-exclusion. */
export function openResponsibleDialog() {
  const { limits } = responsible;
  const toCredits = (v) => (v == null ? "" : String(v / UNIT));
  const parseLimit = (raw) => {
    const value = Number(String(raw).replace(",", "."));
    return raw === "" || !Number.isFinite(value) || value <= 0 ? null : Math.round(value * UNIT);
  };

  const stakeInput = el("input.input", { type: "number", min: "1", step: "0.01", value: toCredits(limits.stakeLimit), placeholder: "Sin límite" });
  const lossInput = el("input.input", { type: "number", min: "1", step: "0.01", value: toCredits(limits.lossLimit), placeholder: "Sin límite" });
  const timeInput = el("input.input", { type: "number", min: "1", value: limits.sessionMinutes ?? "", placeholder: "Sin límite" });

  const body = el("div.stack", {}, [
    el("div.rg-banner", {}, [
      icon("info"),
      el("div", {}, "Este casino usa créditos virtuales sin valor monetario. Aun así, los límites funcionan de verdad: se comprueban antes de aceptar cualquier apuesta."),
    ]),

    el("div.field", {}, [
      el("span.label", {}, "Apuesta máxima por jugada (créditos)"),
      stakeInput,
    ]),
    el("div.field", {}, [
      el("span.label", {}, "Pérdida máxima de la sesión (créditos)"),
      lossInput,
      el("span.field__hint", {}, `Pérdida actual de la sesión: ${credits(Math.max(0, -wallet.stats().net))}`),
    ]),
    el("div.field", {}, [
      el("span.label", {}, "Duración máxima de la sesión (minutos)"),
      timeInput,
      el("span.field__hint", {}, `Llevas ${duration(responsible.elapsedMinutes * 60000)} en esta sesión.`),
    ]),

    el("hr.divider"),

    el("div.field", {}, [
      el("span.label", {}, "Autoexclusión temporal"),
      el("span.field__hint", {}, "Bloquea el juego durante el tiempo que elijas. No se puede acortar una vez activada."),
      el("div.chip-row", {},
        [
          { label: "15 min", minutes: 15 },
          { label: "1 hora", minutes: 60 },
          { label: "24 horas", minutes: 1440 },
          { label: "7 días", minutes: 10080 },
        ].map(({ label, minutes }) =>
          el("button.chip-btn", {
            onclick: () => {
              responsible.selfExclude(minutes);
              toast(`Autoexclusión activada durante ${label}.`, { variant: "warn", timeout: 6000 });
            },
          }, label)
        )
      ),
    ]),
  ]);

  return dialog("Juego responsable", body, [
    el("button.btn.btn--primary", {
      onclick: (ev) => {
        responsible.setLimits({
          stakeLimit: parseLimit(stakeInput.value),
          lossLimit: parseLimit(lossInput.value),
          sessionMinutes: timeInput.value === "" ? null : Math.max(1, Number(timeInput.value)),
        });
        toast("Límites guardados.", { variant: "win" });
        ev.target.closest("dialog").close();
      },
    }, "Guardar límites"),
  ]);
}

/** Footer disclaimer, appended by every page. */
export function playMoneyNote() {
  return el("p.play-money-note", {}, [
    "NEXYTT Casino es una demostración técnica con créditos virtuales sin valor monetario: no se puede depositar ni retirar dinero. ",
    "Un casino con dinero real requiere licencia del regulador correspondiente (DGOJ en España), verificación de identidad y prevención de blanqueo. ",
    "Si el juego deja de ser un entretenimiento para ti, en España puedes llamar al 900 200 225 (línea gratuita y confidencial de FEJAR).",
  ]);
}
