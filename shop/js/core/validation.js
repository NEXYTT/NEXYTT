/**
 * Checkout validation.
 *
 * Pure functions: no DOM, no storage, no side effects. The checkout page is a
 * thin layer that calls these and paints the result, so the rules can be tested
 * under `node --test` and reused by any other form later.
 *
 * Every validator returns the same shape:
 *   { ok: true, value?: string }        `value` is the normalised input
 *   { ok: false, error: string }        message already written for the user
 *
 * Two rules of thumb behind the messages:
 *  - say what is wrong *and* what a correct value looks like ("Ejemplo: 28013"),
 *  - never blame the user for a format we could have normalised ourselves, so
 *    spacing, dashes and case are cleaned up before anything is rejected.
 */

const OK = Object.freeze({ ok: true });
const ok = (value) => (value === undefined ? OK : { ok: true, value });
const fail = (error) => ({ ok: false, error });

const text = (value) => String(value ?? "").trim();
const onlyDigits = (value) => String(value ?? "").replace(/\D+/g, "");
const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* --- Required ------------------------------------------------------------- */

/**
 * @param {unknown} value
 * @param {string} label written to slot into "Introduce ___" — pass an article
 *   ("tu nombre", "la dirección"), which is what makes the message read as
 *   Spanish instead of as a translated string.
 * @param {{min?: number, max?: number}} [opts]
 */
export function validateRequired(value, label = "este dato", { min = 1, max = 120 } = {}) {
  const clean = text(value);
  if (!clean) return fail(`Introduce ${label}.`);
  if (clean.length < min) return fail(`${capitalise(label)} debe tener al menos ${min} caracteres.`);
  if (clean.length > max) return fail(`${capitalise(label)} no puede pasar de ${max} caracteres.`);
  return ok(clean);
}

/* --- Email ---------------------------------------------------------------- */

// Deliberately not RFC 5322: that grammar accepts addresses no mail provider
// would ever issue. This covers the shape of every deliverable address and
// rejects the four real typos (no @, no domain, no TLD, a stray space).
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function validateEmail(value) {
  const clean = text(value).toLowerCase();
  if (!clean) return fail("Introduce tu correo electrónico.");
  if (clean.length > 254) return fail("Ese correo es demasiado largo.");
  if (!clean.includes("@")) return fail("Falta la arroba: el correo tiene el formato nombre@dominio.com.");
  if (!EMAIL_RE.test(clean)) return fail("Ese correo no parece válido. Revisa el formato: nombre@dominio.com.");

  // A domain that ends in digits or a one-letter label is never a real TLD.
  const tld = clean.split(".").pop();
  if (!/^[a-z]{2,}$/.test(tld)) return fail("El dominio del correo no parece válido (revisa la parte final).");

  return ok(clean);
}

/* --- Postal codes --------------------------------------------------------- */

const collapse = (value) => text(value).toUpperCase().replace(/\s+/g, " ");

/**
 * Real per-country rules. `test` runs on the normalised value, so each pattern
 * describes the canonical form only.
 */
