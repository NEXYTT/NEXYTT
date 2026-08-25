/* =====================================================================
   NEXYTT HUD — utilidades compartidas
   ===================================================================== */

const NX = {
  settings: {},
  config: { locale: 'es', currency: '$', serverName: 'NEXYTT RP', labels: {} },
  state: {},
};

/* En el navegador (fuera de FiveM) GetParentResourceName no existe:
   lo usamos para activar el modo demo y poder previsualizar el HUD. */
NX.inGame = typeof GetParentResourceName === 'function';
NX.resource = NX.inGame ? GetParentResourceName() : 'nexytt_hud';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

NX.el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

NX.icon = (id, className = '') =>
  `<svg class="${className}"><use href="#ic-${id}"/></svg>`;

NX.clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

NX.t = (key, fallback) => NX.config.labels?.[key] || fallback || key;

/* --------------------------------------------------------------------
   Puente con el cliente Lua
   -------------------------------------------------------------------- */
NX.post = (name, data = {}) => {
  if (!NX.inGame) return Promise.resolve({});
  return fetch(`https://${NX.resource}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(data),
  }).then(r => r.json()).catch(() => ({}));
};

/* --------------------------------------------------------------------
   Geometria de arcos SVG
   Angulos en grados: 0 = derecha, crecen en sentido horario (y hacia abajo).
   -------------------------------------------------------------------- */
NX.polar = (cx, cy, r, deg) => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

NX.arcPath = (cx, cy, r, from, to) => {
  const a = NX.polar(cx, cy, r, from);
  const b = NX.polar(cx, cy, r, to);
  const delta = to - from;
  const sweep = delta >= 0 ? 1 : 0;
  const large = Math.abs(delta) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

/** Rellena un path con pathLength="100" hasta el porcentaje indicado. */
NX.setArc = (el, pct) => {
  if (!el) return;
  const v = NX.clamp(pct, 0, 100);
  el.style.strokeDasharray = `${v.toFixed(2)} 100`;
};

/** normal | warn | danger segun los umbrales que manda el cliente. */
NX.level = (value, warnAt = 25, dangerAt = 12) => {
  if (value <= dangerAt) return 'danger';
  if (value <= warnAt) return 'warn';
  return 'normal';
};

NX.applyLevel = (el, level) => {
  if (!el) return;
  el.classList.toggle('is-warn', level === 'warn');
  el.classList.toggle('is-danger', level === 'danger');
};

/* --------------------------------------------------------------------
   Color
   -------------------------------------------------------------------- */
NX.hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 91, g: 140, b: 255 };
};

NX.applyTokens = (s) => {
  const root = document.documentElement;
  const { r, g, b } = NX.hexToRgb(s.accent);

  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, .18)`);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, .45)`);
  root.style.setProperty('--hud-scale', (s.scale || 100) / 100);
  root.style.setProperty('--hud-opacity', (s.opacity || 100) / 100);
  root.style.setProperty('--status-dx', `${s.statusOffsetX || 0}px`);
  root.style.setProperty('--status-dy', `${s.statusOffsetY || 0}px`);
  root.style.setProperty('--status-scale', (s.statusScale || 100) / 100);
  root.dataset.theme = s.theme || 'dark';
};

/* --------------------------------------------------------------------
   Formato
   -------------------------------------------------------------------- */
NX.money = (value) => {
  const n = typeof value === 'number' ? Math.floor(value) : parseInt(String(value).replace(/\D/g, ''), 10) || 0;
  return String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

NX.signed = (n) => (n > 0 ? `+${NX.money(n)}` : `-${NX.money(Math.abs(n))}`);
