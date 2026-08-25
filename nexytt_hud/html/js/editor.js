/* =====================================================================
   EDITOR DE POSICION — arrastra cada bloque del HUD donde quieras
   ===================================================================== */

const Editor = (() => {
  const overlay = $('#editor');
  const hud = $('#hud');

  const NAMES = {
    status:        { es: 'Estado',          en: 'Status' },
    vehicle:       { es: 'Vehículo',        en: 'Vehicle' },
    compass:       { es: 'Brújula',         en: 'Compass' },
    rail:          { es: 'Servidor y dinero', en: 'Server & money' },
    notifications: { es: 'Notificaciones',  en: 'Notifications' },
    weapon:        { es: 'Arma',            en: 'Weapon' },
    voice:         { es: 'Voz',             en: 'Voice' },
  };

  let open = false;
  let positions = {};
  let snapshot = {};
  let drag = null;

  const modules = () => $$('[data-module]', hud);
  const name = (key) => (NAMES[key] || {})[NX.config.locale] || (NAMES[key] || {}).es || key;

  /* ------------------------------------------------------------------
     Aplicar posiciones guardadas
     ------------------------------------------------------------------ */
  function applyPositions(next) {
    positions = next || {};

    modules().forEach(el => {
      const pos = positions[el.dataset.module];
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        el.style.left = `${pos.x}%`;
        el.style.top = `${pos.y}%`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transformOrigin = 'top left';
      } else {
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.transformOrigin = '';
      }
    });
  }

  /* ------------------------------------------------------------------
     Arrastre
     ------------------------------------------------------------------ */
  function pinDown(el) {
    // Fijamos el bloque por su esquina superior izquierda visible, para que
    // no salte al cambiarle el anclaje.
    const r = el.getBoundingClientRect();
    el.style.transformOrigin = 'top left';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    return r;
  }

  function onPointerDown(e) {
    if (!open) return;
    const el = e.target.closest('[data-module]');
    if (!el) return;

    e.preventDefault();
    const r = pinDown(el);
    drag = { el, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    el.classList.add('is-dragging');
  }

  function onPointerMove(e) {
    if (!drag) return;

    let x = e.clientX - drag.dx;
    let y = e.clientY - drag.dy;

    // Imán al centro y a los bordes
    const cx = (innerWidth - drag.w) / 2;
    if (Math.abs(x - cx) < 9) x = cx;
    if (Math.abs(x) < 9) x = 0;
    if (Math.abs(x + drag.w - innerWidth) < 9) x = innerWidth - drag.w;
    if (Math.abs(y) < 9) y = 0;
    if (Math.abs(y + drag.h - innerHeight) < 9) y = innerHeight - drag.h;

    x = NX.clamp(x, -drag.w * 0.5, innerWidth - drag.w * 0.5);
    y = NX.clamp(y, -drag.h * 0.5, innerHeight - drag.h * 0.5);

    drag.el.style.left = `${x}px`;
    drag.el.style.top = `${y}px`;
  }

  function onPointerUp() {
    if (!drag) return;

    const el = drag.el;
    const r = el.getBoundingClientRect();
    positions[el.dataset.module] = {
      x: Math.round((r.left / innerWidth) * 1000) / 10,
      y: Math.round((r.top / innerHeight) * 1000) / 10,
    };

    el.classList.remove('is-dragging');
    drag = null;
    applyPositions(positions);
  }

  /* ------------------------------------------------------------------
     Apertura / cierre
     ------------------------------------------------------------------ */
  function markGhosts() {
    modules().forEach(el => {
      el.dataset.moduleLabel = name(el.dataset.module);
      const r = el.getBoundingClientRect();
      el.classList.toggle('is-ghost', r.width < 24 || r.height < 16);
    });
  }

  function start(saved) {
    if (open) return;
    open = true;

    snapshot = JSON.parse(JSON.stringify(saved || positions || {}));
    applyPositions(saved || positions);

    hud.classList.add('is-editing');
    hud.classList.remove('is-hidden');
    overlay.classList.remove('is-hidden');

    $('#editor-title').textContent = NX.t('editor_title', 'Mover elementos');
    $('#editor-help').textContent = NX.t('editor_help', '');

    markGhosts();

    addEventListener('pointerdown', onPointerDown, true);
    addEventListener('pointermove', onPointerMove);
    addEventListener('pointerup', onPointerUp);
  }

  function stop() {
    if (!open) return;
    open = false;
    drag = null;

    hud.classList.remove('is-editing');
    overlay.classList.add('is-hidden');
    modules().forEach(el => el.classList.remove('is-ghost', 'is-dragging'));

    removeEventListener('pointerdown', onPointerDown, true);
    removeEventListener('pointermove', onPointerMove);
    removeEventListener('pointerup', onPointerUp);
  }

  function cancel() {
    applyPositions(snapshot);
    NX.settings.positions = snapshot;
    stop();
    NX.post('closeEditor');
  }

  function save() {
    NX.settings.positions = positions;
    stop();
    NX.post('savePositions', { positions });
  }

  function reset() {
    positions = {};
    applyPositions({});
    NX.post('resetPositions');
    markGhosts();
  }

  function init() {
    $('#editor-save').addEventListener('click', save);
    $('#editor-cancel').addEventListener('click', cancel);
    $('#editor-reset').addEventListener('click', reset);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) cancel();
    });

    addEventListener('resize', () => { if (open) markGhosts(); });
  }

  function isOpen() { return open; }

  return { init, start, stop, cancel, applyPositions, isOpen };
})();
