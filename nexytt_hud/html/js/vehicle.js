/* =====================================================================
   HUD DE VEHICULO
   ===================================================================== */

const VehicleHud = (() => {
  const CX = 110, CY = 110;
  const R_SPEED = 90, R_RPM = 70;
  const FROM = 135, TO = 405;      // 270 grados de barrido, clasico de velocimetro

  const root = $('#vehicle');

  const el = {
    speed:  $('#veh-speed'),
    units:  $('#veh-units'),
    gear:   $('#veh-gear'),
    left:   $('#veh-left'),
    right:  $('#veh-right'),
    speedFill: $('#arc-speed-fill'),
    rpmFill:   $('#arc-rpm-fill'),
    fuel:   $('#vbar-fuel'),
    engine: $('#vbar-engine'),
    side:   $('.vehicle__side'),
    belt:   $('#pill-belt'),
    lights: $('#pill-lights'),
    cruise: $('#pill-cruise'),
  };

  let beltState = false;

  function buildArcs() {
    const speedPath = NX.arcPath(CX, CY, R_SPEED, FROM, TO);
    const rpmPath   = NX.arcPath(CX, CY, R_RPM,   FROM, TO);

    ['#arc-speed-bg', '#arc-speed-fill', '#mask-gauge'].forEach(sel => {
      const n = $(sel); if (n) n.setAttribute('d', speedPath);
    });
    ['#arc-rpm-bg', '#arc-rpm-fill', '#mask-rpm'].forEach(sel => {
      const n = $(sel); if (n) n.setAttribute('d', rpmPath);
    });
  }

  function setBar(barEl, value, warnAt, dangerAt) {
    const fill = $('.vbar__fill', barEl);
    fill.style.height = `${NX.clamp(value, 0, 100)}%`;
    NX.applyLevel(barEl, NX.level(value, warnAt, dangerAt));
  }

  /* ---------------------------------------------------------------- */
  function update(data) {
    if (data.visible === false) {
      root.classList.add('is-hidden');
      return;
    }
    root.classList.remove('is-hidden');

    /* Velocidad y revoluciones */
    el.speed.textContent = data.speed ?? 0;
    el.units.textContent = data.units || 'km/h';
    NX.setArc(el.speedFill, data.speedPct ?? 0);

    const showRpm = data.showRpm !== false;
    NX.setArc(el.rpmFill, showRpm ? (data.rpm ?? 0) : 0);
    el.rpmFill.classList.toggle('is-redline', showRpm && (data.rpm ?? 0) >= 88);

    /* Marcha */
    el.gear.textContent = data.gear ?? 'N';
    el.gear.classList.toggle('is-reverse', data.gear === 'R');

    /* Gasolina y motor */
    const showFuel = data.showFuel !== false;
    const showEngine = data.showEngine !== false;
    el.fuel.classList.toggle('is-hidden', !showFuel);
    el.engine.classList.toggle('is-hidden', !showEngine);
    el.side.classList.toggle('is-hidden', !showFuel && !showEngine);

    if (showFuel)   setBar(el.fuel,   data.fuel ?? 0,   22, 10);
    if (showEngine) setBar(el.engine, data.engine ?? 0, 45, 25);

    /* Pastillas */
    const showBelt = data.showBelt !== false;
    el.belt.classList.toggle('is-hidden', !showBelt);
    beltState = !!data.seatbelt;
    el.belt.classList.toggle('is-on', beltState);
    el.belt.classList.toggle('is-alert', !beltState && (data.speed ?? 0) > 30);

    el.lights.classList.toggle('is-on', !!data.lights);
    el.lights.classList.toggle('is-high', !!data.highBeams);
    el.cruise.classList.toggle('is-on', !!data.cruise);

    /* Intermitentes: 1 derecha, 2 izquierda, 3 ambos */
    const ind = data.indicators ?? 0;
    el.left.classList.toggle('is-on',  ind === 2 || ind === 3);
    el.right.classList.toggle('is-on', ind === 1 || ind === 3);
  }

  function setSeatbelt(on) {
    beltState = !!on;
    el.belt.classList.toggle('is-on', beltState);
  }

  function setCruise(active) {
    el.cruise.classList.toggle('is-on', !!active);
  }

  function hide() { root.classList.add('is-hidden'); }

  function init() { buildArcs(); }

  return { init, update, hide, setSeatbelt, setCruise };
})();
