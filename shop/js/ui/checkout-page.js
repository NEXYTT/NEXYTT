/**
 * Checkout: shipping details → payment → review, then the order is created.
 *
 * Design decisions worth stating:
 *
 * 1. **The form state is the source of truth, not the DOM.** Every step is torn
 *    down and rebuilt when you move between them, so anything typed lives in
 *    `state` and the inputs are rendered from it. That is what makes "back"
 *    lossless and what lets a step be validated while it is not on screen.
 * 2. **The draft is persisted, the card is not.** Shipping details survive a
 *    reload because losing them is the single most infuriating checkout bug.
 *    The PAN and the CVC never touch storage — a real integration hands them to
 *    the processor and keeps nothing, and a demo has no excuse to do worse.
 * 3. **Validation lives in `core/validation.js`.** This file decides *when* to
 *    validate and where the focus goes; it never decides what a valid postcode
 *    looks like.
 * 4. **Nothing is charged.** The payment step says so on screen, in the review
 *    and in the confirmation, because a form that looks like a real card form
 *    has to be unambiguous about being fake.
 */

import { el, $, replace, wait, toast } from "../../../assets/js/dom.js";
import { icon } from "../../../assets/js/icons.js";
import { money } from "../../../assets/js/format.js";
import { cart, store, products, saveOrder } from "../core/context.js";
import { createOrder, advanceOrder, routeToSuppliers } from "../core/orders.js";
import { vatRateFor } from "../core/pricing.js";
import {
  validateEmail,
  validatePhone,
  validatePostalCode,
  validateRequired,
  validateCardNumber,
  validateExpiry,
  validateCvc,
  detectCardBrand,
  formatCardNumber,
  brandSpec,
  postalRuleFor,
  BRAND_LABEL,
} from "../core/validation.js";
import { mountHeader, mountFooter, breadcrumbs } from "./shell.js";
import { productArt } from "./productArt.js";

/* --- Constants ------------------------------------------------------------ */

const DRAFT_KEY = "checkout";

/** Destinations we ship to. Each one has a real postcode and phone rule. */
const COUNTRIES = [
  { value: "ES", label: "España" },
  { value: "PT", label: "Portugal" },
  { value: "FR", label: "Francia" },
  { value: "DE", label: "Alemania" },
  { value: "IT", label: "Italia" },
  { value: "NL", label: "Países Bajos" },
  { value: "BE", label: "Bélgica" },
  { value: "GB", label: "Reino Unido" },
  { value: "MX", label: "México" },
  { value: "AR", label: "Argentina" },
  { value: "CL", label: "Chile" },
  { value: "CO", label: "Colombia" },
  { value: "US", label: "Estados Unidos" },
];

const COUNTRY_LABEL = Object.fromEntries(COUNTRIES.map((c) => [c.value, c.label]));

const STEPS = [
  { n: 1, label: "Datos de envío" },
  { n: 2, label: "Pago" },
  { n: 3, label: "Confirmación" },
];

const METHODS = [
  {
    id: "card",
    icon: "wallet",
    label: "Tarjeta de crédito o débito",
    detail: "Visa, Mastercard y American Express.",
  },
  {
    id: "paypal",
    icon: "shield",
    label: "PayPal",
    detail: "Aquí saltarías a PayPal para autorizar el pago y volverías a la tienda.",
  },
  {
    id: "transfer",
    icon: "package",
    label: "Transferencia bancaria",
    detail: "Te mandamos los datos por correo. El pedido sale cuando entra el dinero.",
  },
];

const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.id, m.label]));

/** The number every payment gateway publishes as its "always approved" card. */
const TEST_CARD = { number: "4242 4242 4242 4242", expiry: "04/30", cvc: "123" };

/* --- State ---------------------------------------------------------------- */

const BLANK_CUSTOMER = {
  email: "",
  firstName: "",
  lastName: "",
  phone: "",
  address: "",
  city: "",
  postalCode: "",
  country: "ES",
  notes: "",
};

const state = {
  step: 1,
  /** Furthest step visited: what the indicator lets you jump back forward to. */
  reached: 1,
  customer: { ...BLANK_CUSTOMER, country: cart.country ?? "ES" },
  method: "card",
  // Card fields stay in memory for the length of the visit: they survive going
  // back a step, and disappear on reload. See decision 2 at the top.
  card: { number: "", expiry: "", cvc: "", holder: "" },
};

/** Blocks the empty-cart view from flashing between `cart.clear()` and the redirect. */
let confirming = false;

