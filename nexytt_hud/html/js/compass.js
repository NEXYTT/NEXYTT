/* =====================================================================
   BRUJULA
   ===================================================================== */

const Compass = (() => {
  const PX_PER_DEG = 2.6;
  const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

  const root    = $('#compass');
  const track   = $('#compass-track');
  const heading = $('#compass-heading');
  const street  = $('#compass-street');
  const zone    = $('#compass-zone');
  const sep     = $('#compass-sep');

  let viewportCenter = 0;

  function build() {
    track.innerHTML = '';
    // Tres vueltas completas para que el desplazamiento nunca deje huecos.
    for (let deg = -360; deg <= 720; deg += 5) {
      const bearing = ((deg % 360) + 360) % 360;
      const isCardinal = bearing % 45 === 0;
      const isMajor = bearing % 15 === 0;

      const tick = NX.el('div', 'compass__tick' + (isMajor ? ' is-major' : '') + (isCardinal ? ' is-cardinal' : ''));
      tick.style.left = `${(deg + 360) * PX_PER_DEG}px`;
      tick.innerHTML = `<i></i>${isCardinal ? `<span>${CARDINALS[bearing]}</span>` : ''}`;
      track.appendChild(tick);
    }

    const viewport = $('.compass__viewport');
    viewportCenter = viewport ? viewport.clientWidth / 2 : 147;
  }

  /* El heading de GTA crece en sentido antihorario (0 = norte, 90 = oeste);
     lo pasamos a rumbo de brujula normal para dibujar la cinta. */
  function toBearing(gtaHeading) {
    return ((360 - (gtaHeading % 360)) + 360) % 360;
  }

  function update(data) {
    if (!data.visible) { root.classList.add('is-hidden'); return; }
    root.classList.remove('is-hidden');

    if (!viewportCenter) build();

    const bearing = toBearing(data.heading ?? 0);
    track.style.transform = `translateX(${viewportCenter - (bearing + 360) * PX_PER_DEG}px)`;
    heading.textContent = `${Math.round(bearing)}°`;

    const streetText = data.crossing ? `${data.street} / ${data.crossing}` : (data.street || '');
    street.textContent = streetText;
    zone.textContent = data.zone || '';
    sep.textContent = streetText && data.zone ? '·' : '';
  }

  function hide() { root.classList.add('is-hidden'); }

  return { init: build, update, hide };
})();
