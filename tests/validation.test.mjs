/**
 * Checkout validation. These run against a customer at the point of payment, so
 * a false rejection loses a sale and a false acceptance produces an
 * undeliverable order. Both directions are tested.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRequired, validateEmail, validatePostalCode, validatePhone,
  validateCardNumber, detectCardBrand, luhn, formatCardNumber,
  validateExpiry, validateCvc, POSTAL_RULES,
} from "../shop/js/core/validation.js";

const ok = (result, context) => assert.equal(result.ok, true, `${context}: ${result.error ?? ""}`);
const bad = (result, context) => assert.equal(result.ok, false, `${context} should have been rejected`);

test("required fields reject blank and whitespace-only input", () => {
  ok(validateRequired("Ana"), "a real name");
  bad(validateRequired(""), "empty");
  bad(validateRequired("   "), "whitespace only");
  bad(validateRequired(null), "null");
  bad(validateRequired(undefined), "undefined");
});

test("email accepts real addresses and rejects malformed ones", () => {
  for (const value of [
    "cliente@ejemplo.es",
    "ana.ruiz+pedidos@correo.co.uk",
    "n@d.io",
    "usuario_123@sub.dominio.com",
  ]) ok(validateEmail(value), value);

  for (const value of [
    "", "sin-arroba.es", "@sindominio.com", "espacio en@medio.com",
    "doble@@arroba.com", "sin.tld@dominio", "acaba@en.", null,
  ]) bad(validateEmail(value), String(value));
});

test("Spanish postal codes follow the real five-digit rule", () => {
  for (const value of ["28013", "08001", "01001", "52080"]) ok(validatePostalCode(value, "ES"), value);
  // Spanish provinces run 01–52, so these are not deliverable.
  for (const value of ["1234", "123456", "abcde", "", "00000", "99999"]) {
    bad(validatePostalCode(value, "ES"), value);
  }
});

test("postal codes follow each country's own format", () => {
  ok(validatePostalCode("1000-001", "PT"), "Portuguese NNNN-NNN");
  bad(validatePostalCode("1000", "PT"), "Portuguese without the suffix");

  ok(validatePostalCode("75001", "FR"), "French");
  ok(validatePostalCode("10115", "DE"), "German");
  ok(validatePostalCode("00184", "IT"), "Italian");
  ok(validatePostalCode("SW1A 1AA", "GB"), "UK with a space");
  ok(validatePostalCode("06600", "MX"), "Mexican");

  bad(validatePostalCode("ABC", "FR"), "letters in a French code");
  bad(validatePostalCode("1234", "DE"), "four digits in a German code");
});

test("every country with a postal rule declares an example that its own rule accepts", () => {
  for (const [country, rule] of Object.entries(POSTAL_RULES)) {
    if (!rule.example) continue;
    ok(validatePostalCode(rule.example, country), `${country} example ${rule.example}`);
  }
});

test("an unknown country falls back to a permissive rule rather than blocking the sale", () => {
  ok(validatePostalCode("12345", "ZZ"), "unknown country");
  bad(validatePostalCode("", "ZZ"), "still requires something");
});

test("phone numbers accept the formats customers actually type", () => {
  for (const value of ["600123456", "600 12 34 56", "+34 600 123 456", "+34600123456"]) {
    ok(validatePhone(value, "ES"), value);
  }
  for (const value of ["123", "abcdefghi", ""]) bad(validatePhone(value, "ES"), value);
});

test("Luhn accepts the standard test numbers and rejects tampered ones", () => {
  // The published test card numbers every processor documents.
  for (const value of [
    "4242424242424242",   // Visa
    "4000056655665556",   // Visa debit
    "5555555555554444",   // Mastercard
    "5200828282828210",   // Mastercard debit
    "378282246310005",    // American Express
    "6011111111111117",   // Discover
  ]) assert.equal(luhn(value), true, `${value} should pass Luhn`);

  // A single altered digit must fail — that is the entire point of the checksum.
  for (const value of ["4242424242424241", "5555555555554443", "378282246310006"]) {
    assert.equal(luhn(value), false, `${value} should fail Luhn`);
  }
});

test("card validation reports why a number was rejected", () => {
  ok(validateCardNumber("4242 4242 4242 4242"), "spaced Visa");
  bad(validateCardNumber("4242424242424241"), "failed checksum");
  bad(validateCardNumber("42424242"), "too short");
  bad(validateCardNumber("4242abcd42424242"), "letters");
  bad(validateCardNumber(""), "empty");
});

test("card brands are detected from their prefixes", () => {
  assert.equal(detectCardBrand("4242424242424242"), "visa");
  assert.equal(detectCardBrand("5555555555554444"), "mastercard");
  assert.equal(detectCardBrand("378282246310005"), "amex");
  assert.equal(detectCardBrand("341111111111111"), "amex");
  assert.equal(detectCardBrand("9999999999999999"), "unknown");
  assert.equal(detectCardBrand(""), "unknown");
});

test("card numbers are grouped the way each brand prints them", () => {
  assert.equal(formatCardNumber("4242424242424242"), "4242 4242 4242 4242");
  // Amex prints 4-6-5, not 4-4-4-4.
  assert.equal(formatCardNumber("378282246310005"), "3782 822463 10005");
  assert.equal(formatCardNumber("4242"), "4242", "partial input formats as typed");
});

test("expiry rejects the past and accepts the current month", () => {
  const now = Date.UTC(2026, 5, 15); // June 2026

  ok(validateExpiry("06", "26", now), "the current month is still valid");
  ok(validateExpiry("12", "26", now), "later this year");
  ok(validateExpiry("01", "30", now), "a future year");

  bad(validateExpiry("05", "26", now), "last month");
  bad(validateExpiry("12", "25", now), "last year");
  bad(validateExpiry("13", "27", now), "month 13");
  bad(validateExpiry("00", "27", now), "month 0");
  bad(validateExpiry("", "27", now), "no month");
});

test("CVC length follows the brand", () => {
  ok(validateCvc("123", "visa"), "3 digits on Visa");
  ok(validateCvc("1234", "amex"), "4 digits on Amex");
  bad(validateCvc("1234", "visa"), "4 digits on Visa");
  bad(validateCvc("123", "amex"), "3 digits on Amex");
  bad(validateCvc("12a", "visa"), "letters");
  bad(validateCvc("", "visa"), "empty");
});

test("every rejection carries a Spanish message the customer can act on", () => {
  const failures = [
    validateEmail("roto"),
    validatePostalCode("1", "ES"),
    validateCardNumber("4242424242424241"),
    validateExpiry("01", "20", Date.UTC(2026, 0, 1)),
    validateCvc("1", "visa"),
    validateRequired(""),
  ];
  for (const result of failures) {
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === "string" && result.error.length > 5, "needs a usable message");
    assert.ok(/[áéíóúñ¿ ]/.test(result.error), `"${result.error}" does not look like Spanish prose`);
  }
});