export const POSTAL_RULES = {
  ES: {
    country: "España",
    example: "28013",
    hint: "5 dígitos y empieza por el número de provincia (01 a 52)",
    // The first two digits are the province (01 Álava … 52 Melilla). 00xxx and
    // anything from 53xxx up does not exist, so length alone is not enough.
    test: (v) => /^\d{5}$/.test(v) && Number(v.slice(0, 2)) >= 1 && Number(v.slice(0, 2)) <= 52,
  },
  PT: {
    country: "Portugal",
    example: "1000-205",
    hint: "4 dígitos, guion y 3 dígitos",
    test: (v) => /^\d{4}-\d{3}$/.test(v),
    // Portuguese codes are dictated as seven digits; insert the dash ourselves.
    // Only when the whole input is those seven digits — silently dropping any
    // other character would turn a typo into an accepted address.
    normalise: (v) => {
      const raw = collapse(v).replace(/\s+/g, "");
      return /^\d{7}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    },
  },
  FR: {
    country: "Francia",
    example: "75008",
    hint: "5 dígitos",
    // 00xxx is unassigned; 99xxx is reserved for the armed forces abroad.
    test: (v) => /^\d{5}$/.test(v) && Number(v) >= 1000 && Number(v) <= 98999,
  },
  DE: {
    country: "Alemania",
    example: "10115",
    hint: "5 dígitos",
    test: (v) => /^\d{5}$/.test(v) && Number(v) >= 1067,
  },
  IT: {
    country: "Italia",
    example: "00184",
    hint: "5 dígitos",
    test: (v) => /^\d{5}$/.test(v),
  },
  NL: {
    country: "Países Bajos",
    example: "1012 AB",
    hint: "4 dígitos y 2 letras",
    test: (v) => /^\d{4} [A-Z]{2}$/.test(v),
    normalise: (v) => {
      const raw = collapse(v).replace(/\s+/g, "");
      return /^\d{4}[A-Z]{2}$/.test(raw) ? `${raw.slice(0, 4)} ${raw.slice(4)}` : collapse(v);
    },
  },
  BE: {
    country: "Bélgica",
    example: "1000",
    hint: "4 dígitos",
    test: (v) => /^\d{4}$/.test(v),
  },
  GB: {
    country: "Reino Unido",
    example: "SW1A 1AA",
    hint: "letras y números, con espacio antes de los tres últimos caracteres",
    // Outward code + inward code. The inward code is always digit + 2 letters.
    test: (v) => /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(v),
    normalise: (v) => {
      const raw = collapse(v).replace(/\s+/g, "");
      return raw.length >= 5 && raw.length <= 7 ? `${raw.slice(0, -3)} ${raw.slice(-3)}` : collapse(v);
    },
  },
  MX: {
    country: "México",
    example: "06600",
    hint: "5 dígitos",
    test: (v) => /^\d{5}$/.test(v),
  },
  AR: {
    country: "Argentina",
    example: "C1425DKE",
    hint: "CPA de 8 caracteres (o los 4 dígitos antiguos)",
    // Both forms are still in circulation: the 1998 CPA and the legacy 4-digit code.
    test: (v) => /^[A-Z]\d{4}[A-Z]{3}$/.test(v) || /^\d{4}$/.test(v),
    normalise: (v) => collapse(v).replace(/\s+/g, ""),
  },
  CL: {
    country: "Chile",
    example: "8320000",
    hint: "7 dígitos",
    test: (v) => /^\d{7}$/.test(v),
  },
  CO: {
    country: "Colombia",
    example: "110111",
    hint: "6 dígitos",
    test: (v) => /^\d{6}$/.test(v),
  },
  US: {
    country: "Estados Unidos",
    example: "10001",
    hint: "5 dígitos (o ZIP+4)",
    test: (v) => /^\d{5}(-\d{4})?$/.test(v),
    normalise: (v) => collapse(v).replace(/\s+/g, ""),
  },
};

/** Fallback for a destination with no table entry: something short and printable. */
const GENERIC_POSTAL = {
  country: "ese país",
  example: "1234",
  hint: "entre 3 y 10 caracteres",
  test: (v) => /^[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]$/.test(v),
};

export const postalRuleFor = (country) => POSTAL_RULES[country] ?? GENERIC_POSTAL;

/**
 * @param {string} value
 * @param {string} country ISO-3166 alpha-2
 */
export function validatePostalCode(value, country) {
  const rule = postalRuleFor(country);
  const clean = (rule.normalise ?? collapse)(value);
  if (!clean) return fail("Introduce el código postal.");
  if (!rule.test(clean)) {
    return fail(`Un código postal de ${rule.country} tiene ${rule.hint}. Ejemplo: ${rule.example}.`);
  }
  return ok(clean);
}

/* --- Phone ---------------------------------------------------------------- */

/**
 * `cc` is the calling code, `national` the pattern once the prefix and any
 * trunk zero are gone. Patterns stay generous on landlines — refusing a valid
 * number costs a sale, and the courier only needs to be able to dial it.
 */