function loadDraft() {
  const saved = store.get(DRAFT_KEY);
  if (!saved || typeof saved !== "object") return;

  state.customer = { ...state.customer, ...(saved.customer ?? {}) };
  if (!COUNTRY_LABEL[state.customer.country]) state.customer.country = "ES";
  if (METHOD_LABEL[saved.method]) state.method = saved.method;
  if (typeof saved.cardHolder === "string") state.card.holder = saved.cardHolder;

  // Restore the step, but never past what the restored data can support: the
  // card number is deliberately not persisted, so a reload on step 3 with a
  // card payment has to land back on step 2.
  const step = Number(saved.step);
  if (step === 2 || step === 3) state.step = step;
  if (state.step > 1 && shippingProblems().length) state.step = 1;
  if (state.step > 2 && paymentProblems().length) state.step = 2;
  state.reached = state.step;
}

function saveDraft() {
  store.set(DRAFT_KEY, {
    step: state.step,
    customer: state.customer,
    method: state.method,
    cardHolder: state.card.holder,
  });
}

/* --- Field factory -------------------------------------------------------- */

/**
 * One labelled control with its hint and error slot.
 *
 * Errors appear on blur and on submit, never on the first keystroke — flagging
 * "correo no válido" while somebody is halfway through typing it is noise. Once
 * a field has been flagged it re-validates live, so the error clears as soon as
 * the value is fixed.
 *
 * @returns {{name:string, node:HTMLElement, control:HTMLElement, validate:(o?:{force?:boolean})=>{ok:boolean}, setHint:(t:string)=>void}}
 */
