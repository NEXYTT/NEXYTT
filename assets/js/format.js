/**
 * Display formatting. Locale-aware, allocation-conscious (formatters are
 * built once and reused — `Intl.NumberFormat` construction is the expensive
 * part, and these run inside animation loops).
 */

const DEFAULT_LOCALE = "es-ES";

const cache = new Map();
function numberFormat(locale, options) {
  const key = locale + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

/**
 * Money. Values are stored as integer minor units (cents / credits) everywhere
 * in this codebase — floats are never used to hold a balance — so this takes
 * minor units and divides once, at the display boundary.
 *
 * @param {number} minorUnits
 * @param {{currency?: string, locale?: string, decimals?: number}} [opts]
 */
export function money(minorUnits, opts = {}) {
  const { currency = "EUR", locale = DEFAULT_LOCALE, decimals = 2 } = opts;
  return numberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(minorUnits / 100);
}

/** Play-money credits: no currency symbol, grouped, 2 decimals. */
export function credits(minorUnits, { locale = DEFAULT_LOCALE } = {}) {
  return numberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/**
 * Compact form for big numbers. Note that Spanish spells the thousands unit out
 * ("12,4 mil"), so this only saves horizontal space from millions upward — use
 * it for readability at scale, not to squeeze a four-digit number into a chip.
 */
export function compact(value, { locale = DEFAULT_LOCALE } = {}) {
  return numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** @param {number} ratio 0.0725 → "7,25 %" */
export function percent(ratio, { locale = DEFAULT_LOCALE, decimals = 2 } = {}) {
  return numberFormat(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio);
}

/** Payout multiplier: 2 → "2.00×" */
export function multiplier(value, decimals = 2) {
  return `${value.toFixed(decimals)}×`;
}

/** @param {number} ts epoch ms */
export function dateTime(ts, { locale = DEFAULT_LOCALE } = {}) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ts));
}

/** @param {number} ts epoch ms */
export function dateOnly(ts, { locale = DEFAULT_LOCALE } = {}) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ts));
}

/** Elapsed time as mm:ss / h:mm:ss. */
export function duration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "hace 5 min" style relative time. */
export function relative(ts, { locale = DEFAULT_LOCALE, now = Date.now() } = {}) {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diff = ts - now;
  const units = [
    ["year", 31536e6],
    ["month", 2592e6],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
    ["second", 1e3],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms || unit === "second") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return rtf.format(0, "second");
}

/** Truncated hash for display: "e16bf228…b5f0de32" */
export function shortHash(hex, edge = 8) {
  if (!hex || hex.length <= edge * 2 + 1) return hex ?? "";
  return `${hex.slice(0, edge)}…${hex.slice(-edge)}`;
}
