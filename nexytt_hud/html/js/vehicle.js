/* =====================================================================
   HUD DE VEHICULO — cuatro velocimetros
   circle · needle · bar · minimal
   ===================================================================== */

const VehicleHud = (() => {
  const CX = 110, CY = 110;
  const R_SPEED = 90, R_RPM = 70, R_TICK = 92;
  const FROM = 135, TO = 405;               // 270 grados de barrido

  const root = $('#vehicle');
  let refs = {};
  let signature = '';

  /* ------------------------------------------------------------------
     Piezas compartidas
     ------------------------------------------------------------------ */
  const pill = (name, icon) => `<span class="pill" data-pill="${name}">${NX.icon(icon)}</span>`;

  const pills = (d) => `
    <div class="vpills">
      ${d.showBelt !== false ? pill('belt', 'belt') : ''}
      ${pill('lights', 'light')}
      ${pill('cruise', 'cruise')}
    </div>`;

  const meter = (key, icon, vertical) => `
    <div class="vmeter${vertical ? '' : ' vmeter--h'}" data-metric="${key}">
      <div class="vmeter__track"><i class="f"></i></div>
      ${NX.icon(icon, 'vmeter__icon')}
    </div>`;

  const meters = (d, vertical) => {
    const parts = [];
    if (d.showFuel !== false)   parts.push(meter('fuel', 'fuel', vertical));
    if (d.showEngine !== false) parts.push(meter('engine', 'engine', vertical));
    if (!parts.length) return '';
    return `<div class="vmeters${vertical ? '' : ' vmeters--h'}">${parts.join('')}</div>`;
  };

  const blinkers = () => `
    <div class="blink blink--left">${NX.icon('left')}</div>
    <div class="blink blink--right">${NX.icon('right')}</div>`;

  const segMask = (id, d, width) => `
    <mask id="${id}">
      <path d="${d}" fill="none" stroke="#fff" stroke-width="${width}"
            stroke-linecap="butt" stroke-dasharray="1.1 0.7" pathLength="100"/>
    </mask>`;

  /* ------------------------------------------------------------------
     Estilos
     ------------------------------------------------------------------ */
  const builders = {

    circle(d) {
      const speedPath = NX.arcPath(CX, CY, R_SPEED, FROM, TO);
      const rpmPath   = NX.arcPath(CX, CY, R_RPM,   FROM, TO);
      const showRpm   = d.showRpm !== false;

      return `
        ${meters(d, true)}
        <div class="gauge gauge--circle">
          <svg class="gauge__svg" viewBox="0 0 220 220">
            <defs>
              ${segMask('mk-speed', speedPath, 15)}
              ${showRpm ? segMask('mk-rpm', rpmPath, 6) : ''}
            </defs>
            <g mask="url(#mk-speed)">
              <path class="arc arc--bg" d="${speedPath}" pathLength="100" stroke-width="15"/>
              <path class="arc arc--speed sp-speed" d="${speedPath}" pathLength="100"/>
            </g>
            ${showRpm ? `
            <g mask="url(#mk-rpm)">
              <path class="arc arc--bg" d="${rpmPath}" pathLength="100" stroke-width="6"/>
              <path class="arc arc--rpm sp-rpm" d="${rpmPath}" pathLength="100"/>
            </g>` : ''}
          </svg>
          <div class="gauge__center">
            <span class="gauge__speed sp-value">0</span>
            <span class="gauge__units sp-units">km/h</span>
          </div>
          <div class="gauge__gear sp-gear">N</div>
          ${blinkers()}
        </div>
        ${pills(d)}`;
    },

    needle(d) {
      const max = d.maxSpeed || 300;
      const showRpm = d.showRpm !== false;
      const rpmPath = NX.arcPath(CX, CY, R_RPM + 26, FROM, TO);

      let ticks = '';
      for (let i = 0; i <= 30; i++) {
        const angle = FROM + (i / 30) * 270;
        const major = i % 5 === 0;
        const a = NX.polar(CX, CY, R_TICK, angle);
        const b = NX.polar(CX, CY, R_TICK - (major ? 15 : 8), angle);
        ticks += `<line class="tick${major ? ' tick--major' : ''}"
                        x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}"
                        x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
        if (major && i !== 0 && i !== 30) {
          const t = NX.polar(CX, CY, R_TICK - 30, angle);
          ticks += `<text class="tnum" x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}"
                          text-anchor="middle" dominant-baseline="central">${Math.round(max * i / 30)}</text>`;
        }
      }

      const redline = NX.arcPath(CX, CY, R_TICK + 6, FROM + 270 * 0.82, TO);

      return `
        ${meters(d, true)}
        <div class="gauge gauge--needle">
          <svg class="gauge__svg" viewBox="0 0 220 220">
            <circle class="dial" cx="${CX}" cy="${CY}" r="${R_TICK + 10}"/>
            <path class="redline" d="${redline}"/>
            ${ticks}
            ${showRpm ? `<path class="arc arc--rpm sp-rpm" d="${rpmPath}" pathLength="100" stroke-width="4"/>` : ''}
          </svg>
          <div class="needle sp-needle"><i></i></div>
          <div class="needle__cap"></div>
          <div class="gauge__digital">
            <span class="sp-value">0</span><span class="sp-units">km/h</span>
          </div>
          <div class="gauge__gear sp-gear">N</div>
          ${blinkers()}
        </div>
        ${pills(d)}`;
    },

    bar(d) {
      const showRpm = d.showRpm !== false;
      return `
        <div class="vbarhud">
          <div class="vbarhud__read">
            <span class="sp-value">0</span>
            <span class="vbarhud__unit sp-units">km/h</span>
            <span class="vbarhud__gear sp-gear">N</span>
          </div>
          ${showRpm ? '<div class="vbarhud__rpm"><i class="sp-rpm-lin"></i></div>' : ''}
          <div class="vbarhud__foot">
            ${meters(d, false)}
            ${pills(d)}
          </div>
          ${blinkers()}
        </div>`;
    },

    minimal(d) {
      return `
        <div class="vmini">
          <span class="sp-value">0</span>
          <span class="vmini__unit sp-units">km/h</span>
          <span class="vmini__gear sp-gear">N</span>
          ${d.showBelt !== false ? pill('belt', 'belt') : ''}
          ${d.showFuel !== false ? '<div class="vmini__fuel" data-metric="fuel"><i class="f"></i></div>' : ''}
        </div>`;
    },
  };

  /* ------------------------------------------------------------------
     Reconstrucción
     ------------------------------------------------------------------ */
  function rebuild(style, d) {
    root.dataset.style = style;
    root.innerHTML = (builders[style] || builders.circle)(d);

    refs = {
      value:  $('.sp-value', root),
      units:  $('.sp-units', root),
      gear:   $('.sp-gear', root),
      speed:  $('.sp-speed', root),
      rpm:    $('.sp-rpm', root),
      rpmLin: $('.sp-rpm-lin', root),
      needle: $('.sp-needle', root),
      left:   $('.blink--left', root),
      right:  $('.blink--right', root),
      meters: {},
      pills:  {},
    };

    $$('[data-metric]', root).forEach(n => {
      refs.meters[n.dataset.metric] = { node: n, fill: $('.f', n) };
    });
    $$('[data-pill]', root).forEach(n => { refs.pills[n.dataset.pill] = n; });
  }

  /* ------------------------------------------------------------------
     Actualización
     ------------------------------------------------------------------ */
  function update(data) {
    if (data.visible === false) { root.classList.add('is-hidden'); return; }
    root.classList.remove('is-hidden');

    const style = NX.settings.speedoStyle || 'circle';
    const sig = [style, data.showRpm, data.showFuel, data.showEngine, data.showBelt, data.maxSpeed].join('|');
    if (sig !== signature) {
      signature = sig;
      rebuild(style, data);
    }

    const speedPct = NX.clamp(data.speedPct ?? 0, 0, 100);
    const rpm = NX.clamp(data.rpm ?? 0, 0, 100);

    if (refs.value) refs.value.textContent = data.speed ?? 0;
    if (refs.units) refs.units.textContent = data.units || 'km/h';

    if (refs.speed) NX.setArc(refs.speed, speedPct);
    if (refs.rpm)   NX.setArc(refs.rpm, rpm);
    if (refs.rpmLin) refs.rpmLin.style.width = `${rpm}%`;
    if (refs.needle) refs.needle.style.transform = `rotate(${135 + speedPct * 2.7}deg)`;

    const redline = rpm >= 88;
    if (refs.rpm)    refs.rpm.classList.toggle('is-redline', redline);
    if (refs.rpmLin) refs.rpmLin.classList.toggle('is-redline', redline);

    if (refs.gear) {
      refs.gear.textContent = data.gear ?? 'N';
      refs.gear.classList.toggle('is-reverse', data.gear === 'R');
    }

    const fuel = refs.meters.fuel;
    if (fuel) {
      const v = NX.clamp(data.fuel ?? 0, 0, 100);
      fuel.node.style.setProperty('--v', `${v}%`);
      if (fuel.fill) fuel.fill.style.setProperty('--v', `${v}%`);
      NX.applyLevel(fuel.node, NX.level(v, 22, 10));
    }

    const engine = refs.meters.engine;
    if (engine) {
      const v = NX.clamp(data.engine ?? 0, 0, 100);
      engine.node.style.setProperty('--v', `${v}%`);
      NX.applyLevel(engine.node, NX.level(v, 45, 25));
    }

    const belt = refs.pills.belt;
    if (belt) {
      belt.classList.toggle('is-on', !!data.seatbelt);
      belt.classList.toggle('is-alert', !data.seatbelt && (data.speed ?? 0) > 30);
    }
    const lights = refs.pills.lights;
    if (lights) {
      lights.classList.toggle('is-on', !!data.lights);
      lights.classList.toggle('is-high', !!data.highBeams);
    }
    const cruise = refs.pills.cruise;
    if (cruise) cruise.classList.toggle('is-on', !!data.cruise);

    const ind = data.indicators ?? 0;
    if (refs.left)  refs.left.classList.toggle('is-on',  ind === 2 || ind === 3);
    if (refs.right) refs.right.classList.toggle('is-on', ind === 1 || ind === 3);
  }

  function setSeatbelt(on) {
    if (refs.pills && refs.pills.belt) refs.pills.belt.classList.toggle('is-on', !!on);
  }
  function setCruise(active) {
    if (refs.pills && refs.pills.cruise) refs.pills.cruise.classList.toggle('is-on', !!active);
  }

  function applyStyle() { signature = ''; root.dataset.style = NX.settings.speedoStyle || 'circle'; }
  function hide() { root.classList.add('is-hidden'); }
  function init() { applyStyle(); }

  return { init, update, hide, setSeatbelt, setCruise, applyStyle, STYLES: ['circle', 'needle', 'bar', 'minimal'] };
})();
