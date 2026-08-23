/**
 * Checkout validation rules.
 *
 * The two things worth guarding here are the ones a customer notices: a card
 * number that passes Luhn (so a typo is caught before "payment" is attempted)
 * and postal codes that follow each destination's real format instead of a
 * five-digit assumption borrowed from Spain.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateEmail,
  validatePostalCode,
  validatePhone,
  validateCardNumber,
  detectCardBrand,
  validateExpiry,
  validateCvc,
  validateRequired,
  formatCardNumber,
  luhn,
} from "../shop/js/core/validation.js";

/** Fixed clock: expiry assertions must not start failing with the calendar. */
const NOW = Date.UTC(2026, 7, 23); // 23 August 2026

test("Luhn accepts the published test numbers and rejects a single-digit typo", () => {
  // The classic gateway test cards. Every one of them satisfies mod-10.
  for (const pan of [
    "4242424242424242", // Visa
    "4000056655665556", // Visa debit
    "5555555555554444", // Mastercard
    "2223003122003222", // Mastercard 2-series
    "378282246310005", // American Express
  ]) {
    assert.equal(luhn(pan), true, `${pan} should pass Luhn`);
    assert.equal(validateCardNumber(pan).ok, true, `${pan} should validate`);
  }

  // Last digit changed: the checksum is exactly what catches this.
  assert.equal(luhn("4242424242424241"), false);
  const bad = validateCardNumber("4242424242424241");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /no es válido/);

  // Two digits transposed — the other error Luhn is designed to catch.
  assert.equal(luhn("4242424242424422"), false);
});

test("card numbers: spacing is tolerated, letters and wrong lengths are not", () => {
  const spaced = validateCardNumber("4242 4242 4242 4242");
  assert.equal(spaced.ok, true);
  assert.equal(spaced.value, "4242424242424242");
  assert.equal(spaced.last4, "4242");
  assert.equal(spaced.brand, "visa");

  assert.equal(validateCardNumber("").ok, false);
  assert.equal(validateCardNumber("4242abcd42424242").ok, false);
  // Right prefix, wrong length for the brand: rejected before Luhn runs.
  assert.equal(validateCardNumber("42424242424").ok, false);
  // Amex is 15 digits; 16 must not be accepted just because it is a common length.
  assert.equal(validateCardNumber("3782822463100050").ok, false);
});

test("brands are detected from the prefix, including partial input", () => {
  assert.equal(detectCardBrand("4"), "visa");
  assert.equal(detectCardBrand("4242 42"), "visa");
  assert.equal(detectCardBrand("34"), "amex");
  assert.equal(detectCardBrand("37"), "amex");
  assert.equal(detectCardBrand("5105105105105100"), "mastercard");
  assert.equal(detectCardBrand("2221"), "mastercard");
  assert.equal(detectCardBrand("2720"), "mastercard");
  assert.equal(detectCardBrand("2721"), "unknown"); // just above the 2-series
  assert.equal(detectCardBrand("6011000990139424"), "unknown"); // Discover: not accepted here
  assert.equal(detectCardBrand(""), "unknown");
});

test("the card number is grouped the way the brand prints it", () => {
  assert.equal(formatCardNumber("4242424242424242"), "4242 4242 4242 4242");
  assert.equal(formatCardNumber("378282246310005"), "3782 822463 10005"); // amex 4-6-5
  assert.equal(formatCardNumber("42424"), "4242 4");
});

