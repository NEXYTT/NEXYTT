/* =====================================================================
   ESTADO DEL JUGADOR — ocho estilos
   ring · bars · circles · squares · minimal · stacked · hexagon · corner
   ===================================================================== */

const Status = (() => {

  const METRICS = [
    { key: 'health',  icon: 'heart',   setting: 'showHealth'  },
    { key: 'armor',   icon: 'shield',  setting: 'showArmor',  hideAtZero: true },
    { key: 'hunger',  icon: 'food',    setting: 'showHunger'  },
    { key: 'thirst',  icon: 'water',   setting: 'showThirst'  },
    { key: 'stress',  icon: 'stress',  setting: 'showStress',  inverted: true },
    { key: 'oxygen',  icon: 'oxygen',  setting: 'showOxygen',  underwaterOnly: true },
    { key: 'stamina', icon: 'stamina', setting: 'showStamina' },
  ];

  const byKey = Object.fromEntries(METRICS.map(m => [m.key, m]));

  /* Geometría del estilo "ring": arcos que abrazan un minimapa circular */
  const CX = 120, CY = 120, R_ARC = 104, R_NEEDS = 117;
  const ARC_HEALTH = [100, 175];
  const ARC_ARMOR  = [80, 5];
  const NEEDS_FROM = 234, NEEDS_TO = 306;

  /* Geometría del estilo "corner": abanico desde la esquina superior izquierda */
  const CORNER_R0 = 82, CORNER_STEP = 21;

  const root = $('#status');
  let refs = {};
  let signature = '';

  const label = (key) => NX.t(key, key);

  /* ------------------------------------------------------------------
     Piezas reutilizables
     ------------------------------------------------------------------ */
  const ringSvg = (size, stroke) => `
    <svg class="sti__ring" viewBox="0 0 ${size} ${size}">
      <circle class="t" cx="${size / 2}" cy="${size / 2}" r="${size / 2 - stroke}" pathLength="100"/>
      <circle class="f" cx="${size / 2}" cy="${size / 2}" r="${size / 2 - stroke}" pathLength="100"/>
    </svg>`;

  const items = {
    bars: m => `
      <div class="sti sti--bar" data-metric="${m.key}" title="${label(m.key)}">
        <span class="v">0</span>
        <div class="t"><i class="f"></i></div>
        ${NX.icon(m.icon, 'sti__icon')}
      </div>`,

    circles: m => `
      <div class="sti sti--circle" data-metric="${m.key}" title="${label(m.key)}">
        ${ringSvg(46, 3)}
        ${NX.icon(m.icon, 'sti__icon')}
        <span class="v">0</span>
      </div>`,

    squares: m => `
      <div class="sti sti--square" data-metric="${m.key}" title="${label(m.key)}">
        <i class="f"></i>
        ${NX.icon(m.icon, 'sti__icon')}
        <span class="v">0</span>
      </div>`,

    minimal: m => `
      <div class="sti sti--minimal" data-metric="${m.key}" title="${label(m.key)}">
        ${NX.icon(m.icon, 'sti__icon')}
        <div class="t"><i class="f"></i></div>
      </div>`,

    stacked: m => `
      <div class="sti sti--stacked" data-metric="${m.key}">
        ${NX.icon(m.icon, 'sti__icon')}
        <span class="n">${label(m.key)}</span>
        <div class="t"><i class="f"></i></div>
        <span class="v">0</span>
      </div>`,

    hexagon: m => `
      <div class="sti sti--hex" data-metric="${m.key}" title="${label(m.key)}">
        <span class="hex"><i class="f"></i></span>
        ${NX.icon(m.icon, 'sti__icon')}
        <span class="v">0</span>
      </div>`,
  };

  /* ------------------------------------------------------------------
     Constructores por estilo
     ------------------------------------------------------------------ */
  const builders = {

    ring(visible) {
      const needs = visible.filter(k => k !== 'health' && k !== 'armor');
      const arcs = [
        ['health', ARC_HEALTH],
        ['armor',  ARC_ARMOR],
      ].filter(([k]) => visible.includes(k));

      const masks = arcs.map(([k, range]) => `
        <mask id="segmask-${k}">
          <path d="${NX.arcPath(CX, CY, R_ARC, range[0], range[1])}" fill="none" stroke="#fff"
                stroke-width="14" stroke-linecap="butt" stroke-dasharray="1.35 0.75" pathLength="100"/>
        </mask>`).join('');

      const paths = arcs.map(([k, range]) => {
        const d = NX.arcPath(CX, CY, R_ARC, range[0], range[1]);
        return `
          <g mask="url(#segmask-${k})" data-metric="${k}">
            <path class="arc arc--bg" d="${d}" pathLength="100"/>
            <path class="arc arc--fill f" d="${d}" pathLength="100"/>
          </g>`;
      }).join('');

      const badges = needs.map(k => `
        <div class="need" data-metric="${k}" title="${label(k)}">
          ${ringSvg(34, 2.4)}
          ${NX.icon(byKey[k].icon, 'need__icon')}
          <span class="v need__value">0</span>
        </div>`).join('');

      const caps = arcs.map(([k]) => `
        <span class="cap" data-cap="${k}">
          ${NX.icon(byKey[k].icon)}<b>0</b>
        </span>`).join('');

      return `
        <div class="status__ring-wrap">
          <svg class="status__rings" viewBox="0 0 240 240"><defs>${masks}</defs>${paths}</svg>
          <div class="status__needs">${badges}</div>
        </div>
        <div class="status__caps">${caps}</div>`;
    },

    corner(visible) {
      const size = CORNER_R0 + CORNER_STEP * visible.length + 30;
      const arcs = visible.map((k, i) => {
        const r = CORNER_R0 + CORNER_STEP * i;
        const d = NX.arcPath(0, 0, r, 4, 86);
        return `
          <g data-metric="${k}">
            <path class="arc arc--bg" d="${d}" pathLength="100"/>
            <path class="arc arc--fill f" d="${d}" pathLength="100"/>
          </g>`;
      }).join('');

      const icons = visible.map((k, i) => {
        const r = CORNER_R0 + CORNER_STEP * i;
        const p = NX.polar(0, 0, r, 86);
        return `
          <div class="corner__icon" data-metric="${k}" title="${label(k)}"
               style="left:${p.x}px; top:${p.y}px">
            ${NX.icon(byKey[k].icon)}
          </div>`;
      }).join('');

      return `
        <div class="corner" style="width:${size}px; height:${size}px">
          <svg class="corner__svg" viewBox="0 0 ${size} ${size}">${arcs}</svg>
          ${icons}
        </div>`;
    },
  };

  ['bars', 'circles', 'squares', 'minimal', 'stacked', 'hexagon'].forEach(style => {
    builders[style] = (visible) => `
      <div class="stpanel stpanel--${style}">
        ${visible.map(k => items[style](byKey[k])).join('')}
      </div>`;
  });

  /* ------------------------------------------------------------------
     Visibilidad
     ------------------------------------------------------------------ */
  function isVisible(meta, value, data) {
    const s = NX.settings;
    if (meta.setting && s[meta.setting] === false) return false;
    if (meta.hideAtZero && value <= 0) return false;
    if (meta.underwaterOnly && !data.underwater && value >= 100) return false;
    if (s.hideWhenFull) {
      if (meta.inverted && value <= 0) return false;
      if (!meta.inverted && value >= 100) return false;
    }
    return true;
  }

  function levelFor(meta, value, warnAt, dangerAt) {
    if (meta.inverted) {
      if (value >= 80) return 'danger';
      if (value >= 55) return 'warn';
      return 'normal';
    }
    return NX.level(value, warnAt, dangerAt);
  }

  /* ------------------------------------------------------------------
     Reconstrucción
     ------------------------------------------------------------------ */
  function rebuild(style, visible) {
    root.dataset.style = style;
    root.innerHTML = (builders[style] || builders.bars)(visible);

    refs = {};
    $$('[data-metric]', root).forEach(node => {
      const key = node.dataset.metric;
      if (refs[key]) return;                    // el primero manda (arco antes que icono)
      refs[key] = { node, fill: $('.f', node), value: $('.v', node) };
    });

    // Los iconos sueltos del estilo corner comparten data-metric con el arco
    if (style === 'corner') {
      $$('.corner__icon', root).forEach(node => {
        const ref = refs[node.dataset.metric];
        if (ref) ref.icon = node;
      });
    }

    if (style === 'ring') layoutNeeds(visible.filter(k => k !== 'health' && k !== 'armor'));
  }

  /** Reparte las insignias del estilo ring por el arco superior. */
  function layoutNeeds(keys) {
    const n = keys.length;
    if (!n) return;

    const span = NEEDS_TO - NEEDS_FROM;
    const used = Math.min(span, n * 19);
    const from = NEEDS_FROM + (span - used) / 2;
    const step = n > 1 ? used / (n - 1) : 0;

    keys.forEach((key, i) => {
      const node = $(`.need[data-metric="${key}"]`, root);
      if (!node) return;
      const angle = n > 1 ? from + step * i : from + used / 2;
      const p = NX.polar(CX, CY, R_NEEDS, angle);
      node.style.left = `${(p.x / 240) * 100}%`;
      node.style.top  = `${(p.y / 240) * 100}%`;
    });
  }

  /* ------------------------------------------------------------------
     Actualización
     ------------------------------------------------------------------ */
  function update(data) {
    const style = NX.settings.statusStyle || 'ring';
    const warnAt = data.warnAt ?? 25;
    const dangerAt = data.dangerAt ?? 12;

    const visible = METRICS
      .filter(m => isVisible(m, data[m.key] ?? 0, data))
      .map(m => m.key);

    const sig = `${style}|${visible.join(',')}`;
    if (sig !== signature) {
      signature = sig;
      rebuild(style, visible);
    }

    visible.forEach(key => {
      const ref = refs[key];
      if (!ref) return;

      const meta = byKey[key];
      const value = NX.clamp(data[key] ?? 0, 0, 100);
      const level = levelFor(meta, value, warnAt, dangerAt);

      ref.node.style.setProperty('--v', `${value}%`);
      if (ref.fill) {
        if (ref.fill.namespaceURI === 'http://www.w3.org/2000/svg') NX.setArc(ref.fill, value);
      }
      if (ref.value) ref.value.textContent = Math.round(value);

      NX.applyLevel(ref.node, level);
      if (ref.icon) NX.applyLevel(ref.icon, level);

      if (style === 'ring') {
        const cap = $(`.cap[data-cap="${key}"]`, root);
        if (cap) {
          NX.applyLevel(cap, level);
          const num = $('b', cap);
          if (num) num.textContent = Math.round(value);
        }
      }
    });
  }

  function applyStyle() {
    signature = '';   // fuerza reconstrucción en el siguiente tick
    const style = NX.settings.statusStyle || 'ring';
    root.dataset.style = style;
    document.getElementById('hud').dataset.statusStyle = style;
  }

  function init() { applyStyle(); }

  return { init, update, applyStyle, STYLES: ['ring', 'bars', 'circles', 'squares', 'minimal', 'stacked', 'hexagon', 'corner'] };
})();
