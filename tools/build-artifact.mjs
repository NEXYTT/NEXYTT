/**
 * Build a playable preview: one self-contained page carrying a whole app, for
 * opening somewhere that cannot serve files.
 *
 * Each screen is bundled by tools/bundle.mjs and embedded base64-encoded — base64
 * rather than a JavaScript string literal because the bundles contain their own
 * `</script>` tags, which would close the enclosing script wherever they appear.
 *
 * Screens run in an iframe via `srcdoc`, so each page executes exactly as it does
 * on a server: same DOM, same modules, same storage. `srcdoc` keeps the frame
 * same-origin, which is what lets the cart and the wallet persist as you move
 * between screens, and lets this shell intercept the app's own links.
 *
 *   node tools/build-artifact.mjs casino > casino-preview.html
 *   node tools/build-artifact.mjs shop   > shop-preview.html
 */

import { bundlePage } from "./bundle.mjs";

const APPS = {
  casino: {
    title: "NEXYTT Casino",
    brand: "NEXYTT Casino",
    note: "Créditos virtuales · sin valor monetario",
    dir: "casino",
    entry: "index",
    dark: true,
    // Every screen is bundled; only these appear in the shell's own nav, the
    // rest are reached by clicking through the app itself.
    screens: [
      { id: "index", label: "Lobby", nav: true },
      { id: "slots", label: "Tragaperras", nav: true },
      { id: "blackjack", label: "Blackjack", nav: true },
      { id: "roulette", label: "Ruleta", nav: true },
      { id: "dice", label: "Dados", nav: true },
      { id: "crash", label: "Crash", nav: true },
      { id: "mines", label: "Minas", nav: true },
      { id: "fairness", label: "Verificador", nav: true },
    ],
  },
  shop: {
    title: "NEXYTT Store",
    brand: "NEXYTT Store",
    note: "Pago simulado · no se procesa ningún cobro",
    dir: "shop",
    entry: "index",
    dark: false,
    screens: [
      { id: "index", label: "Catálogo", nav: true },
      { id: "cart", label: "Carrito", nav: true },
      { id: "checkout", label: "Pago", nav: true },
      { id: "orders", label: "Mis pedidos", nav: true },
      { id: "admin", label: "Panel", nav: true },
      // Reached by clicking a product or a placed order, so they need a query
      // string and would be meaningless as bare nav entries.
      { id: "product", label: "Ficha", nav: false },
      { id: "order", label: "Pedido", nav: false },
    ],
  },
};

const appName = process.argv[2];
const app = APPS[appName];
if (!app) {
  console.error(`uso: node tools/build-artifact.mjs <${Object.keys(APPS).join("|")}>`);
  process.exit(1);
}

const bundles = {};
for (const screen of app.screens) {
  const html = await bundlePage(`${app.dir}/${screen.id}.html`, { preview: true });
  bundles[screen.id] = Buffer.from(html, "utf8").toString("base64");
}

const payload = JSON.stringify(bundles);
const nav = app.screens
  .filter((s) => s.nav)
  .map((s) => `<button type="button" class="pill" data-screen="${s.id}">${s.label}</button>`)
  .join("");

/* The casino is a deliberately dark room; the storefront is a retail surface
   that carries its own light/dark switch. The shell adopts each one's ground so
   the frame never fights the app inside it. */
const palette = app.dark
  ? `--ground:#07090f; --surface:#0d1119; --line:rgba(255,255,255,.09);
     --ink:#eef2f8; --ink-muted:#98a3b8; --ink-subtle:#808ca3;
     --accent:#f5c451; --accent-soft:rgba(245,196,81,.14);
     --mark-a:#ffdd8a; --mark-b:#b8912f; --on-mark:#16120a;
     --hover:rgba(255,255,255,.06);`
  : `--ground:#101828; --surface:#0b0e14; --line:rgba(255,255,255,.09);
     --ink:#eaeef6; --ink-muted:#98a3b8; --ink-subtle:#8894a6;
     --accent:#9081ff; --accent-soft:rgba(144,129,255,.18);
     --mark-a:#a596ff; --mark-b:#6a58e8; --on-mark:#0b0714;
     --hover:rgba(255,255,255,.07);`;

