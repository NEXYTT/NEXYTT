/* =====================================================================
   PANELES: SERVIDOR · DINERO · VOZ
   ===================================================================== */

const Panels = (() => {
  const rail   = $('.rail');
  const server = $('#server');
  const chips  = $('#server-chips');
  const money  = $('#money');
  const voice  = $('#voice');

  const moneyEls = {
    cash:  { row: $('.money__row[data-key="cash"]'),  value: $('#money-cash'),  delta: $('#money-cash-delta')  },
    bank:  { row: $('.money__row[data-key="bank"]'),  value: $('#money-bank'),  delta: $('#money-bank-delta')  },
    black: { row: $('.money__row[data-key="black"]'), value: $('#money-black'), delta: $('#money-black-delta') },
  };

  /* ---------------------------------------------------------------- */
  function updateServer(data) {
    if (!data.visible) { server.classList.add('is-hidden'); measureRail(); return; }
    server.classList.remove('is-hidden');

    $('#server-name').textContent = data.name || NX.config.serverName;
    $('#server-logo').textContent = (data.name || 'N').trim().charAt(0).toUpperCase();
    $('.server__head').classList.toggle('is-hidden', data.showLogo === false);

    const items = [];
    if (data.players !== undefined && data.players !== null) {
      const cap = data.maxPlayers ? `<i>/${data.maxPlayers}</i>` : '';
      items.push(`<span class="chip">${NX.icon('users')}<span class="chip__pair"><b>${data.players}</b>${cap}</span></span>`);
    }
    if (data.id !== undefined && data.id !== null) {
      items.push(`<span class="chip">${NX.icon('id')}<b>${data.id}</b></span>`);
    }
    if (data.time) {
      items.push(`<span class="chip">${NX.icon('clock')}<b>${data.time}</b></span>`);
    }
    if (data.job) {
      items.push(`<span class="chip chip--job">${NX.icon('job')}<b>${escapeHtml(data.job)}</b></span>`);
    }

    chips.innerHTML = items.join('');
    chips.classList.toggle('is-hidden', items.length === 0);
    measureRail();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---------------------------------------------------------------- */
  function updateMoney(data) {
    if (!data.visible) { money.classList.add('is-hidden'); measureRail(); return; }
    money.classList.remove('is-hidden');

    const currency = data.currency || NX.config.currency || '$';

    ['cash', 'bank', 'black'].forEach(key => {
      const ref = moneyEls[key];
      const raw = data[key];
      const show = raw !== undefined && raw !== null;

      ref.row.classList.toggle('is-hidden', !show);
      if (!show) return;

      ref.value.textContent = `${currency}${raw}`;

      const delta = data.changes ? data.changes[key] : undefined;
      if (typeof delta === 'number' && delta !== 0) {
        ref.delta.textContent = `${delta > 0 ? '+' : '−'}${currency}${NX.money(Math.abs(delta))}`;
        ref.delta.classList.toggle('is-up', delta > 0);
        ref.delta.classList.toggle('is-down', delta < 0);
        ref.delta.classList.remove('is-live');
        void ref.delta.offsetWidth;     // reinicia la animacion
        ref.delta.classList.add('is-live');
      }
    });

    measureRail();
  }

  /* ---------------------------------------------------------------- */
  function updateVoice(data) {
    if (!data.visible) { voice.classList.add('is-hidden'); return; }
    voice.classList.remove('is-hidden');

    voice.dataset.range = data.range || 2;
    voice.classList.toggle('is-talking', !!data.talking);
    $('#voice-label').textContent = data.label || '';

    const radio = $('#voice-radio');
    const on = (data.radio || 0) > 0;
    radio.classList.toggle('is-hidden', !on);
    radio.classList.toggle('is-live', on && !!data.radioTalking);
    if (on) $('b', radio).textContent = data.radio;
  }

  /* Deja las notificaciones justo debajo de la columna derecha. */
  function measureRail() {
    const h = rail.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--rail-height', `${Math.round(h)}px`);
  }

  function init() {
    measureRail();
    if (window.ResizeObserver) new ResizeObserver(measureRail).observe(rail);
  }

  return { init, updateServer, updateMoney, updateVoice, measureRail };
})();