function buildField(spec) {
  const id = `f-${spec.name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const hintNode = el("p.field__hint", { id: hintId }, spec.hint ?? "");
  const errorNode = el("p.field__error", { id: errorId, role: "alert" });

  let touched = false;

  const shared = {
    id,
    name: spec.name,
    autocomplete: spec.autocomplete ?? "off",
    "aria-describedby": `${hintId} ${errorId}`,
  };

  const onInput = (ev) => {
    if (spec.mask) maskInPlace(ev.target, spec.mask);
    spec.set(ev.target.value);
    spec.onInput?.(ev.target.value, api);
    if (touched) api.validate();
  };

  const onBlur = () => api.validate({ force: true });

  let control;
  if (spec.tag === "select") {
    control = el(
      "select.select",
      {
        ...shared,
        onchange: (ev) => {
          spec.set(ev.target.value);
          spec.onInput?.(ev.target.value, api);
        },
      },
      spec.options.map((o) =>
        el("option", { value: o.value, selected: o.value === spec.get() }, o.label)
      )
    );
  } else if (spec.tag === "textarea") {
    control = el("textarea.textarea", {
      ...shared,
      rows: 3,
      value: spec.get(),
      placeholder: spec.placeholder ?? "",
      oninput: onInput,
      onblur: onBlur,
    });
  } else {
    control = el("input.input", {
      ...shared,
      type: spec.type ?? "text",
      value: spec.get(),
      placeholder: spec.placeholder ?? "",
      inputmode: spec.inputmode,
      maxLength: spec.maxLength,
      oninput: onInput,
      onblur: onBlur,
    });
  }

  const node = el(`div.field${spec.full ? ".field--full" : ""}`, {}, [
    el("div.row.row--between", { style: { gap: "var(--space-2)" } }, [
      el("label.label", { for: id }, spec.label),
      spec.aside ?? null,
    ]),
    control,
    hintNode,
    errorNode,
  ]);

  const api = {
    name: spec.name,
    node,
    control,
    setHint(textValue) {
      hintNode.textContent = textValue;
    },
    validate({ force = false } = {}) {
      if (force) touched = true;
      const result = spec.validate ? spec.validate(spec.get()) : { ok: true };

      // Whatever a validator normalises (a lowercased email, "SW1A 1AA",
      // "+34612345678") becomes the value — one rule, no per-field exceptions.
      if (result.ok && result.value !== undefined) {
        spec.set(result.value);
        if (control.value !== result.value) control.value = result.value;
      }

      if (result.ok) {
        control.removeAttribute("aria-invalid");
        errorNode.textContent = "";
      } else {
        control.setAttribute("aria-invalid", "true");
        errorNode.textContent = result.error;
      }
      return result;
    },
  };

  return api;
}

/**
 * Reformat an input while it is being typed in, keeping the caret on the same
 * digit. Without the caret bookkeeping every inserted space would throw the
 * cursor to the end of the field.
 */
function maskInPlace(input, format) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBefore = (input.value.slice(0, caret).match(/\d/g) ?? []).length;
  const formatted = format(input.value);
  if (formatted === input.value) return;

  input.value = formatted;

  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < digitsBefore) {
    if (/\d/.test(formatted[pos])) seen++;
    pos++;
  }
  input.setSelectionRange(pos, pos);
}

/* --- Step 1: shipping ----------------------------------------------------- */

const SHIPPING_FIELDS = [
  {
    name: "email",
    label: "Correo electrónico",
    type: "email",
    full: true,
    autocomplete: "email",
    placeholder: "nombre@correo.com",
    hint: "Ahí te llega la confirmación y el número de seguimiento.",
    validate: (v) => validateEmail(v),
  },
  {
    name: "firstName",
    label: "Nombre",
    autocomplete: "given-name",
    validate: (v) => validateRequired(v, "tu nombre", { min: 2, max: 60 }),
  },
  {
    name: "lastName",
    label: "Apellidos",
    autocomplete: "family-name",
    validate: (v) => validateRequired(v, "tus apellidos", { min: 2, max: 80 }),
  },
  {
    name: "phone",
    label: "Teléfono",
    type: "tel",
    autocomplete: "tel",
    hint: "Solo para avisos del transportista.",
    // Checked against the country, but deliberately *not* rewritten into its
    // international form: the country can still change afterwards, and a number
    // typed as 912345678 that came back stamped "+34…" would then be rejected
    // for Portugal — where it was valid all along. It is canonicalised once, on
    // confirmation, when the destination is final.
    validate: (v) => {
      const result = validatePhone(v, state.customer.country);
      return result.ok ? { ok: true } : result;
    },
  },
  {
    name: "country",
    label: "País de envío",
    tag: "select",
    autocomplete: "country",
    options: COUNTRIES,
    hint: "Cambia el coste de envío y el IVA aplicado.",
    onInput: () => onCountryChange(),
    validate: () => ({ ok: true }),
  },
  {
    name: "address",
    label: "Dirección",
    full: true,
    autocomplete: "street-address",
    placeholder: "Calle, número, piso y puerta",
    validate: (v) => validateRequired(v, "la dirección", { min: 5, max: 120 }),
  },
  {
    name: "city",
    label: "Ciudad",
    autocomplete: "address-level2",
    validate: (v) => validateRequired(v, "la ciudad", { min: 2, max: 60 }),
  },
  {
    name: "postalCode",
    label: "Código postal",
    autocomplete: "postal-code",
    inputmode: "numeric",
    maxLength: 12,
    validate: (v) => validatePostalCode(v, state.customer.country),
  },
  {
    name: "notes",
    label: "Notas para la entrega (opcional)",
    tag: "textarea",
    full: true,
    placeholder: "Portal, horario preferido, punto de recogida…",
    validate: (v) =>
      String(v ?? "").trim() ? validateRequired(v, "las notas", { max: 280 }) : { ok: true },
  },
].map((spec) => ({
  ...spec,
  get: () => state.customer[spec.name],
  set: (value) => {
    state.customer[spec.name] = value;
    saveDraft();
  },
}));

/** Handles for the fields currently on screen, so submit can move the focus. */
let liveFields = new Map();

/** Validation of step 1 against `state`, usable while the step is not rendered. */
const shippingProblems = () =>
  SHIPPING_FIELDS.map((spec) => ({ spec, result: spec.validate(state.customer[spec.name]) })).filter(
    (entry) => !entry.result.ok
  );

const postalHint = () => {
  const rule = postalRuleFor(state.customer.country);
  return `Ejemplo para ${rule.country}: ${rule.example}.`;
};

/**
 * Country drives shipping cost, VAT and both the postcode and phone rules, so
 * changing it re-prices the cart and re-checks the two fields that depend on it.
 */
function onCountryChange() {
  cart.setCountry(state.customer.country);

  const postal = liveFields.get("postalCode");
  postal?.setHint(postalHint());
  // Only re-check fields that already have something in them: turning an empty
  // form red because the customer picked a country would be backwards.
  if (state.customer.postalCode) postal?.validate({ force: true });
  const phone = liveFields.get("phone");
  if (state.customer.phone) phone?.validate({ force: true });
  // The summary repaints on its own: `setCountry` commits and the cart emits.
}

function stepShipping() {
  liveFields = new Map();
  const fields = SHIPPING_FIELDS.map((spec) => {
    const field = buildField(spec);
    liveFields.set(spec.name, field);
    return field;
  });
  liveFields.get("postalCode").setHint(postalHint());

  return el("section.card.card--pad", { "aria-labelledby": "step-title" }, [
    stepHeading("1. Datos de envío", "Dónde mandamos el paquete y cómo te avisamos."),
    el("div.form-grid", { style: { marginTop: "var(--space-5)" } }, fields.map((f) => f.node)),
    stepActions({
      back: { href: "cart.html", label: "Volver al carrito" },
      next: { label: "Continuar al pago", onClick: submitShipping },
    }),
  ]);
}

function submitShipping() {
  let firstBad = null;
  for (const field of liveFields.values()) {
    const result = field.validate({ force: true });
    if (!result.ok && !firstBad) firstBad = field;
  }

  if (firstBad) {
    firstBad.control.focus();
    toast("Revisa los campos marcados en rojo.", { variant: "warn", title: "Faltan datos" });
    return;
  }
  goTo(2);
}

/* --- Step 2: payment ------------------------------------------------------- */

const cardBrand = () => detectCardBrand(state.card.number);

const expiryParts = () => {
  const [mm = "", yy = ""] = String(state.card.expiry ?? "").split("/");
  return { mm: mm.trim(), yy: yy.trim() };
};

/** Card-only checks, against `state`, usable while the step is not rendered. */
function paymentProblems() {
  if (state.method !== "card") return [];
  const brand = cardBrand();
  const { mm, yy } = expiryParts();
  return [
    { name: "cardNumber", result: validateCardNumber(state.card.number) },
    { name: "cardExpiry", result: validateExpiry(mm, yy) },
    { name: "cardCvc", result: validateCvc(state.card.cvc, brand) },
    { name: "cardHolder", result: validateRequired(state.card.holder, "el titular de la tarjeta", { min: 3 }) },
  ].filter((entry) => !entry.result.ok);
}

/** The one thing on this page that must never be mistaken for a real payment. */
const simulationNotice = () =>
  el("div.panel", {
    style: {
      borderColor: "var(--warn)",
      background: "var(--warn-soft)",
      display: "flex",
      gap: "var(--space-3)",
      alignItems: "flex-start",
    },
  }, [
    el("span", { style: { color: "var(--warn)", flex: "0 0 auto" }, "aria-hidden": "true" }, [icon("info")]),
    el("div", {}, [
      el("strong", { style: { display: "block" } }, "Pago simulado: no se cobra nada"),
      el("p.text-sm", { style: { marginTop: "var(--space-1)" } },
        "Esta tienda es una demostración. No introduzcas los datos de una tarjeta real: " +
        "usa el número de prueba 4242 4242 4242 4242 con cualquier caducidad futura y cualquier CVC."),
    ]),
  ]);

function methodButton(method) {
  const selected = state.method === method.id;
  return el("button.pay-method", {
    type: "button",
    "aria-pressed": String(selected),
    style: { width: "100%", textAlign: "left" },
    onclick: () => {
      if (state.method === method.id) return;
      state.method = method.id;
      saveDraft();
      renderStep();
    },
  }, [
    el("span", { "aria-hidden": "true", style: { color: "var(--accent)", flex: "0 0 auto" } }, [icon(method.icon)]),
    el("span", { style: { minWidth: "0" } }, [
      el("span", { style: { display: "block", fontWeight: "650" } }, method.label),
      el("span.text-sm.muted", { style: { display: "block" } }, method.detail),
    ]),
    el("span.spacer"),
    selected ? el("span", { "aria-hidden": "true", style: { color: "var(--accent)" } }, [icon("check")]) : null,
  ]);
}

function cardForm() {
  const brandBadge = el("span.badge", { id: "card-brand", "aria-live": "polite" }, "Sin detectar");
  const paintBrand = () => {
    const brand = cardBrand();
    brandBadge.textContent = brand === "unknown" ? "Sin detectar" : BRAND_LABEL[brand];
    brandBadge.className = brand === "unknown" ? "badge" : "badge badge--accent";
    // Amex asks for four CVC digits, everyone else three.
    const cvc = liveFields.get("cardCvc");
    if (cvc) {
      cvc.control.maxLength = brandSpec(brand).cvc;
      cvc.setHint(brand === "amex" ? "4 dígitos en la parte delantera." : "3 dígitos del reverso.");
    }
  };

  const specs = [
    {
      name: "cardNumber",
      label: "Número de tarjeta",
      full: true,
      autocomplete: "cc-number",
      inputmode: "numeric",
      placeholder: "4242 4242 4242 4242",
      maxLength: 23, // 19 digits + 4 separators, the widest card in circulation
      aside: brandBadge,
      mask: (value) => formatCardNumber(value),
      get: () => state.card.number,
      set: (value) => void (state.card.number = value),
      onInput: () => paintBrand(),
      // The validator's canonical value is the bare digit string, which is what
      // the payload wants and the opposite of what the field should show — keep
      // the grouped form on screen instead of un-formatting it on blur.
      validate: (v) => {
        const result = validateCardNumber(v);
        return result.ok ? { ...result, value: formatCardNumber(result.value, result.brand) } : result;
      },
    },
    {
      name: "cardExpiry",
      label: "Caducidad",
      autocomplete: "cc-exp",
      inputmode: "numeric",
      placeholder: "MM/AA",
      maxLength: 5,
      // Never leaves a trailing slash, so backspacing works without a special case.
      mask: (value) => {
        const d = value.replace(/\D+/g, "").slice(0, 4);
        return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
      },
      get: () => state.card.expiry,
      set: (value) => void (state.card.expiry = value),
      validate: (v) => {
        const [mm = "", yy = ""] = String(v).split("/");
        return validateExpiry(mm.trim(), yy.trim());
      },
    },
    {
      name: "cardCvc",
      label: "CVC",
      autocomplete: "cc-csc",
      inputmode: "numeric",
      placeholder: "123",
      maxLength: brandSpec(cardBrand()).cvc,
      mask: (value) => value.replace(/\D+/g, "").slice(0, 4),
      get: () => state.card.cvc,
      set: (value) => void (state.card.cvc = value),
      validate: (v) => validateCvc(v, cardBrand()),
    },
    {
      name: "cardHolder",
      label: "Titular de la tarjeta",
      full: true,
      autocomplete: "cc-name",
      placeholder: "Tal y como aparece en la tarjeta",
      get: () => state.card.holder,
      set: (value) => {
        state.card.holder = value;
        saveDraft(); // the holder's name is not card data — it is just a name
      },
      validate: (v) => validateRequired(v, "el titular de la tarjeta", { min: 3, max: 80 }),
    },
  ];

  const fields = specs.map((spec) => {
    const field = buildField(spec);
    liveFields.set(spec.name, field);
    return field;
  });

  paintBrand();

  return el("div.stack", { style: { "--stack-gap": "var(--space-4)" } }, [
    el("div.form-grid", {}, fields.map((f) => f.node)),
    el("div.row.row--wrap", {}, [
      el("button.btn.btn--ghost.btn--sm", {
        type: "button",
        onclick: () => {
          Object.assign(state.card, {
            number: TEST_CARD.number,
            expiry: TEST_CARD.expiry,
            cvc: TEST_CARD.cvc,
            holder: state.card.holder || `${state.customer.firstName} ${state.customer.lastName}`.trim(),
          });
          saveDraft();
          renderStep();
          toast("Rellenado con la tarjeta de prueba.", { title: "Datos de prueba" });
        },
      }, "Rellenar con la tarjeta de prueba"),
      el("span.text-xs.subtle", {}, "No guardamos el número ni el CVC en el navegador."),
    ]),
  ]);
}

/** Copy for the two methods that have no form of their own. */
function methodNote(method) {
  const body = method === "paypal"
    ? "En una tienda real saltarías ahora a PayPal para autorizar el pago y volverías aquí con la compra confirmada. En esta demostración la vuelta es inmediata y no se cobra nada."
    : "Te enviaríamos por correo el número de cuenta y el importe exacto. El pedido se prepara cuando el banco confirma la transferencia; aquí lo damos por confirmado al instante para que puedas ver el resto del proceso.";
  return el("div.panel", {}, [el("p.text-sm", {}, body)]);
}

function stepPayment() {
  liveFields = new Map();

  return el("section.card.card--pad", { "aria-labelledby": "step-title" }, [
    stepHeading("2. Pago", "Elige cómo quieres pagar. Nada de esto genera un cobro real."),
    el("div.stack", { style: { marginTop: "var(--space-5)", "--stack-gap": "var(--space-4)" } }, [
      simulationNotice(),
      el("div.stack", { style: { "--stack-gap": "var(--space-3)" } }, METHODS.map(methodButton)),
      state.method === "card" ? cardForm() : methodNote(state.method),
    ]),
    stepActions({
      back: { label: "Volver a los datos de envío", onClick: () => goTo(1) },
      next: { label: "Revisar el pedido", onClick: submitPayment },
    }),
  ]);
}

function submitPayment() {
  if (state.method !== "card") {
    goTo(3);
    return;
  }

  let firstBad = null;
  for (const field of liveFields.values()) {
    const result = field.validate({ force: true });
    if (!result.ok && !firstBad) firstBad = field;
  }

  if (firstBad) {
    firstBad.control.focus();
    toast("Revisa los datos de la tarjeta.", { variant: "warn", title: "Pago incompleto" });
    return;
  }
  goTo(3);
}

/* --- Step 3: review -------------------------------------------------------- */

/** How the chosen method reads on the review and on the order record. */
function paymentSummary() {
  if (state.method !== "card") return METHOD_LABEL[state.method];
  const result = validateCardNumber(state.card.number);
  return result.ok ? `${BRAND_LABEL[result.brand]} ···· ${result.last4}` : "Tarjeta";
}

function paymentPayload() {
  if (state.method !== "card") return { method: state.method, last4: null, brand: null };
  const result = validateCardNumber(state.card.number);
  // Only the last four ever leave this page — `createOrder` refuses to keep more.
  return { method: "card", last4: result.ok ? result.last4 : null, brand: result.ok ? result.brand : null };
}

/** Product art for a cart line, falling back to the catalogue for older lines. */
function lineArt(line) {
  const product = products.find((p) => p.id === line.productId);
  const source = product ?? (line.art ? { id: line.productId, title: line.title, art: line.art } : null);
  return source ? productArt(source) : "";
}

function reviewBlock(title, rows, { onEdit, editLabel }) {
  return el("div.panel", { style: { minWidth: "0" } }, [
    el("div.row.row--between", {}, [
      el("h3", { style: { fontSize: "var(--text-md)" } }, title),
      el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: onEdit, "aria-label": editLabel }, "Editar"),
    ]),
    el("dl", { style: { marginTop: "var(--space-3)", display: "grid", gap: "var(--space-2)" } },
      rows.filter(Boolean).flatMap(([label, value]) => [
        el("dt.eyebrow", { style: { marginBottom: "calc(var(--space-1) * -1)" } }, label),
        el("dd.text-sm", { style: { margin: 0, wordBreak: "break-word" } }, value),
      ])
    ),
  ]);
}

function stepReview() {
  liveFields = new Map();
  const totals = cart.totals();
  const { customer } = state;

  const confirmButton = el("button.btn.btn--primary.btn--lg.btn--block", {
    type: "button",
    onclick: (ev) => confirmOrder(ev.currentTarget),
  }, "Confirmar pedido");

  return el("section.card.card--pad", { "aria-labelledby": "step-title" }, [
    stepHeading("3. Confirmación", "Última revisión antes de crear el pedido."),

    el("div.stack", { style: { marginTop: "var(--space-5)", "--stack-gap": "var(--space-4)" } }, [
      el("div", { style: { display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" } }, [
        reviewBlock("Envío", [
          [`${customer.firstName} ${customer.lastName}`, customer.address],
          ["Localidad", `${customer.postalCode} ${customer.city} · ${COUNTRY_LABEL[customer.country]}`],
          ["Contacto", `${customer.email} · ${customer.phone}`],
          customer.notes ? ["Notas", customer.notes] : null,
        ], { onEdit: () => goTo(1), editLabel: "Editar los datos de envío" }),

        reviewBlock("Pago", [
          ["Método", paymentSummary()],
          state.method === "card" && state.card.holder ? ["Titular", state.card.holder] : null,
          ["Estado", "Simulado: no se realiza ningún cargo"],
        ], { onEdit: () => goTo(2), editLabel: "Editar el método de pago" }),
      ]),

      el("div", {}, [
        el("h3", { style: { fontSize: "var(--text-md)" } }, `Artículos (${totals.count})`),
        el("ul", { style: { listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" } },
          cart.lines.map((line) => reviewLine(line))),
      ]),

      totalsTable(totals),

      el("p.text-xs.subtle", {},
        "Al confirmar se crea un pedido de demostración con su referencia, se reparte entre los proveedores " +
        "correspondientes y podrás seguirlo desde «Mis pedidos». No se procesa ningún cobro."),

      confirmButton,

      el("div.row.row--wrap", { style: { justifyContent: "center" } }, [
        el("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => goTo(2) }, "Volver al pago"),
      ]),
    ]),
  ]);
}

function reviewLine(line) {
  return el("li", {
    style: {
      display: "grid",
      gridTemplateColumns: "56px minmax(0, 1fr) auto",
      gap: "var(--space-3)",
      alignItems: "center",
      padding: "var(--space-3) 0",
      borderTop: "1px solid var(--border)",
    },
  }, [
    el("span", {
      "aria-hidden": "true",
      html: lineArt(line),
      style: { aspectRatio: "1", borderRadius: "var(--radius-md)", overflow: "hidden", background: "var(--bg-elev-2)" },
    }),
    el("span", { style: { minWidth: "0" } }, [
      el("span", { style: { display: "block", fontWeight: "600" } }, line.title),
      el("span.text-sm.muted", { style: { display: "block" } },
        [line.variantLabel, `${line.qty} × ${money(line.unitPrice)}`].filter(Boolean).join(" · ")),
    ]),
    el("span.mono", { style: { fontWeight: "700", whiteSpace: "nowrap" } }, money(line.unitPrice * line.qty)),
  ]);
}

function totalsTable(totals) {
  const rate = vatRateFor(state.customer.country);
  return el("div.panel", {}, [
    summaryRow("Subtotal", money(totals.subtotal)),
    totals.discount > 0
      ? summaryRow(`Descuento${totals.promo ? ` (${totals.promo.code})` : ""}`, `−${money(totals.discount)}`, { good: true })
      : null,
    summaryRow("Envío", totals.shippingFree ? "Gratis" : money(totals.shipping), { good: totals.shippingFree }),
    summaryRow(`IVA incluido (${Math.round(rate * 100)} %)`, money(totals.tax), { muted: true }),
    el("div.summary__row.summary__row--total", {}, [el("span", {}, "Total"), el("span", {}, money(totals.total))]),
  ]);
}

/* --- Confirmation --------------------------------------------------------- */

async function confirmOrder(button) {
  if (confirming) return;

  const snapshot = cart.snapshot();
  if (!snapshot.lines.length) {
    render();
    return;
  }

  // Guard against a stale draft: the customer could have reloaded straight into
  // step 3 with a form that no longer validates.
  const problems = [...shippingProblems(), ...paymentProblems()];
  if (problems.length) {
    toast("Faltan datos por completar. Te llevamos al paso correspondiente.", { variant: "warn", title: "Revisa el pedido" });
    goTo(shippingProblems().length ? 1 : 2);
    return;
  }

  confirming = true;
  button.disabled = true;
  button.textContent = "Procesando pago…";

  try {
    // A real authorisation takes a moment; pretending it is instant makes the
    // simulated one feel like a page that did nothing.
    await wait(600);

    // The destination is final now, so the phone can be frozen in its
    // international form — which is the one the courier's API wants.
    const phone = validatePhone(state.customer.phone, state.customer.country);

    let order = createOrder({
      snapshot,
      customer: { ...state.customer, phone: phone.ok ? phone.value : state.customer.phone },
      payment: paymentPayload(),
    });
    order = advanceOrder(order, "paid", { note: `Pago simulado autorizado (${METHOD_LABEL[state.method]})` });
    order = routeToSuppliers(order);

    saveOrder(order);
    cart.clear();
    store.remove(DRAFT_KEY);

    location.assign(`order.html?ref=${encodeURIComponent(order.reference)}`);
  } catch (error) {
    confirming = false;
    button.disabled = false;
    button.textContent = "Confirmar pedido";
    console.warn("[checkout] order creation failed", error);
    toast("No hemos podido crear el pedido. Inténtalo de nuevo.", { variant: "loss", title: "Error" });
  }
}

/* --- Shared step chrome ---------------------------------------------------- */

const stepHeading = (title, lede) =>
  el("div", {}, [
    el("h2", { id: "step-title", tabIndex: -1, style: { fontSize: "var(--text-xl)" } }, title),
    el("p.muted.text-sm", { style: { marginTop: "var(--space-1)" } }, lede),
  ]);

function stepActions({ back, next }) {
  const backButton = back.href
    ? el("a.btn.btn--ghost", { href: back.href }, back.label)
    : el("button.btn.btn--ghost", { type: "button", onclick: back.onClick }, back.label);

  return el("div.row.row--between.row--wrap", { style: { marginTop: "var(--space-6)", gap: "var(--space-3)" } }, [
    backButton,
    el("button.btn.btn--primary", { type: "button", onclick: next.onClick }, [
      el("span", {}, next.label),
      icon("arrowRight", { size: 16 }),
    ]),
  ]);
}

const summaryRow = (label, value, { good = false, muted = false } = {}) =>
  el("div.summary__row", {}, [
    el("span", { class: muted ? "muted" : null }, label),
    el("span", { style: { fontWeight: "650", color: good ? "var(--win)" : null, whiteSpace: "nowrap" } }, value),
  ]);

/* --- Order summary (sticky, visible on every step) ------------------------- */

function renderSummary() {
  const totals = cart.totals();
  const rate = vatRateFor(state.customer.country);

  replace(summaryHost, el("div.card.card--pad", {}, [
    el("h2#summary-title", { style: { fontSize: "var(--text-lg)" } }, "Tu pedido"),

    el("ul", { style: { listStyle: "none", padding: 0, margin: "var(--space-4) 0 0" } },
      cart.lines.map((line) =>
        el("li", {
          style: {
            display: "grid",
            gridTemplateColumns: "40px minmax(0, 1fr) auto",
            gap: "var(--space-3)",
            alignItems: "center",
            marginBottom: "var(--space-3)",
          },
        }, [
          el("span", {
            "aria-hidden": "true",
            html: lineArt(line),
            style: { aspectRatio: "1", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--bg-elev-2)" },
          }),
          el("span", { style: { minWidth: "0" } }, [
            el("span.text-sm.truncate", { style: { display: "block", fontWeight: "600" } }, line.title),
            el("span.text-xs.muted", {}, `${line.qty} ud. ${line.variantLabel ? `· ${line.variantLabel}` : ""}`),
          ]),
          el("span.text-sm.mono", { style: { whiteSpace: "nowrap" } }, money(line.unitPrice * line.qty)),
        ])
      )),

    el("hr.divider", { style: { margin: "var(--space-4) 0" } }),

    summaryRow("Subtotal", money(totals.subtotal)),
    totals.discount > 0
      ? summaryRow(`Descuento${totals.promo ? ` (${totals.promo.code})` : ""}`, `−${money(totals.discount)}`, { good: true })
      : null,
    summaryRow("Envío", totals.shippingFree ? "Gratis" : money(totals.shipping), { good: totals.shippingFree }),
    summaryRow(`IVA incluido (${Math.round(rate * 100)} %)`, money(totals.tax), { muted: true }),
    el("div.summary__row.summary__row--total", {}, [
      el("span", {}, "Total"),
      el("span", {}, money(totals.total)),
    ]),

    totals.savings > 0
      ? el("p", { style: { marginTop: "var(--space-3)" } }, [
          el("span.badge.badge--win", {}, `Ahorras ${money(totals.savings)}`),
        ])
      : null,

    el("p.text-xs.subtle", { style: { marginTop: "var(--space-3)" } },
      `Envío a ${COUNTRY_LABEL[state.customer.country] ?? totals.zone.label}: entrega estimada en ${totals.zone.etaDays[0]}–${totals.zone.etaDays[1]} días laborables.`),

    el("a.btn.btn--ghost.btn--sm.btn--block", { href: "cart.html", style: { marginTop: "var(--space-3)" } }, "Modificar el carrito"),
  ]));
}

/* --- Step indicator -------------------------------------------------------- */

function renderSteps() {
  const nodes = [];
  for (const step of STEPS) {
    if (step.n > 1) nodes.push(el("span.step__sep", { "aria-hidden": "true" }));

    const done = state.step > step.n;
    const current = state.step === step.n;
    // Any step already visited stays clickable, so stepping back to fix an
    // address does not mean clicking "continuar" through the rest of the flow.
    // A step never reached is disabled rather than silently inert.
    const reachable = step.n <= Math.max(state.step, state.reached);

    nodes.push(el("button.step", {
      type: "button",
      dataset: { done: String(done) },
      ...(current ? { "aria-current": "step" } : {}),
      disabled: !reachable,
      onclick: () => goTo(step.n),
      "aria-label": `Paso ${step.n} de 3: ${step.label}`,
      style: { background: "none", border: "0", padding: "0", cursor: reachable && !current ? "pointer" : "default" },
    }, [
      el("span.step__num", { "aria-hidden": "true" }, done ? [icon("check", { size: 14 })] : String(step.n)),
      el("span", {}, step.label),
    ]));
  }
  replace(stepsNav, nodes);
}

/* --- Navigation ------------------------------------------------------------ */

function goTo(step) {
  if (step === state.step) return;

  // Moving forward has to clear every step in between, even when the jump comes
  // from the indicator rather than from a "continue" button. A blocked jump is
  // never a no-op: it either paints the errors on the step you are looking at,
  // or drops you on the step that is holding things up.
  if (step > state.step) {
    for (let s = state.step; s < step; s++) {
      const blocked = (s === 1 && shippingProblems().length) || (s === 2 && paymentProblems().length);
      if (!blocked) continue;
      if (s === state.step) (s === 1 ? submitShipping : submitPayment)();
      else goTo(s);
      return;
    }
  }

  state.step = step;
  state.reached = Math.max(state.reached, step);
  saveDraft();
  render();
  // Move focus to the new step's heading: without it a keyboard or screen-reader
  // user stays parked on a button that no longer exists.
  $("#step-title")?.focus();
}

/* --- Render ---------------------------------------------------------------- */

function renderStep() {
  const view = state.step === 1 ? stepShipping() : state.step === 2 ? stepPayment() : stepReview();
  replace(stepHost, view);
}

function render() {
  // `#steps` lives inside `#checkout-view`: `.steps` sets `display: flex`, which
  // would win over the `hidden` attribute if the nav were toggled on its own.
  const empty = cart.isEmpty && !confirming;
  emptyView.hidden = !empty;
  checkoutView.hidden = empty;

  if (empty) {
    replace(stepHost, []);
    return;
  }

  renderSteps();
  renderStep();
  renderSummary();
}

/* --- Boot ------------------------------------------------------------------ */

mountHeader({ active: "" });

const stepsNav = $("#steps");
const stepHost = $("#step-host");
const summaryHost = $("#summary-host");
const checkoutView = $("#checkout-view");
const emptyView = $("#empty-view");

replace($("#crumbs"), breadcrumbs([
  { label: "Inicio", href: "index.html" },
  { label: "Carrito", href: "cart.html" },
  { label: "Finalizar compra" },
]));

replace($("#empty-icon"), icon("cart", { size: 44 }));

loadDraft();
// The cart is the one that prices the order, so the country chosen at checkout
// has to be the country the cart quotes shipping and VAT for.
if (cart.country !== state.customer.country) cart.setCountry(state.customer.country);

render();

cart.on("change", () => {
  // `cart.clear()` fires this on the way out; re-rendering then would flash the
  // empty state over the confirmation just before the redirect.
  if (confirming) return;
  if (cart.isEmpty) render();
  else renderSummary();
});

mountFooter();