process.stdout.write(`<title>${app.title}</title>
<style>
  /* Every colour is painted explicitly, ground included, so the frame holds
     whichever theme the viewer is in. Tokens mirror assets/css/tokens.css. */
  .nx {
    ${palette}
    --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    --font-display: "Bahnschrift", "DIN Alternate", "Segoe UI Semibold",
      ui-sans-serif, system-ui, sans-serif;

    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--font-ui);
    -webkit-font-smoothing: antialiased;
  }
  .nx *, .nx *::before, .nx *::after { box-sizing: border-box; }

  .nx__bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: .75rem;
    flex-wrap: wrap;
    padding: .5rem .875rem;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .nx__brand {
    display: inline-flex; align-items: center; gap: .5rem;
    font-family: var(--font-display); font-weight: 800;
    font-size: .9375rem; letter-spacing: -.01em; white-space: nowrap;
  }
  .nx__mark {
    width: 24px; height: 24px; display: grid; place-items: center;
    border-radius: 7px;
    background: linear-gradient(140deg, var(--mark-a), var(--mark-b));
    color: var(--on-mark); font-size: .75rem; font-weight: 900;
  }
  .nx__nav { display: flex; gap: .25rem; flex-wrap: wrap; }
  .pill {
    padding: .3125rem .625rem; border-radius: 999px;
    border: 1px solid transparent; background: transparent;
    color: var(--ink-muted); font: inherit; font-size: .8125rem; font-weight: 600;
    cursor: pointer; white-space: nowrap;
    transition: background 120ms ease, color 120ms ease;
  }
  .pill:hover { background: var(--hover); color: var(--ink); }
  .pill[aria-current="true"] { background: var(--accent-soft); color: var(--accent); }
  .nx :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .nx__note { margin-left: auto; font-size: .75rem; color: var(--ink-subtle); white-space: nowrap; }
  @media (max-width: 780px) { .nx__note { display: none; } }

  .nx__stage { flex: 1 1 auto; position: relative; min-height: 0; }
  .nx__frame { width: 100%; height: 100%; border: 0; display: block; background: var(--ground); }

  .nx__toast {
    position: absolute; left: 50%; bottom: 1.25rem;
    transform: translateX(-50%) translateY(.5rem);
    padding: .5rem .875rem; border-radius: 999px;
    background: var(--surface); border: 1px solid var(--line);
    color: var(--ink); font-size: .8125rem;
    max-width: min(30rem, calc(100% - 2rem)); text-align: center;
    opacity: 0; pointer-events: none;
    transition: opacity 180ms ease, transform 180ms ease;
  }
  .nx__toast[data-show="true"] { opacity: 1; transform: translateX(-50%) translateY(0); }

  @media (prefers-reduced-motion: reduce) { .pill, .nx__toast { transition: none; } }
</style>

<div class="nx">
  <header class="nx__bar">
    <span class="nx__brand"><span class="nx__mark">N</span>${app.brand}</span>
    <nav class="nx__nav" aria-label="Secciones">${nav}</nav>
    <span class="nx__note">${app.note}</span>
  </header>
  <div class="nx__stage">
    <iframe class="nx__frame" id="nx-frame" title="${app.title}"></iframe>
    <div class="nx__toast" id="nx-toast" role="status"></div>
  </div>
</div>

<script>
(() => {
  const BUNDLES = ${payload};
  const ENTRY = ${JSON.stringify(app.entry)};
  const frame = document.getElementById("nx-frame");
  const toastNode = document.getElementById("nx-toast");
  const pills = [...document.querySelectorAll(".pill")];

  let toastTimer = 0;
  function toast(message) {
    toastNode.textContent = message;
    toastNode.dataset.show = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastNode.dataset.show = "false"; }, 3600);
  }

  // atob yields one byte per character, so UTF-8 has to be decoded explicitly —
  // otherwise every accent in the Spanish copy arrives mangled.
  const decode = (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  };

  /** Split "product.html?slug=x" into the screen it names and its query. */
  function parseTarget(href) {
    const clean = String(href).split("#")[0];
    const [path, query = ""] = clean.split("?");
    const id = (path.split("/").pop() || "").replace(/\\.html$/, "");
    return { id: id in BUNDLES ? id : null, search: query ? "?" + query : "" };
  }

  function show(id, search = "") {
    if (!(id in BUNDLES)) return false;
    for (const pill of pills) pill.setAttribute("aria-current", String(pill.dataset.screen === id));
    // Set before srcdoc: the frame reads this the moment its script runs.
    frame.dataset.nxSearch = search;
    frame.srcdoc = decode(BUNDLES[id]);
    return true;
  }

  /** Called from inside a frame when the app navigates on its own. */
  window.__nxGo = (href) => {
    const { id, search } = parseTarget(href);
    if (id) show(id, search);
    else toast("Esa página no está en esta vista previa. El proyecto completo está en el repositorio.");
  };

  for (const pill of pills) pill.addEventListener("click", () => show(pill.dataset.screen));

  // srcdoc keeps the frame same-origin, so the app's own navigation can be
  // intercepted and turned into a screen swap. Without this every in-app link
  // would try to fetch a file that does not exist here.
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (ev) => {
      const link = ev.target.closest?.("a[href]");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      if (/^(https?:|mailto:|tel:)/.test(href) || href.startsWith("#")) return;
      ev.preventDefault();
      window.__nxGo(href);
    }, true);
  });

  show(ENTRY);
})();
</script>
`);
