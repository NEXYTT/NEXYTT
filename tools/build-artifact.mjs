/**
 * Build the playable preview: one self-contained page carrying every casino
 * screen, for opening somewhere that cannot serve files.
 *
 * Each screen is bundled by tools/bundle.mjs and embedded base64-encoded. Base64
 * rather than a JavaScript string literal because the bundles contain their own
 * `</script>` tags, which would close the enclosing script wherever they appear —
 * escaping every one of them is a rule you only have to forget once.
 *
 * The screens run in an iframe via `srcdoc`, so each page executes exactly as it
 * does on a server: same DOM, same modules, same storage. `srcdoc` keeps the
 * frame same-origin, which is what lets the balance persist as you move between
 * games — and lets this shell intercept the casino's own navigation links.
 *
 *   node tools/build-artifact.mjs > casino-preview.html
 */

import { bundlePage } from "./bundle.mjs";

const SCREENS = [
  { id: "index", label: "Lobby", file: "casino/index.html" },
  { id: "slots", label: "Tragaperras", file: "casino/slots.html" },
  { id: "blackjack", label: "Blackjack", file: "casino/blackjack.html" },
  { id: "roulette", label: "Ruleta", file: "casino/roulette.html" },
  { id: "dice", label: "Dados", file: "casino/dice.html" },
  { id: "crash", label: "Crash", file: "casino/crash.html" },
  { id: "mines", label: "Minas", file: "casino/mines.html" },
  { id: "fairness", label: "Verificador", file: "casino/fairness.html" },
];

const bundles = {};
for (const screen of SCREENS) {
  bundles[screen.id] = Buffer.from(await bundlePage(screen.file), "utf8").toString("base64");
}

const payload = JSON.stringify(bundles);
const nav = SCREENS.map(
  (s) => `<button type="button" class="pill" data-screen="${s.id}">${s.label}</button>`
).join("");

process.stdout.write(`<title>NEXYTT Casino</title>
<style>
  /* The embedded casino is a deliberately dark room — obsidian and gold — so
     this frame commits to the same world rather than following the host theme.
     Every colour is painted explicitly, including the ground, so the page holds
     whichever theme the viewer is in. Tokens mirror assets/css/tokens.css. */
  .nx {
    --ground: #07090f;
    --surface: #0d1119;
    --line: rgba(255, 255, 255, 0.09);
    --ink: #eef2f8;
    --ink-muted: #98a3b8;
    --ink-subtle: #808ca3;
    --gold: #f5c451;
    --gold-lo: #b8912f;
    --on-gold: #16120a;

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
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.875rem;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  .nx__brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 0.9375rem;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .nx__mark {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: 7px;
    background: linear-gradient(140deg, #ffdd8a, var(--gold-lo));
    color: var(--on-gold);
    font-size: 0.75rem;
    font-weight: 900;
  }

  .nx__nav { display: flex; gap: 0.25rem; flex-wrap: wrap; }

  .pill {
    padding: 0.3125rem 0.625rem;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-muted);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 120ms ease, color 120ms ease;
  }
  .pill:hover { background: rgba(255, 255, 255, 0.06); color: var(--ink); }
  .pill[aria-current="true"] {
    background: rgba(245, 196, 81, 0.14);
    color: var(--gold);
  }
  .nx :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

  .nx__note {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--ink-subtle);
    white-space: nowrap;
  }
  @media (max-width: 720px) { .nx__note { display: none; } }

  .nx__stage { flex: 1 1 auto; position: relative; min-height: 0; }
  .nx__frame { width: 100%; height: 100%; border: 0; display: block; background: var(--ground); }

  .nx__toast {
    position: absolute;
    left: 50%;
    bottom: 1.25rem;
    transform: translateX(-50%) translateY(0.5rem);
    padding: 0.5rem 0.875rem;
    border-radius: 999px;
    background: rgba(13, 17, 25, 0.96);
    border: 1px solid var(--line);
    color: var(--ink);
    font-size: 0.8125rem;
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease, transform 180ms ease;
  }
  .nx__toast[data-show="true"] { opacity: 1; transform: translateX(-50%) translateY(0); }

  @media (prefers-reduced-motion: reduce) {
    .pill, .nx__toast { transition: none; }
  }
</style>

<div class="nx">
  <header class="nx__bar">
    <span class="nx__brand"><span class="nx__mark">N</span>NEXYTT Casino</span>
    <nav class="nx__nav" aria-label="Salas">${nav}</nav>
    <span class="nx__note">Créditos virtuales · sin valor monetario</span>
  </header>

  <div class="nx__stage">
    <iframe class="nx__frame" id="nx-frame" title="Casino NEXYTT"></iframe>
    <div class="nx__toast" id="nx-toast" role="status"></div>
  </div>
</div>

<script>
(() => {
  const BUNDLES = ${payload};
  const frame = document.getElementById("nx-frame");
  const toastNode = document.getElementById("nx-toast");
  const pills = [...document.querySelectorAll(".pill")];

  let toastTimer = 0;
  function toast(message) {
    toastNode.textContent = message;
    toastNode.dataset.show = "true";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastNode.dataset.show = "false"; }, 3200);
  }

  // atob yields one byte per character, so UTF-8 has to be decoded explicitly —
  // otherwise every accent in the Spanish copy arrives mangled.
  const decode = (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  };

  /** Map a link inside the casino back to the screen it points at. */
  const screenFor = (href) => {
    const file = href.split("?")[0].split("#")[0].split("/").pop();
    const id = file.replace(/\\.html$/, "");
    return id in BUNDLES ? id : null;
  };

  function show(id) {
    if (!(id in BUNDLES)) return;
    for (const pill of pills) {
      pill.setAttribute("aria-current", String(pill.dataset.screen === id));
    }
    frame.srcdoc = decode(BUNDLES[id]);
  }

  for (const pill of pills) {
    pill.addEventListener("click", () => show(pill.dataset.screen));
  }

  // srcdoc keeps the frame same-origin, so the casino's own navigation can be
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
      const id = screenFor(href);
      if (id) show(id);
      else toast("Esa página no está en esta vista previa. El proyecto completo está en el repositorio.");
    }, true);
  });

  show("index");
})();
</script>
`);
