/* =====================================================================
   ESTADO DEL JUGADOR
   ===================================================================== */

const Status = (() => {
  const CX = 120, CY = 120;
  const R_ARC = 104;          // radio de los arcos de vida y chaleco
  const R_NEEDS = 117;        // radio donde se apoyan las insignias
  const NEEDS_FROM = 234;     // arco superior libre para las necesidades
  const NEEDS_TO   = 306;

  // Vida: nace abajo y crece hacia la izquierda. Chaleco: espejo hacia la derecha.
  const ARC_HEALTH = [100, 175];
  const ARC_ARMOR  = [80, 5];

  const NEEDS = [
    { key: 'hunger',  icon: 'food',    setting: 'showHunger'  },
    { key: 'thirst',  icon: 'water',   setting: 'showThirst'  },
    { key: 'stress',  icon: 'stress',  setting: 'showStress',  inverted: true },
    { key: 'oxygen',  icon: 'oxygen',  setting: 'showOxygen',  underwaterOnly: true },
    { key: 'stamina', icon: 'stamina', setting: 'showStamina' },
  ];

  const BARS = [
    { key: 'health',  icon: 'heart'   },
    { key: 'armor',   icon: 'shield'  },
    ...NEEDS.map(n => ({ key: n.key, icon: n.icon, inverted: n.inverted, underwaterOnly: n.underwaterOnly })),
  ];

  const root  = $('#status');
  const needsLayer = $('#status-needs');
  const barsLayer  = $('#status-bars');

  const badges = {};
  const bars   = {};
  let lastVisibleKeys = '';

  /* ---------------------------------------------------------------- */
  function buildArcs() {
    const pairs = [
      ['health', ARC_HEALTH, '#arc-health-bg', '#arc-health-fill', '#mask-health'],
      ['armor',  ARC_ARMOR,  '#arc-armor-bg',  '#arc-armor-fill',  '#mask-armor'],
    ];

    pairs.forEach(([, range, bgSel, fillSel, maskSel]) => {
      const d = NX.arcPath(CX, CY, R_ARC, range[0], range[1]);
      [bgSel, fillSel, maskSel].forEach(sel => {
        const node = $(sel);
        if (node) node.setAttribute('d', d);
      });
    });
  }

  function buildNeeds() {
    needsLayer.innerHTML = '';
    NEEDS.forEach(need => {
      const node = NX.el('div', 'need');
      node.dataset.metric = need.key;
      node.innerHTML = `
        <svg class="need__ring" viewBox="0 0 34 34">
          <circle class="t" cx="17" cy="17" r="15" pathLength="100"/>
          <circle class="f" cx="17" cy="17" r="15" pathLength="100"/>
        </svg>
        ${NX.icon(need.icon, 'need__icon')}
        <span class="need__value">0</span>`;
      needsLayer.appendChild(node);
      badges[need.key] = {
        node,
        fill: $('.f', node),
        value: $('.need__value', node),
      };
    });
  }

  function buildBars() {
    barsLayer.innerHTML = '';
    BARS.forEach(bar => {
      const node = NX.el('div', 'sbar');
      node.dataset.metric = bar.key;
      node.innerHTML = `
        <span class="sbar__value">0</span>
        <div class="sbar__track"><div class="sbar__fill"></div></div>
        ${NX.icon(bar.icon, 'sbar__icon')}`;
      barsLayer.appendChild(node);
      bars[bar.key] = { node, fill: $('.sbar__fill', node), value: $('.sbar__value', node) };
    });
  }

  /** Reparte las insignias visibles a lo largo del arco superior. */
  function layoutNeeds(visible) {
    const n = visible.length;
    if (!n) return;

    const span = NEEDS_TO - NEEDS_FROM;
    // Con pocas insignias las juntamos en el centro del arco en vez de estirarlas.
    const used = Math.min(span, n * 19);
    const from = NEEDS_FROM + (span - used) / 2;
    const step = n > 1 ? used / (n - 1) : 0;

    visible.forEach((key, i) => {
      const angle = n > 1 ? from + step * i : from + used / 2;
      const p = NX.polar(CX, CY, R_NEEDS, angle);
      const node = badges[key].node;
      node.style.left = `${(p.x / 240) * 100}%`;
      node.style.top  = `${(p.y / 240) * 100}%`;
    });
  }

  /* ---------------------------------------------------------------- */
  function levelFor(meta, value, warnAt, dangerAt) {
    if (meta.inverted) {
      if (value >= 80) return 'danger';
      if (value >= 55) return 'warn';
      return 'normal';
    }
    return NX.level(value, warnAt, dangerAt);
  }

  function shouldShow(meta, value, data) {
    const s = NX.settings;
    if (meta.setting && s[meta.setting] === false) return false;
    if (meta.underwaterOnly && !data.underwater && value >= 100) return false;
    if (s.hideWhenFull) {
      if (meta.inverted && value <= 0) return false;
      if (!meta.inverted && value >= 100) return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- */
  function update(data) {
    const s = NX.settings;
    const warnAt = data.warnAt ?? 25;
    const dangerAt = data.dangerAt ?? 12;

    /* --- Vida y chaleco --- */
    const health = { el: $('#arc-health-fill'), cap: $('#cap-health'), value: data.health, show: s.showHealth !== false };
    const armor  = { el: $('#arc-armor-fill'),  cap: $('#cap-armor'),  value: data.armor,  show: s.showArmor !== false && data.armor > 0 };

    [health, armor].forEach(m => {
      const level = NX.level(m.value, warnAt, dangerAt);
      NX.setArc(m.el, m.show ? m.value : 0);
      NX.applyLevel(m.el, level);
      m.el.parentNode.classList.toggle('is-invisible', !m.show);

      m.cap.classList.toggle('is-hidden', !m.show);
      NX.applyLevel(m.cap, level);
      const num = $('b', m.cap);
      if (num) num.textContent = Math.round(m.value);
    });

    /* --- Necesidades --- */
    const visible = [];
    NEEDS.forEach(meta => {
      const value = data[meta.key] ?? 0;
      const badge = badges[meta.key];
      const show = shouldShow(meta, value, data);

      badge.node.classList.toggle('is-out', !show);
      if (show) visible.push(meta.key);

      NX.setArc(badge.fill, value);
      const level = levelFor(meta, value, warnAt, dangerAt);
      NX.applyLevel(badge.node, level);
      badge.value.textContent = Math.round(value);
    });

    const key = visible.join(',');
    if (key !== lastVisibleKeys) {
      lastVisibleKeys = key;
      layoutNeeds(visible);
    }

    /* --- Modo barras --- */
    BARS.forEach(meta => {
      const bar = bars[meta.key];
      if (!bar) return;
      const value = data[meta.key] ?? 0;
      const settingKey = 'show' + meta.key.charAt(0).toUpperCase() + meta.key.slice(1);
      const show = s[settingKey] !== false
        && !(meta.underwaterOnly && !data.underwater && value >= 100)
        && !(s.hideWhenFull && !meta.inverted && value >= 100)
        && !(s.hideWhenFull && meta.inverted && value <= 0)
        && !(meta.key === 'armor' && value <= 0);

      bar.node.classList.toggle('is-out', !show);
      bar.fill.style.height = `${NX.clamp(value, 0, 100)}%`;
      bar.value.textContent = Math.round(value);
      NX.applyLevel(bar.node, levelFor(meta, value, warnAt, dangerAt));
    });
  }

  function applyLayout() {
    const ring = (NX.settings.statusLayout || 'ring') === 'ring';
    root.classList.toggle('status--ring', ring);
    root.classList.toggle('status--bars', !ring);
    lastVisibleKeys = '';
  }

  function init() {
    buildArcs();
    buildNeeds();
    buildBars();
    applyLayout();
  }

  return { init, update, applyLayout };
})();