export const PHONE_RULES = {
  ES: { cc: "34", national: /^[6-9]\d{8}$/, example: "612 345 678" },
  PT: { cc: "351", national: /^[239]\d{8}$/, example: "912 345 678" },
  FR: { cc: "33", national: /^[1-9]\d{8}$/, example: "06 12 34 56 78" },
  DE: { cc: "49", national: /^[1-9]\d{5,11}$/, example: "030 123456" },
  IT: { cc: "39", national: /^(3\d{8,9}|0\d{5,10})$/, example: "312 345 6789" },
  NL: { cc: "31", national: /^[1-9]\d{8}$/, example: "06 12345678" },
  BE: { cc: "32", national: /^[1-9]\d{7,8}$/, example: "0470 12 34 56" },
  GB: { cc: "44", national: /^[1-9]\d{8,9}$/, example: "07700 900123" },
  MX: { cc: "52", national: /^1?\d{10}$/, example: "55 1234 5678" },
  AR: { cc: "54", national: /^9?\d{10}$/, example: "11 1234 5678" },
  CL: { cc: "56", national: /^[2-9]\d{8}$/, example: "9 1234 5678" },
  CO: { cc: "57", national: /^[1-9]\d{7,9}$/, example: "300 1234567" },
  US: { cc: "1", national: /^[2-9]\d{9}$/, example: "(212) 555-0123" },
};

export function validatePhone(value, country) {
  const raw = text(value);
  // The courier needs a reachable number: a missing phone is a failed delivery,
  // not a cosmetic gap, so it is required rather than optional.
  if (!raw) return fail("Introduce un teléfono: el transportista lo necesita para entregar el pedido.");
  if (!/^\+?[\d\s().-]+$/.test(raw)) {
    return fail("El teléfono solo puede llevar números, espacios y el prefijo +.");
  }

  const rule = PHONE_RULES[country];
  let digits = onlyDigits(raw);

  if (rule) {
    // Accept +34…, 0034… and the bare national number, all as the same thing.
    if (digits.startsWith(`00${rule.cc}`)) digits = digits.slice(2 + rule.cc.length);
    else if (raw.startsWith("+") && digits.startsWith(rule.cc)) digits = digits.slice(rule.cc.length);
    // Trunk zero: dropped in the international form almost everywhere — but not
    // in Italy, where the leading 0 of a landline is part of the number. So try
    // both readings and keep whichever the country's rule accepts.
    const stripped = digits.startsWith("0") ? digits.slice(1) : digits;
    const national = [digits, stripped].find((candidate) => rule.national.test(candidate));

    if (!national) {
      return fail(`Ese teléfono no encaja con el formato del país. Ejemplo: ${rule.example}.`);
    }
    return ok(`+${rule.cc}${national}`);
  }

  if (digits.length < 6 || digits.length > 15) {
    return fail("Un teléfono tiene entre 6 y 15 dígitos.");
  }
  return ok(raw.startsWith("+") ? `+${digits}` : digits);
}

/* --- Cards ---------------------------------------------------------------- */

export const BRAND_LABEL = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  unknown: "Tarjeta",
};

/** Accepted lengths per brand, and how the digits are grouped on screen. */
const BRAND_SPEC = {
  visa: { lengths: [13, 16, 19], groups: [4, 4, 4, 4, 3], cvc: 3 },
  mastercard: { lengths: [16], groups: [4, 4, 4, 4], cvc: 3 },
  amex: { lengths: [15], groups: [4, 6, 5], cvc: 4 },
  unknown: { lengths: [12, 13, 14, 15, 16, 17, 18, 19], groups: [4, 4, 4, 4, 3], cvc: 3 },
};

export const brandSpec = (brand) => BRAND_SPEC[brand] ?? BRAND_SPEC.unknown;

/**
 * Brand from the IIN prefix. Works on a partial number too, so the UI can show
 * the logo while the customer is still typing.
 * @returns {'visa'|'mastercard'|'amex'|'unknown'}
 */
