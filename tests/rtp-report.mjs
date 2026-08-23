/**
 * Prints the measured return-to-player of every game, alongside the value each
 * game declares. Not a test — a report, so the numbers in the documentation can
 * be regenerated rather than remembered.
 *
 *   node tests/rtp-report.mjs
 */

import { Round } from "../casino/js/core/rng.js";
import * as slots from "../casino/js/games/slots.js";
import * as dice from "../casino/js/games/dice.js";
import * as roulette from "../casino/js/games/roulette.js";
import * as mines from "../casino/js/games/mines.js";
import * as crash from "../casino/js/games/crash.js";
import * as blackjack from "../casino/js/games/blackjack.js";

const rounds = function* (count, seed) {
  for (let nonce = 0; nonce < count; nonce++) yield new Round(seed, "report", nonce);
};

function measure(label, declared, n, play) {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const value = play(i);
    sum += value;
    sumSq += value * value;
  }
  const mean = sum / n;
  const se = Math.sqrt(Math.max(0, sumSq / n - mean * mean) / n);
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  console.log(
    `${label.padEnd(30)} ${pct(mean).padStart(8)}  ±${(se * 196).toFixed(2).padStart(5)}` +
      `   (declara ${pct(declared)}, ${n.toLocaleString("es-ES")} rondas)`
  );
}

console.log("\nRTP medido — intervalo de confianza del 95 %\n");

{
  const it = rounds(300_000, "rep-slots");
  let nonce = 0;
  measure("Tragaperras · Neon Reels", slots.THEORETICAL_RTP, 300_000, () => {
    const result = slots.spin(it.next().value);
    let won = result.totalMultiplier;
    for (let i = 0; i < result.freeSpinsAwarded; i++) {
      won += slots.spin(new Round("rep-free", "report", nonce * 100 + i), { freeSpin: true }).totalMultiplier;
    }
    nonce++;
    return won / slots.LINES;
  });
}

{
  const it = rounds(300_000, "rep-dice");
  measure("Dados · objetivo 50, menor", dice.THEORETICAL_RTP, 300_000, () =>
    dice.resolve(it.next().value, { target: 50, direction: "under", stake: 100 }).payout / 100
  );
}

{
  const it = rounds(300_000, "rep-roul");
  const bet = { type: "red", amount: 100 };
  measure("Ruleta europea · rojo", roulette.THEORETICAL_RTP, 300_000, () =>
    roulette.payoutFor([bet], roulette.spin(it.next().value).number).payout / 100
  );
}

{
  const it = rounds(200_000, "rep-mines");
  measure("Minas · 3 minas, 3 aciertos", mines.THEORETICAL_RTP, 200_000, () => {
    let state = mines.createBoard(it.next().value, { mineCount: 3 });
    for (let k = 0; k < 3 && state.status === mines.STATUS.PLAYING; k++) {
      state = mines.reveal(state, mines.hiddenTiles(state)[0]);
    }
    return state.status === mines.STATUS.LOST ? 0 : mines.payoutFor(100, 3, state.revealed.length) / 100;
  });
}

{
  const it = rounds(300_000, "rep-crash");
  measure("Crash · retirada a 2×", crash.THEORETICAL_RTP, 300_000, () =>
    crash.resolve({ crashPoint: crash.crashPointFrom(it.next().value), cashoutAt: 2, stake: 100 }).payout / 100
  );
}

{
  let game = blackjack.createGame(new Round("rep-bj", "report", 0));
  let nonce = 1;
  let wagered = 0;
  let returned = 0;
  const HANDS = 400_000;

  for (let i = 0; i < HANDS; i++) {
    if (blackjack.cardsLeft(game) < blackjack.MIN_CARDS_TO_DEAL) {
      game = blackjack.reshuffle(game, new Round("rep-bj", "report", nonce++));
    }
    const played = blackjack.playBasicStrategy(blackjack.deal(game, 100));
    const result = blackjack.settlement(played);
    wagered += result.wagered;
    returned += result.payout;
    game = played;
  }
  console.log(
    `${"Blackjack · estrategia básica".padEnd(30)} ${((returned / wagered) * 100).toFixed(2).padStart(7)}%` +
      `           (sobre el total apostado, ${HANDS.toLocaleString("es-ES")} manos)`
  );
}

console.log("");
