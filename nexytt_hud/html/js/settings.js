/* =====================================================================
   MENU DE AJUSTES
   ===================================================================== */

const Settings = (() => {
  const root    = $('#settings');
  const navEl   = $('#settings-nav');
  const bodyEl  = $('#settings-content');
  const hintEl  = $('#settings-hint');

  const SWATCHES = ['#5B8CFF', '#3ddc97', '#ff5468', '#ffb340', '#c07bff', '#38c6ff', '#ff7ab8', '#e9edf5'];

  const TXT = {
    es: {
      general: 'General', status: 'Estado', vehicle: 'Vehículo', compass: 'Brújula',
      server: 'Servidor', notify: 'Notificaciones', about: 'Acerca de',
      interface: 'Interfaz', colors: 'Color y tamaño', metrics: 'Métricas visibles',
      placement: 'Colocación', gauges: 'Indicadores', panels: 'Paneles', extras: 'Extras',
      reset: 'Restablecer', save: 'Guardar', hint: 'Los cambios se guardan en tu PC y se aplican al instante.',
      title: 'Ajustes del HUD',
    },
    en: {
      general: 'General', status: 'Status', vehicle: 'Vehicle', compass: 'Compass',
      server: 'Server', notify: 'Notifications', about: 'About',
      interface: 'Interface', colors: 'Color & size', metrics: 'Visible metrics',
      placement: 'Placement', gauges: 'Gauges', panels: 'Panels', extras: 'Extras',
      reset: 'Restore', save: 'Save', hint: 'Changes are stored on your PC and applied instantly.',
      title: 'HUD Settings',
    },
  };

  const tx = (k) => (TXT[NX.config.locale] || TXT.es)[k] || k;

  /* --------------------------------------------------------------------
     Esquema del menu. Cada fila apunta a una clave de Config.Defaults.
     -------------------------------------------------------------------- */
  const SCHEMA = () => ([
    {
      id: 'general', icon: 'monitor', label: tx('general'),
      groups: [
        {
          title: tx('interface'),
          rows: [
            { key: 'hudEnabled', type: 'toggle', name: { es: 'Mostrar el HUD', en: 'Show the HUD' },
              desc: { es: 'Apaga todos los elementos de golpe (/hudtoggle).', en: 'Turns every element off at once (/hudtoggle).' } },
            { key: 'theme', type: 'seg', name: { es: 'Tema', en: 'Theme' },
              options: [
                { value: 'dark', label: 'Dark' }, { value: 'midnight', label: 'Midnight' },
                { value: 'carbon', label: 'Carbon' }, { value: 'light', label: 'Light' },
              ] },
          ],
        },
        {
          title: tx('colors'),
          rows: [
            { key: 'accent', type: 'color', name: { es: 'Color de acento', en: 'Accent color' },
              desc: { es: 'Se aplica al velocímetro, la brújula y los botones.', en: 'Applies to the speedometer, compass and buttons.' } },
            { key: 'scale', type: 'slider', min: 60, max: 140, step: 1, unit: '%',
              name: { es: 'Tamaño global', en: 'Global scale' } },
            { key: 'opacity', type: 'slider', min: 30, max: 100, step: 1, unit: '%',
              name: { es: 'Opacidad', en: 'Opacity' } },
          ],
        },
      ],
    },
    {
      id: 'status', icon: 'heart', label: tx('status'),
      groups: [
        {
          title: tx('placement'),
          rows: [
            { key: 'statusLayout', type: 'seg', name: { es: 'Diseño', en: 'Layout' },
              desc: { es: 'Anillos = minimapa circular. Barras = minimapa rectangular por defecto.', en: 'Rings = circular minimap. Bars = default rectangular minimap.' },
              options: [{ value: 'ring', label: { es: 'Anillos', en: 'Rings' } }, { value: 'bars', label: { es: 'Barras', en: 'Bars' } }] },
            { key: 'statusScale', type: 'slider', min: 60, max: 140, step: 1, unit: '%',
              name: { es: 'Tamaño del conjunto', en: 'Cluster scale' } },
            { key: 'statusOffsetX', type: 'slider', min: -80, max: 80, step: 1, unit: 'px',
              name: { es: 'Ajuste horizontal', en: 'Horizontal offset' },
              desc: { es: 'Úsalo para alinear los anillos con tu minimapa.', en: 'Use it to align the rings with your minimap.' } },
            { key: 'statusOffsetY', type: 'slider', min: -80, max: 80, step: 1, unit: 'px',
              name: { es: 'Ajuste vertical', en: 'Vertical offset' } },
          ],
        },
        {
          title: tx('metrics'),
          rows: [
            { key: 'showHealth',  type: 'toggle', name: { es: 'Vida', en: 'Health' } },
            { key: 'showArmor',   type: 'toggle', name: { es: 'Chaleco', en: 'Armor' } },
            { key: 'showHunger',  type: 'toggle', name: { es: 'Hambre', en: 'Hunger' } },
            { key: 'showThirst',  type: 'toggle', name: { es: 'Sed', en: 'Thirst' } },
            { key: 'showStress',  type: 'toggle', name: { es: 'Estrés', en: 'Stress' } },
            { key: 'showOxygen',  type: 'toggle', name: { es: 'Oxígeno', en: 'Oxygen' } },
            { key: 'showStamina', type: 'toggle', name: { es: 'Energía', en: 'Stamina' } },
            { key: 'hideWhenFull', type: 'toggle', name: { es: 'Ocultar al 100%', en: 'Hide when full' },
              desc: { es: 'Solo aparecen cuando de verdad importan.', en: 'They only show up when they actually matter.' } },
          ],
        },
      ],
    },
    {
      id: 'vehicle', icon: 'car', label: tx('vehicle'),
      groups: [
        {
          title: tx('gauges'),
          rows: [
            { key: 'showVehicleHud', type: 'toggle', name: { es: 'Mostrar velocímetro', en: 'Show speedometer' } },
            { key: 'units', type: 'seg', name: { es: 'Unidades', en: 'Units' },
              options: [{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }] },
            { key: 'showRpm',    type: 'toggle', name: { es: 'Revoluciones', en: 'RPM ring' } },
            { key: 'showFuel',   type: 'toggle', name: { es: 'Gasolina', en: 'Fuel' } },
            { key: 'showEngine', type: 'toggle', name: { es: 'Estado del motor', en: 'Engine health' } },
            { key: 'showBelt',   type: 'toggle', name: { es: 'Cinturón', en: 'Seatbelt' } },
          ],
        },
      ],
    },
    {
      id: 'compass', icon: 'compass', label: tx('compass'),
      groups: [
        {
          title: tx('panels'),
          rows: [
            { key: 'showCompass', type: 'toggle', name: { es: 'Mostrar brújula', en: 'Show compass' } },
            { key: 'showStreet',  type: 'toggle', name: { es: 'Calle y zona', en: 'Street and zone' } },
          ],
        },
      ],
    },
    {
      id: 'server', icon: 'map', label: tx('server'),
      groups: [
        {
          title: tx('panels'),
          rows: [
            { key: 'showServerPanel', type: 'toggle', name: { es: 'Panel del servidor', en: 'Server panel' } },
            { key: 'showPlayers',     type: 'toggle', name: { es: 'Jugadores conectados', en: 'Players online' } },
            { key: 'showMoney',       type: 'toggle', name: { es: 'Dinero', en: 'Money' } },
            { key: 'showVoice',       type: 'toggle', name: { es: 'Indicador de voz', en: 'Voice indicator' } },
          ],
        },
      ],
    },
    {
      id: 'notify', icon: 'bell', label: tx('notify'),
      groups: [
        {
          title: tx('extras'),
          rows: [
            { key: 'notifySound',   type: 'toggle', name: { es: 'Sonido de notificación', en: 'Notification sound' } },
            { key: 'stressEffects', type: 'toggle', name: { es: 'Efectos de estrés', en: 'Stress effects' },
              desc: { es: 'Desenfoque y temblor de cámara con el estrés alto.', en: 'Blur and camera shake at high stress.' } },
            { key: 'cinematicBars', type: 'toggle', name: { es: 'Barras de cine', en: 'Cinematic bars' },
              desc: { es: 'También con /cinematic.', en: 'Also via /cinematic.' } },
          ],
        },
      ],
    },
    { id: 'about', icon: 'star', label: tx('about'), about: true },
  ]);

  let current = 'general';

  /* --------------------------------------------------------------------
     Render
     -------------------------------------------------------------------- */
  const pick = (v) => (typeof v === 'object' && v !== null ? (v[NX.config.locale] || v.es || v.en) : v);

  function renderNav(schema) {
    navEl.innerHTML = '';
    schema.forEach(cat => {
      const btn = NX.el('button', 'navitem' + (cat.id === current ? ' is-active' : ''));
      btn.innerHTML = `${NX.icon(cat.icon)}<span>${cat.label}</span>`;
      btn.addEventListener('click', () => { current = cat.id; render(); });
      navEl.appendChild(btn);
    });
  }

  function renderRow(row) {
    const node = NX.el('div', 'row');
    const desc = pick(row.desc);
    node.innerHTML = `
      <div class="row__label">
        <div class="row__name">${pick(row.name)}</div>
        ${desc ? `<div class="row__desc">${desc}</div>` : ''}
      </div>
      <div class="row__control"></div>`;

    const control = $('.row__control', node);
    const value = NX.settings[row.key];

    if (row.type === 'toggle') {
      const sw = NX.el('button', 'switch' + (value ? ' is-on' : ''));
      sw.addEventListener('click', () => {
        const next = !NX.settings[row.key];
        sw.classList.toggle('is-on', next);
        commit(row.key, next);
      });
      control.appendChild(sw);
    }

    if (row.type === 'slider') {
      const wrap = NX.el('div', 'slider');
      const input = NX.el('input');
      input.type = 'range';
      input.min = row.min; input.max = row.max; input.step = row.step || 1;
      input.value = value;

      const out = NX.el('span', 'slider__value', `${value}${row.unit || ''}`);
      const paint = () => {
        const pct = ((input.value - row.min) / (row.max - row.min)) * 100;
        input.style.setProperty('--pct', `${pct}%`);
      };

      input.addEventListener('input', () => {
        out.textContent = `${input.value}${row.unit || ''}`;
        paint();
        commit(row.key, parseInt(input.value, 10));
      });

      paint();
      wrap.append(input, out);
      control.appendChild(wrap);
    }

    if (row.type === 'seg') {
      const seg = NX.el('div', 'seg');
      row.options.forEach(opt => {
        const btn = NX.el('button', value === opt.value ? 'is-active' : '', pick(opt.label));
        btn.addEventListener('click', () => {
          $$('button', seg).forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          commit(row.key, opt.value);
        });
        seg.appendChild(btn);
      });
      control.appendChild(seg);
    }

    if (row.type === 'color') {
      const wrap = NX.el('div', 'swatches');
      SWATCHES.forEach(hex => {
        const sw = NX.el('button', 'swatch' + (String(value).toLowerCase() === hex.toLowerCase() ? ' is-active' : ''));
        sw.style.background = hex;
        sw.addEventListener('click', () => {
          $$('.swatch', wrap).forEach(b => b.classList.remove('is-active'));
          sw.classList.add('is-active');
          commit(row.key, hex);
        });
        wrap.appendChild(sw);
      });

      const custom = NX.el('button', 'swatch swatch--custom');
      const input = NX.el('input');
      input.type = 'color';
      input.value = value || '#5B8CFF';
      input.addEventListener('input', () => {
        $$('.swatch', wrap).forEach(b => b.classList.remove('is-active'));
        custom.classList.add('is-active');
        commit(row.key, input.value);
      });
      custom.appendChild(input);
      wrap.appendChild(custom);

      control.appendChild(wrap);
    }

    return node;
  }

  function renderAbout() {
    const es = NX.config.locale === 'es';
    const wrap = NX.el('div', 'about');
    wrap.innerHTML = `
      <div class="about__card">
        <h3>nexytt_hud</h3>
        <p>${es
          ? 'HUD completo con detección automática de framework. Funciona sobre ESX Legacy, QBCore, QBox o sin framework.'
          : 'Full HUD with automatic framework detection. Works on ESX Legacy, QBCore, QBox or standalone.'}</p>
      </div>
      <div class="about__card">
        <div class="about__kv"><span>${es ? 'Versión' : 'Version'}</span><b>1.0.0</b></div>
        <div class="about__kv"><span>Framework</span><b id="about-fw">—</b></div>
        <div class="about__kv"><span>${es ? 'Autor' : 'Author'}</span><b>NEXYTT</b></div>
      </div>
      <div class="about__card">
        <h3>${es ? 'Atajos' : 'Shortcuts'}</h3>
        <div class="about__keys">
          <kbd>F7</kbd><kbd>/hud</kbd><kbd>/hudtoggle</kbd><kbd>/cinematic</kbd><kbd>B — ${es ? 'cinturón' : 'seatbelt'}</kbd><kbd>Re Pág — ${es ? 'crucero' : 'cruise'}</kbd>
        </div>
      </div>`;
    const fw = $('#about-fw', wrap);
    if (fw) fw.textContent = NX.state.framework || '—';
    return wrap;
  }

  function render() {
    const schema = SCHEMA();
    renderNav(schema);

    const cat = schema.find(c => c.id === current) || schema[0];
    bodyEl.innerHTML = '';
    bodyEl.scrollTop = 0;

    if (cat.about) { bodyEl.appendChild(renderAbout()); return; }

    cat.groups.forEach(group => {
      const g = NX.el('div', 'group');
      g.appendChild(NX.el('div', 'group__title', group.title));
      group.rows.forEach(row => g.appendChild(renderRow(row)));
      bodyEl.appendChild(g);
    });
  }

  /* --------------------------------------------------------------------
     Aplicacion en vivo
     -------------------------------------------------------------------- */
  function commit(key, value) {
    NX.settings[key] = value;
    App.applySettings();
    NX.post('set', { key, value });
  }

  /* --------------------------------------------------------------------
     Apertura / cierre
     -------------------------------------------------------------------- */
  function open(settings) {
    if (settings) Object.assign(NX.settings, settings);
    $('#settings-title').textContent = tx('title');
    $('#btn-reset').textContent = tx('reset');
    $('#btn-save').textContent = tx('save');
    hintEl.textContent = tx('hint');
    render();
    root.classList.remove('is-hidden', 'is-closing');
  }

  function close(silent) {
    if (root.classList.contains('is-hidden')) return;
    root.classList.add('is-closing');
    setTimeout(() => root.classList.add('is-hidden'), 180);
    if (!silent) NX.post('close');
  }

  function isOpen() { return !root.classList.contains('is-hidden'); }

  function init() {
    $$('[data-close]').forEach(node => node.addEventListener('click', () => close()));

    $('#btn-save').addEventListener('click', () => { NX.post('save'); close(); });

    $('#btn-reset').addEventListener('click', () => {
      NX.post('reset').then(res => {
        if (res && res.settings) {
          Object.assign(NX.settings, res.settings);
          App.applySettings();
          render();
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  return { init, open, close, isOpen, render };
})();
