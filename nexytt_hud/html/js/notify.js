/* =====================================================================
   NOTIFICACIONES
   ===================================================================== */

const Notify = (() => {
  const layer = $('#notifications');
  const queue = [];
  let maxStack = 5;

  const META = {
    success: { icon: 'check', title: 'notify_success' },
    error:   { icon: 'x',     title: 'notify_error'   },
    warning: { icon: 'warn',  title: 'notify_warning' },
    info:    { icon: 'info',  title: 'notify_info'    },
  };

  const FALLBACK = {
    notify_success: 'Correcto', notify_error: 'Error',
    notify_warning: 'Aviso',    notify_info: 'Información',
  };

  /* Sonido sintetizado: evita depender de ficheros de audio en el resource. */
  let audio;
  function blip(kind) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();

      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();

      const freq = kind === 'error' ? 320 : kind === 'warning' ? 520 : 720;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + 0.08);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      osc.connect(gain).connect(audio.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    } catch (_) { /* sin audio disponible: no pasa nada */ }
  }

  function setPosition(position) {
    layer.className = `notifications notifications--${position || 'top-right'}`;
    layer.classList.toggle('has-rail', (position || 'top-right') === 'top-right');
  }

  function trim() {
    const notes = Array.from(layer.children).filter(n => !n.classList.contains('is-out'));
    while (notes.length > maxStack) remove(notes.shift());
  }

  function remove(node) {
    if (!node || node.classList.contains('is-out')) return;
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 280);
  }

  function push(data) {
    const kind = META[data.kind] ? data.kind : 'info';
    const meta = META[kind];
    const duration = Math.max(1200, data.duration || 5000);
    const title = data.title || NX.t(meta.title, FALLBACK[meta.title]);

    const node = NX.el('div', `note note--${kind}`);
    node.innerHTML = `
      <div class="note__icon">${NX.icon(meta.icon)}</div>
      <div class="note__body">
        <div class="note__title">${escapeHtml(title)}</div>
        <div class="note__text">${escapeHtml(data.text || '')}</div>
      </div>
      <div class="note__progress" style="animation-duration:${duration}ms"></div>`;

    layer.appendChild(node);
    trim();

    if (data.sound !== false && NX.settings.notifySound !== false) blip(kind);

    setTimeout(() => remove(node), duration);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function configure(cfg) {
    if (!cfg) return;
    if (cfg.maxStack) maxStack = cfg.maxStack;
    setPosition(cfg.position);
  }

  return { push, configure, setPosition };
})();
