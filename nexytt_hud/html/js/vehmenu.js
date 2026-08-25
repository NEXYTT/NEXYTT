/* =====================================================================
   MENU CENITAL DEL VEHICULO
   Vista de pajaro accionable: puertas, ventanillas, ruedas, seguro.
   ===================================================================== */

const VehMenu = (() => {
  const root     = $('#vehmenu');
  const diagram  = $('#vehmenu-diagram');
  const gaugesEl = $('#vehmenu-gauges');
  const actions  = $('#vehmenu-actions');
  const hint     = $('#vehmenu-hint');

  let built = false;
  let last = {};

  const LEG = {
    closed: { es: 'Cerrado', en: 'Closed' },
    open:   { es: 'Abierto', en: 'Open' },
    broken: { es: 'Roto',    en: 'Broken' },
  };

  const HINTS = {
    es: 'Pulsa una puerta o una ventanilla del dibujo para accionarla.',
    en: 'Click a door or a window on the diagram to operate it.',
  };

  /* ------------------------------------------------------------------
     Dibujo
     ------------------------------------------------------------------ */
  function carSvg() {
    const handles = [
      [65, 174], [150, 174], [65, 224], [150, 224],
    ].map(([x, y]) => `<rect class="car__handle" x="${x}" y="${y}" width="13" height="3" rx="1.5"/>`).join('');

    return `
    <svg class="car" viewBox="0 0 230 370" role="img" aria-label="Vista cenital del vehiculo">
      <path class="car__chassis" d="M115 14 C134 14 146 20 152 32 L166 64
        C170 74 171 84 171 96 L171 286 C171 300 170 312 166 322 L152 344
        C146 354 134 358 115 358 C96 358 84 354 78 344 L64 322
        C60 312 59 300 59 286 L59 96 C59 84 60 74 64 64 L78 32
        C84 20 96 14 115 14 Z"/>

      <rect class="part part--door" data-door="4" x="76" y="38" width="78" height="48" rx="13"/>
      <path class="car__glass" d="M72 98 L158 98 L150 128 L80 128 Z"/>
      <rect class="car__cabin" x="76" y="130" width="78" height="100" rx="10"/>
      <path class="car__glass" d="M80 234 L150 234 L158 264 L72 264 Z"/>
      <rect class="part part--door" data-door="5" x="76" y="278" width="78" height="48" rx="13"/>

      <rect class="part part--door" data-door="0" x="59"  y="132" width="26" height="48" rx="8"/>
      <rect class="part part--door" data-door="1" x="145" y="132" width="26" height="48" rx="8"/>
      <rect class="part part--door" data-door="2" x="59"  y="186" width="26" height="44" rx="8"/>
      <rect class="part part--door" data-door="3" x="145" y="186" width="26" height="44" rx="8"/>
      ${handles}

      <rect class="part part--window" data-window="0" x="63"  y="136" width="17" height="11" rx="3"/>
      <rect class="part part--window" data-window="1" x="149" y="136" width="17" height="11" rx="3"/>
      <rect class="part part--window" data-window="2" x="63"  y="190" width="17" height="11" rx="3"/>
      <rect class="part part--window" data-window="3" x="149" y="190" width="17" height="11" rx="3"/>

      <rect class="part part--tyre" data-tyre="1" x="34"  y="92"  width="18" height="46" rx="7"/>
      <rect class="part part--tyre" data-tyre="2" x="178" y="92"  width="18" height="46" rx="7"/>
      <rect class="part part--tyre" data-tyre="3" x="34"  y="240" width="18" height="46" rx="7"/>
      <rect class="part part--tyre" data-tyre="4" x="178" y="240" width="18" height="46" rx="7"/>
    </svg>
    <div class="carlegend">
      <span><i class="k"></i>${LEG.closed[NX.config.locale] || LEG.closed.es}</span>
      <span><i class="k k--open"></i>${LEG.open[NX.config.locale] || LEG.open.es}</span>
      <span><i class="k k--broken"></i>${LEG.broken[NX.config.locale] || LEG.broken.es}</span>
    </div>`;
  }

  const gauge = (key, icon, labelKey) => `
    <div class="vg" data-gauge="${key}">
      ${NX.icon(icon, 'vg__icon')}
      <span class="vg__label">${NX.t(labelKey, key)}</span>
      <div class="vg__track"><i class="vg__fill"></i></div>
      <span class="vg__value">0%</span>
    </div>`;

  function build() {
    diagram.innerHTML = carSvg();

    gaugesEl.innerHTML =
      gauge('engine', 'engine', 'veh_engine') +
      gauge('body',   'car',    'veh_body') +
      gauge('fuel',   'fuel',   'fuel');

    actions.innerHTML = `
      <button class="vaction" data-action="lock">
        ${NX.icon('lock')}<span data-lock-label>${NX.t('veh_lock', 'Seguro')}</span>
      </button>
      <button class="vaction" data-action="engine">
        ${NX.icon('power')}<span>${NX.t('veh_engine', 'Motor')}</span>
      </button>`;

    hint.textContent = HINTS[NX.config.locale] || HINTS.es;

    diagram.addEventListener('click', (e) => {
      const part = e.target.closest('[data-door], [data-window]');
      if (!part) return;
      if (part.dataset.door !== undefined) {
        NX.post('vehDoor', { index: parseInt(part.dataset.door, 10) });
      } else {
        NX.post('vehWindow', { index: parseInt(part.dataset.window, 10) });
      }
    });

    actions.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      NX.post(btn.dataset.action === 'lock' ? 'vehLock' : 'vehEngine');
    });

    $$('[data-vehclose]').forEach(n => n.addEventListener('click', close));
    built = true;
  }

  /* ------------------------------------------------------------------
     Datos
     ------------------------------------------------------------------ */
  function update(data) {
    if (!built) build();
    last = data;

    $('#vehmenu-name').textContent = data.name || '—';
    $('#vehmenu-plate').textContent = data.plate || '—';

    const cfg = data.config || {};

    (data.doors || []).forEach(door => {
      const node = $(`[data-door="${door.index}"]`, diagram);
      if (!node) return;
      node.classList.toggle('is-open', !!door.open);
      node.classList.toggle('is-broken', !!door.broken);
      node.classList.toggle('is-off', cfg.doors === false);
    });

    (data.windows || []).forEach(win => {
      const node = $(`[data-window="${win.index}"]`, diagram);
      if (!node) return;
      node.classList.toggle('is-down', !!win.down);
      node.classList.toggle('is-broken', !!win.broken);
      node.classList.toggle('is-off', cfg.windows === false);
    });

    (data.tyres || []).forEach((tyre, i) => {
      const node = $(`[data-tyre="${i + 1}"]`, diagram);
      if (!node) return;
      node.classList.toggle('is-hidden', !tyre.present || cfg.tyres === false);
      node.classList.toggle('is-burst', !!tyre.burst);
      node.classList.toggle('is-gone', !!tyre.gone);
    });

    [['engine', data.engine, 45, 25], ['body', data.body, 45, 25], ['fuel', data.fuel, 22, 10]]
      .forEach(([key, value, warn, danger]) => {
        const node = $(`[data-gauge="${key}"]`, gaugesEl);
        if (!node) return;
        const v = NX.clamp(value ?? 0, 0, 100);
        $('.vg__fill', node).style.width = `${v}%`;
        $('.vg__value', node).textContent = `${Math.round(v)}%`;
        NX.applyLevel(node, NX.level(v, warn, danger));
      });

    const lockBtn = $('[data-action="lock"]', actions);
    if (lockBtn) {
      lockBtn.classList.toggle('is-on', !!data.locked);
      lockBtn.classList.toggle('is-off', cfg.lock === false);
      $('use', lockBtn).setAttribute('href', data.locked ? '#ic-lock' : '#ic-unlock');
      $('[data-lock-label]', lockBtn).textContent =
        data.locked ? NX.t('veh_locked', 'Cerrado') : NX.t('veh_unlocked', 'Abierto');
    }

    const engineBtn = $('[data-action="engine"]', actions);
    if (engineBtn) {
      engineBtn.classList.toggle('is-on', !!data.running);
      engineBtn.classList.toggle('is-off', cfg.allowEngine === false);
    }
  }

  /* ------------------------------------------------------------------
     Apertura
     ------------------------------------------------------------------ */
  function setOpen(state) {
    if (state && !built) build();
    root.classList.toggle('is-hidden', !state);
  }

  function close() {
    setOpen(false);
    NX.post('vehmenuClose');
  }

  function isOpen() { return !root.classList.contains('is-hidden'); }

  function init() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  return { init, update, setOpen, close, isOpen };
})();