test("postal codes follow each country's real format", () => {
  const cases = [
    // country, valid, invalid
    ["ES", "28013", "2801"],
    ["ES", "08001", "99013"], // 99 is not a Spanish province
    ["PT", "1000-205", "1000205X"],
    ["FR", "75008", "75 008 1"],
    ["DE", "10115", "1011"],
    ["IT", "00184", "184"],
    ["GB", "SW1A 1AA", "SW1A"],
    ["MX", "06600", "660"],
    ["NL", "1012 AB", "1012 A"],
    ["CL", "8320000", "83200"],
  ];

  for (const [country, good, wrong] of cases) {
    assert.equal(validatePostalCode(good, country).ok, true, `${good} should be valid in ${country}`);
    const bad = validatePostalCode(wrong, country);
    assert.equal(bad.ok, false, `${wrong} should be invalid in ${country}`);
    assert.ok(bad.error.length > 0);
  }

  // Normalisation: what the customer types is cleaned up, not rejected.
  assert.equal(validatePostalCode("1000205", "PT").value, "1000-205");
  assert.equal(validatePostalCode("sw1a1aa", "GB").value, "SW1A 1AA");
  assert.equal(validatePostalCode("1012ab", "NL").value, "1012 AB");
  assert.equal(validatePostalCode("  28013 ", "ES").value, "28013");

  // A country with no table entry still gets a sanity check.
  assert.equal(validatePostalCode("1234", "JP").ok, true);
  assert.equal(validatePostalCode("", "JP").ok, false);
});

test("phones accept the local and international spellings of the same number", () => {
  for (const written of ["612345678", "612 345 678", "+34 612 345 678", "0034612345678"]) {
    const result = validatePhone(written, "ES");
    assert.equal(result.ok, true, `${written} should be valid`);
    assert.equal(result.value, "+34612345678");
  }

  assert.equal(validatePhone("512345678", "ES").ok, false); // no Spanish number starts with 5
  assert.equal(validatePhone("61234", "ES").ok, false);
  assert.equal(validatePhone("", "ES").ok, false);
  assert.equal(validatePhone("6123abc78", "ES").ok, false);

  // Trunk zero is dropped in the international form.
  assert.equal(validatePhone("07700 900123", "GB").value, "+447700900123");
  assert.equal(validatePhone("+44 7700 900123", "GB").value, "+447700900123");
  assert.equal(validatePhone("5512345678", "MX").ok, true);
});

test("expiry is valid through the last day of its month", () => {
  assert.equal(validateExpiry("08", "26", NOW).ok, true); // this very month
  assert.equal(validateExpiry("09", "26", NOW).ok, true);
  assert.equal(validateExpiry("07", "26", NOW).ok, false); // last month
  assert.equal(validateExpiry("12", "25", NOW).ok, false);
  assert.equal(validateExpiry("13", "27", NOW).ok, false);
  assert.equal(validateExpiry("00", "27", NOW).ok, false);
  assert.equal(validateExpiry("", "", NOW).ok, false);
  assert.equal(validateExpiry("06", "60", NOW).ok, false); // implausibly far ahead
  assert.equal(validateExpiry("4", "29", NOW).value, "04/29"); // padded on the way out
});

test("CVC length depends on the brand", () => {
  assert.equal(validateCvc("123", "visa").ok, true);
  assert.equal(validateCvc("123", "mastercard").ok, true);
  assert.equal(validateCvc("1234", "visa").ok, false);
  assert.equal(validateCvc("1234", "amex").ok, true);
  assert.equal(validateCvc("123", "amex").ok, false);
  assert.equal(validateCvc("12a", "visa").ok, false);
  assert.equal(validateCvc("", "visa").ok, false);
});

test("emails: the four real typos are caught", () => {
  assert.equal(validateEmail("ana.ruiz+tienda@correo.es").ok, true);
  assert.equal(validateEmail("  ANA@Correo.ES ").value, "ana@correo.es"); // trimmed and lowercased
  assert.equal(validateEmail("anacorreo.es").ok, false); // no @
  assert.equal(validateEmail("ana@").ok, false); // no domain
  assert.equal(validateEmail("ana@correo").ok, false); // no TLD
  assert.equal(validateEmail("ana ruiz@correo.es").ok, false); // space
  assert.equal(validateEmail("").ok, false);
});

test("required fields report the field they belong to", () => {
  assert.equal(validateRequired("Ana", "tu nombre").ok, true);
  assert.equal(validateRequired("  Ana  ", "tu nombre").value, "Ana");
  assert.match(validateRequired("", "tu nombre").error, /tu nombre/);
  assert.equal(validateRequired("A", "tu nombre", { min: 2 }).ok, false);
  assert.equal(validateRequired("x".repeat(200), "la dirección", { max: 120 }).ok, false);
});
