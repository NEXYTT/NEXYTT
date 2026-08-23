/**
 * Ruleta Europea — pure game logic. No DOM, importable from node.
 *
 * Randomness comes exclusively from a `Round` (../core/rng.js): `spin()` reads
 * one integer from stream position 0, so every result is reproducible from its
 * seed triple. There is no `Math.random()` in this file.
 *
 * ## Why every bet has the same RTP
 * A European wheel has 37 pockets and the whole layout is priced as if it had
 * 36. For a bet covering `size` numbers at odds of `payout` to 1:
 *
 *     E[return] / stake = size × (payout + 1) / 37
 *
 * and `size × (payout + 1) === 36` holds for every entry of `BET_TYPES` — a
 * straight up covers 1 and returns 36 units, a split covers 2 and returns 18,
 * a dozen covers 12 and returns 3. So the return is 36/37 = 97,297 % anywhere
 * on the felt and the house edge is exactly the zero: 1/37 = 2,703 %.
 * There is no `en prison` / `la partage` rule here; those raise the RTP of the
 * even-money bets only, and would break the "same RTP everywhere" invariant.
 *
 * ## Money
 * Amounts are integer minor units (credits × 100). A payout is an integer
 * multiple of the stake, so no rounding ever happens in this module.
 *
 * ## The felt
 * The betting layout is the standard 3 rows × 12 columns grid with the zero
 * hanging off its left edge. Two numbers are neighbours if they touch on that
 * grid, which is what makes a split legal — not any two numbers the caller
 * feels like pairing. Every compound selection is validated against the real
 * geometry and impossible combinations are rejected.
 */

/** Pockets on a European wheel: 1–36 plus a single zero. */
export const POCKETS = 37;

/** Theoretical return to player, identical for every bet on the layout. */
export const THEORETICAL_RTP = 36 / 37;
/** The zero, expressed as the house's advantage. */
export const HOUSE_EDGE = 1 / 37;

/**
 * Physical pocket order of a European wheel, clockwise from the zero.
 * Reds and blacks alternate and consecutive numbers sit far apart — this is
 * the real wheel, not the numeric order, and it is what the animation walks.
 */
export const WHEEL = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]);