export function detectCardBrand(value) {
  const d = onlyDigits(value);
  if (!d) return "unknown";
  if (d[0] === "4") return "visa";
  if (/^3[47]/.test(d)) return "amex";
  if (/^5[1-5]/.test(d)) return "mastercard";
  if (d[0] === "2") {
    // Mastercard's 2-series is the range 222100–272099, i.e. 2221–2720 on the
    // first four digits. Pad the partial input both ways and see whether the
    // window it still could land in overlaps that range.
    const head = d.slice(0, 4);
    const low = Number(head.padEnd(4, "0"));
    const high = Number(head.padEnd(4, "9"));
    if (high >= 2221 && low <= 2720) return "mastercard";
  }
  return "unknown";
}

/**
 * Luhn (mod-10) checksum. Every card scheme in use writes its check digit this
 * way, so a single mistyped digit is caught before the request leaves the page.
 */
export function luhn(value) {
  const d = onlyDigits(value);
  if (d.length < 2) return false;

  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9; // 12 → 1+2 = 3, which is the same as subtracting 9
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function validateCardNumber(value) {
  const raw = text(value);
  if (!raw) return fail("Introduce el número de la tarjeta.");
  if (/[^\d\s-]/.test(raw)) return fail("El número de la tarjeta solo puede llevar dígitos.");

  const digits = onlyDigits(raw);
  const brand = detectCardBrand(digits);
  const spec = brandSpec(brand);

  if (!spec.lengths.includes(digits.length)) {
    const expected = spec.lengths.join(" o ");
    return brand === "unknown"
      ? fail(`Un número de tarjeta tiene entre 13 y 19 dígitos; has escrito ${digits.length}.`)
      : fail(`Una tarjeta ${BRAND_LABEL[brand]} tiene ${expected} dígitos; has escrito ${digits.length}.`);
  }

  if (!luhn(digits)) return fail("Ese número de tarjeta no es válido. Revisa los dígitos.");

  return { ok: true, value: digits, brand, last4: digits.slice(-4) };
}

/** Group the digits the way the brand prints them on the plastic. */
export function formatCardNumber(value, brand = detectCardBrand(value)) {
  const spec = brandSpec(brand);
  const max = Math.max(...spec.lengths);
  const digits = onlyDigits(value).slice(0, max);

  const parts = [];
  let at = 0;
  for (const size of spec.groups) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  if (at < digits.length) parts.push(digits.slice(at));
  return parts.join(" ");
}

/**
 * Expiry. A card is valid **through the last day of its month**, so the cut-off
 * is the first instant of the following month, not the 1st of the same one.
 *
 * @param {string|number} mm 1–12
 * @param {string|number} yy two digits (25) or four (2025)
 * @param {number} now epoch ms, injectable so the test does not depend on today
 */
export function validateExpiry(mm, yy, now = Date.now()) {
  const rawMonth = text(mm);
  const rawYear = text(yy);
  if (!rawMonth || !rawYear) return fail("Introduce la fecha de caducidad (MM/AA).");
  if (!/^\d{1,2}$/.test(rawMonth) || !/^(\d{2}|\d{4})$/.test(rawYear)) {
    return fail("La caducidad va en formato MM/AA. Ejemplo: 04/29.");
  }

  const month = Number(rawMonth);
  if (month < 1 || month > 12) return fail("El mes de caducidad tiene que estar entre 01 y 12.");

  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const expiresAt = Date.UTC(year, month, 1); // first instant after the card dies
  const current = new Date(now);

  if (expiresAt <= Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate())) {
    return fail("Esa tarjeta está caducada.");
  }
  if (year > current.getUTCFullYear() + 20) return fail("Revisa el año de caducidad.");

  return { ok: true, value: `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`, month, year };
}

/** Amex prints a 4-digit code on the front; everyone else 3 on the back. */
export function validateCvc(value, brand = "unknown") {
  const raw = text(value);
  const expected = brandSpec(brand).cvc;
  if (!raw) return fail(`Introduce el CVC (${expected} dígitos).`);
  if (!/^\d+$/.test(raw)) return fail("El CVC solo lleva dígitos.");
  if (raw.length !== expected) {
    return brand === "amex"
      ? fail("El CVC de American Express son los 4 dígitos impresos en la parte delantera.")
      : fail("El CVC son los 3 dígitos del reverso de la tarjeta.");
  }
  return ok(raw);
}