/** The 18 red pockets. Everything else from 1 to 36 is black; 0 is green. */
export const RED_NUMBERS = Object.freeze([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const RED = new Set(RED_NUMBERS);

// A typo in either table would silently bias every result and every payout, so
// both are checked once at import time rather than trusted.
(function assertTables() {
  const distinct = new Set(WHEEL);
  const wheelOk =
    WHEEL.length === POCKETS &&
    distinct.size === POCKETS &&
    WHEEL.every((n) => Number.isInteger(n) && n >= 0 && n < POCKETS);
  if (!wheelOk) {
    throw new Error("WHEEL debe contener los 37 números del 0 al 36 sin repetir");
  }
  const redOk =
    RED_NUMBERS.length === 18 &&
    new Set(RED_NUMBERS).size === 18 &&
    RED_NUMBERS.every((n) => Number.isInteger(n) && n >= 1 && n <= 36);
  if (!redOk) {
    throw new Error("RED_NUMBERS debe contener 18 números distintos entre 1 y 36");
  }
})();

/** Position of each number in the wheel, for the UI animation. */
const WHEEL_INDEX = new Map(WHEEL.map((n, i) => [n, i]));

/** @param {number} number @returns {number} pocket index in `WHEEL` */
export function wheelIndexOf(number) {
  const index = WHEEL_INDEX.get(number);
  if (index === undefined) throw new RangeError(`${number} no es una casilla de la ruleta`);
  return index;
}

/** @param {number} n @returns {'green'|'red'|'black'} */
export function colorOf(n) {
  if (!isPocket(n)) throw new RangeError(`${n} no es una casilla de la ruleta`);
  return n === 0 ? "green" : RED.has(n) ? "red" : "black";
}

/* --- Felt geometry --------------------------------------------------------- */

const isPocket = (n) => Number.isInteger(n) && n >= 0 && n <= 36;

/** Block of three ("calle"): 1 → {1,2,3} … 12 → {34,35,36}. Zero is its own. */
const streetOf = (n) => (n === 0 ? 0 : Math.ceil(n / 3));
/** Column that pays 2:1 — 1 → {1,4,…,34}. The zero belongs to no column. */
const columnOf = (n) => (n === 0 ? 0 : ((n - 1) % 3) + 1);
/** Dozen that pays 2:1. The zero belongs to no dozen. */
const dozenOf = (n) => (n === 0 ? 0 : Math.ceil(n / 12));

/**
 * Do two cells touch on the felt? Inside one block of three the numbers are
 * stacked (1–2, 2–3), and consecutive blocks put `n` next to `n+3`. The zero
 * hangs off the left edge of the first block, so it touches 1, 2 and 3.
 */
function isAdjacentPair([a, b]) {
  if (a === 0) return b === 1 || b === 2 || b === 3;
  if (b - a === 1) return streetOf(a) === streetOf(b);
  return b - a === 3;
}

/** A whole block of three, or one of the two trios that include the zero. */
function isStreetTrio([a, b, c]) {
  if (a === 0) return (b === 1 && c === 2) || (b === 2 && c === 3);
  return a % 3 === 1 && b === a + 1 && c === a + 2;
}

/**
 * Four cells meeting at one corner: `a` is the low-left of the square, so it
 * cannot be the top of its block (`a % 3 === 0`) nor sit in the last column
 * (`a + 4 > 36`). `0/1/2/3` is the "primeros cuatro", the corner formed with
 * the zero, and it pays the same 8 to 1.
 */
function isCornerQuad([a, b, c, d]) {
  if (a === 0) return b === 1 && c === 2 && d === 3;
  return a % 3 !== 0 && b === a + 1 && c === a + 3 && d === a + 4 && d <= 36;
}

/** Two adjacent blocks of three: 1–6, 4–9 … 31–36. */
function isSixLine(selection) {
  const [a] = selection;
  return a % 3 === 1 && a <= 31 && selection.every((n, i) => n === a + i);
}

/* --- Selection parsing ----------------------------------------------------- */

/**
 * Canonicalise the numbers of an inside bet: exactly `size` distinct pockets,
 * sorted ascending so that `betKey()` is stable regardless of click order.
 */
function toNumbers(selection, size, label) {
  const list = Array.isArray(selection) ? selection : [selection];
  if (list.length !== size) {
    throw new Error(`${label} necesita ${size} ${size === 1 ? "número" : "números"}, recibidos ${list.length}`);
  }
  const sorted = list.map(Number).sort((a, b) => a - b);
  for (const n of sorted) {
    if (!isPocket(n)) throw new RangeError(`${n} no es una casilla de la ruleta`);
  }
  if (new Set(sorted).size !== size) throw new Error(`${label}: no se puede repetir un número`);
  return Object.freeze(sorted);
}

/** Columns and dozens are identified by their index, 1 to 3. */
function toGroup(selection, label) {
  const k = Number(selection);
  if (k !== 1 && k !== 2 && k !== 3) throw new Error(`${label} debe ser 1, 2 o 3`);
  return k;
}

/** Even-money bets carry no selection; anything else is a caller mistake. */
function toNothing(selection, label) {
  if (selection != null && selection !== "") {
    throw new Error(`${label} no lleva selección`);
  }
  return null;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const numbersOfColumn = (k) => Object.freeze(range(1, 36).filter((n) => columnOf(n) === k));
const numbersOfDozen = (k) => Object.freeze(range(k * 12 - 11, k * 12));

/* --- Bet types -------------------------------------------------------------- */

/**
 * Every bet the layout accepts.
 *
 * - `size`    numbers covered; `size × (payout + 1) === 36` for all of them
 * - `payout`  odds "to 1": the profit per unit staked on a win
 * - `family`  how the UI groups it: on the number grid, or outside it
 * - `normalize(selection)` canonical selection, throwing on an illegal one
 * - `covers(selection, number)` the win test, one implementation per type
 * - `numbers(selection)` every pocket the bet covers, for highlighting
 * - `describe(selection)` Spanish label for the bet slip
 */
export const BET_TYPES = Object.freeze({
  straight: {
    id: "straight",
    label: "Pleno",
    payout: 35,
    size: 1,
    family: "inside",
    normalize: (selection) => toNumbers(selection, 1, "Un pleno"),
    covers: (selection, number) => selection[0] === number,
    numbers: (selection) => selection,
    describe: (selection) => `Pleno ${selection[0]}`,
  },

  split: {
    id: "split",
    label: "Caballo",
    payout: 17,
    size: 2,
    family: "inside",
    normalize: (selection) => {
      const pair = toNumbers(selection, 2, "Un caballo");
      if (!isAdjacentPair(pair)) {
        throw new Error(`Caballo imposible: ${pair[0]} y ${pair[1]} no son contiguos en el tapete`);
      }
      return pair;
    },
    covers: (selection, number) => selection[0] === number || selection[1] === number,
    numbers: (selection) => selection,
    describe: (selection) => `Caballo ${selection.join("/")}`,
  },

  street: {
    id: "street",
    label: "Calle",
    payout: 11,
    size: 3,
    family: "inside",
    normalize: (selection) => {
      const trio = toNumbers(selection, 3, "Una calle");
      if (!isStreetTrio(trio)) {
        throw new Error(`Calle imposible: ${trio.join("/")} no forma una fila del tapete`);
      }
      return trio;
    },
    covers: (selection, number) => selection.includes(number),
    numbers: (selection) => selection,
    // The two trios that include the zero are not a row of the felt, so they
    // get the name a croupier would use.
    describe: (selection) =>
      selection[0] === 0 ? `Trío ${selection.join("/")}` : `Calle ${selection[0]}-${selection[2]}`,
  },

  corner: {
    id: "corner",
    label: "Cuadro",
    payout: 8,
    size: 4,
    family: "inside",
    normalize: (selection) => {
      const quad = toNumbers(selection, 4, "Un cuadro");
      if (!isCornerQuad(quad)) {
        throw new Error(`Cuadro imposible: ${quad.join("/")} no forma una esquina del tapete`);
      }
      return quad;
    },
    covers: (selection, number) => selection.includes(number),
    numbers: (selection) => selection,
    describe: (selection) =>
      selection[0] === 0 ? "Primeros cuatro 0/1/2/3" : `Cuadro ${selection.join("/")}`,
  },

  sixline: {
    id: "sixline",
    label: "Seisena",
    payout: 5,
    size: 6,
    family: "inside",
    normalize: (selection) => {
      const six = toNumbers(selection, 6, "Una seisena");
      if (!isSixLine(six)) {
        throw new Error(`Seisena imposible: ${six.join("/")} no son dos calles contiguas`);
      }
      return six;
    },
    covers: (selection, number) => selection.includes(number),
    numbers: (selection) => selection,
    describe: (selection) => `Seisena ${selection[0]}-${selection[5]}`,
  },

  column: {
    id: "column",
    label: "Columna",
    payout: 2,
    size: 12,
    family: "group",
    normalize: (selection) => toGroup(selection, "Una columna"),
    covers: (selection, number) => columnOf(number) === selection,
    numbers: (selection) => numbersOfColumn(selection),
    describe: (selection) => `${selection}ª columna`,
  },

  dozen: {
    id: "dozen",
    label: "Docena",
    payout: 2,
    size: 12,
    family: "group",
    normalize: (selection) => toGroup(selection, "Una docena"),
    covers: (selection, number) => dozenOf(number) === selection,
    numbers: (selection) => numbersOfDozen(selection),
    describe: (selection) => `${selection}ª docena`,
  },

  red: {
    id: "red",
    label: "Rojo",
    payout: 1,
    size: 18,
    family: "even",
    normalize: (selection) => toNothing(selection, "El rojo"),
    covers: (_selection, number) => RED.has(number),
    numbers: () => RED_NUMBERS,
    describe: () => "Rojo",
  },

  black: {
    id: "black",
    label: "Negro",
    payout: 1,
    size: 18,
    family: "even",
    normalize: (selection) => toNothing(selection, "El negro"),
    // The zero is green: it loses every even-money bet, which is the edge.
    covers: (_selection, number) => number !== 0 && !RED.has(number),
    numbers: () => Object.freeze(range(1, 36).filter((n) => !RED.has(n))),
    describe: () => "Negro",
  },

  odd: {
    id: "odd",
    label: "Impar",
    payout: 1,
    size: 18,
    family: "even",
    normalize: (selection) => toNothing(selection, "El impar"),
    covers: (_selection, number) => number !== 0 && number % 2 === 1,
    numbers: () => Object.freeze(range(1, 36).filter((n) => n % 2 === 1)),
    describe: () => "Impar",
  },

  even: {
    id: "even",
    label: "Par",
    payout: 1,
    size: 18,
    family: "even",
    normalize: (selection) => toNothing(selection, "El par"),
    covers: (_selection, number) => number !== 0 && number % 2 === 0,
    numbers: () => Object.freeze(range(1, 36).filter((n) => n % 2 === 0)),
    describe: () => "Par",
  },

  low: {
    id: "low",
    label: "Falta",
    payout: 1,
    size: 18,
    family: "even",
    normalize: (selection) => toNothing(selection, "La falta"),
    covers: (_selection, number) => number >= 1 && number <= 18,
    numbers: () => Object.freeze(range(1, 18)),
    describe: () => "Falta (1-18)",
  },

  high: {
    id: "high",
    label: "Pasa",
    payout: 1,
    size: 18,
    family: "even",
    normalize: (selection) => toNothing(selection, "La pasa"),
    covers: (_selection, number) => number >= 19,
    numbers: () => Object.freeze(range(19, 36)),
    describe: () => "Pasa (19-36)",
  },
});

// The invariant the whole RTP argument rests on. Checked at import time so a
// future edit to the paytable cannot quietly change the house edge.
for (const type of Object.values(BET_TYPES)) {
  if (type.size * (type.payout + 1) !== 36) {
    throw new Error(`${type.label} rompe el RTP: ${type.size} × ${type.payout + 1} ≠ 36`);
  }
}

/* --- Catalogues of legal compound bets ------------------------------------- */

/** Build a list and run it back through its own validator, so the generator
 *  and the checker can never drift apart. */
function checked(list, predicate, expected, what) {
  for (const selection of list) {
    if (!predicate(selection)) throw new Error(`${what}: selección ilegal ${selection.join("/")}`);
  }
  if (list.length !== expected) {
    throw new Error(`${what}: se esperaban ${expected} combinaciones, generadas ${list.length}`);
  }
  return Object.freeze(list.map((selection) => Object.freeze(selection)));
}

/** The 60 legal splits: 57 between numbers plus 0/1, 0/2 and 0/3. */
export const SPLITS = checked(
  (() => {
    const out = [];
    for (let a = 0; a <= 36; a++) {
      for (let b = a + 1; b <= 36; b++) if (isAdjacentPair([a, b])) out.push([a, b]);
    }
    return out;
  })(),
  isAdjacentPair,
  60,
  "Caballos"
);

/** The 12 rows of three plus the two trios with the zero. */
export const STREETS = checked(
  [[0, 1, 2], [0, 2, 3], ...range(0, 11).map((k) => [3 * k + 1, 3 * k + 2, 3 * k + 3])],
  isStreetTrio,
  14,
  "Calles"
);

/** The 22 corners plus the "primeros cuatro". */
export const CORNERS = checked(
  [
    [0, 1, 2, 3],
    ...range(1, 32).filter((a) => a % 3 !== 0).map((a) => [a, a + 1, a + 3, a + 4]),
  ],
  isCornerQuad,
  23,
  "Cuadros"
);

/** The 11 six-lines. */
export const SIXLINES = checked(
  range(0, 10).map((k) => range(3 * k + 1, 3 * k + 6)),
  isSixLine,
  11,
  "Seisenas"
);

/* --- Spin ------------------------------------------------------------------- */

/**
 * Drop the ball. Reads a single integer from stream position 0: the pocket
 * *index*, not the number, so the wheel order is what the randomness maps onto
 * and the UI can animate straight to `index`.
 *
 * @param {import('../core/rng.js').Round} round
 * @returns {{number: number, color: 'green'|'red'|'black', index: number}}
 */
export function spin(round) {
  const index = round.int(POCKETS, 0);
  const number = WHEEL[index];
  return { number, color: colorOf(number), index };
}

/* --- Bets ------------------------------------------------------------------- */

/** @param {{type:string}} bet */
function typeOf(bet) {
  const type = BET_TYPES[bet?.type];
  if (!type) throw new Error(`Tipo de apuesta desconocido: ${bet?.type}`);
  return type;
}

/**
 * Validate a bet and return it in canonical form. Amounts are integer minor
 * units — a float here would be a bug travelling towards the ledger.
 * @param {{type:string, selection?:any, amount:number}} bet
 */
export function validateBet(bet) {
  const type = typeOf(bet);
  const selection = type.normalize(bet.selection);
  const amount = bet.amount;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`El importe de ${type.label.toLowerCase()} debe ser un entero positivo en unidades menores`);
  }
  return { type: type.id, selection, amount };
}

/**
 * Does this bet win on `number`? Delegates to the type's own `covers`, so each
 * rule lives in exactly one place.
 * @param {{type:string, selection?:any}} bet
 * @param {number} number
 */
export function coversNumber(bet, number) {
  if (!isPocket(number)) throw new RangeError(`${number} no es una casilla de la ruleta`);
  const type = typeOf(bet);
  return type.covers(type.normalize(bet.selection), number);
}

/** Every pocket a bet covers — used to highlight the felt. */
export function betNumbers(bet) {
  const type = typeOf(bet);
  return type.numbers(type.normalize(bet.selection));
}

/** Spanish label for the bet slip. */
export function betLabel(bet) {
  const type = typeOf(bet);
  return type.describe(type.normalize(bet.selection));
}

/**
 * Stable identity of a betting spot, so two clicks on the same square stack
 * chips instead of creating a second bet.
 */
export function betKey(bet) {
  const type = typeOf(bet);
  const selection = type.normalize(bet.selection);
  if (selection == null) return type.id;
  return `${type.id}:${Array.isArray(selection) ? selection.join("-") : selection}`;
}

/** Sum of the amounts staked, in minor units. */
export function totalStake(bets) {
  return bets.reduce((sum, bet) => sum + validateBet(bet).amount, 0);
}

/**
 * Settle a whole layout against the winning number.
 *
 * `payout` is the **total return to the player**, stake included: a winning
 * straight up on 100 returns 3.600, a losing bet returns 0. That matches the
 * contract of `playRound()` / `openRound().settle()`, which credit the payout
 * after having already debited the whole stake.
 *
 * @param {Array<{type:string, selection?:any, amount:number}>} bets
 * @param {number} number the winning pocket
 * @returns {{payout:number, winning:Array<{index:number,type:string,selection:any,amount:number,odds:number,payout:number,profit:number}>}}
 */
export function payoutFor(bets, number) {
  if (!Array.isArray(bets)) throw new TypeError("payoutFor espera una lista de apuestas");
  if (!isPocket(number)) throw new RangeError(`${number} no es una casilla de la ruleta`);

  let payout = 0;
  const winning = [];

  bets.forEach((bet, index) => {
    const type = typeOf(bet);
    const { selection, amount } = validateBet(bet);
    if (!type.covers(selection, number)) return;

    // Odds are quoted "to 1", so the winner also gets the stake back.
    const returned = amount * (type.payout + 1);
    payout += returned;
    winning.push({
      index,
      type: type.id,
      selection,
      amount,
      odds: type.payout,
      payout: returned,
      profit: returned - amount,
    });
  });

  return { payout, winning };
}
