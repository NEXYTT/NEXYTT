/* =====================================================================
   ENRUTADO DE MENSAJES Y ARRANQUE
   ===================================================================== */

const App = (() => {
  const hud = $('#hud');
  let hudVisible = true;

  /* ------------------------------------------------------------------
     Aplica los ajustes a toda la interfaz
     ------------------------------------------------------------------ */
  function applySettings() {
    const s = NX.settings;

    NX.applyTokens(s);
    Status.applyLayout();

    hud.classList.toggle('is-hidden', !hudVisible || s.hudEnabled === false);

    $('.rail').classList.toggle('is-hidden', s.showServerPanel === false && s.showMoney === false);
    if (s.showCompass === false) Compass.hide();
    if (s.showVehicleHud === false) VehicleHud.hide();
    if (s.showVoice === false) $('#voice').classList.add('is-hidden');

    $('#cinematic').classList.toggle('is-active', !!s.cinematicBars);

    Panels.measureRail();
  }

  /* ------------------------------------------------------------------
     Router
     ------------------------------------------------------------------ */
  const handlers = {
    settings(d) {
      if (d.config) Object.assign(NX.config, d.config);
      if (d.settings) Object.assign(NX.settings, d.settings);
      Notify.configure(NX.config.notify);
      applySettings();
      if (Settings.isOpen()) Settings.render();
    },

    visible(d) {
      hudVisible = d.visible !== false;
      hud.classList.toggle('is-hidden', !hudVisible || NX.settings.hudEnabled === false);
    },

    status(d)   { Status.update(d); },
    vehicle(d)  { VehicleHud.update(d); },
    compass(d)  { Compass.update(d); },
    voice(d)    { Panels.updateVoice(d); },
    money(d)    { Panels.updateMoney(d); },
    server(d)   { NX.state.framework = d.framework; Panels.updateServer(d); },
    notify(d)   { Notify.push(d); },
    seatbelt(d) { VehicleHud.setSeatbelt(d.on); },
    cruise(d)   { VehicleHud.setCruise(d.active); },

    cinematic(d) {
      NX.settings.cinematicBars = !!d.active;
      $('#cinematic').classList.toggle('is-active', !!d.active);
    },

    openSettings(d)  { Settings.open(d.settings); },
    closeSettings()  { Settings.close(true); },
  };

  function onMessage(event) {
    const data = event.data;
    if (!data || !data.action) return;
    const fn = handlers[data.action];
    if (fn) fn(data);
  }

  /* ------------------------------------------------------------------
     Arranque
     ------------------------------------------------------------------ */
  function init() {
    Status.init();
    VehicleHud.init();
    Compass.init();
    Panels.init();
    Settings.init();

    window.addEventListener('message', onMessage);
    window.addEventListener('resize', () => { Compass.init(); Panels.measureRail(); });

    NX.post('ready');

    if (!NX.inGame) Demo.start();
  }

  return { init, applySettings, handlers };
})();

/* =====================================================================
   MODO DEMO — solo se activa al abrir el HTML fuera de FiveM.
   Sirve para previsualizar y ajustar el diseño sin levantar el servidor.
   ===================================================================== */
const Demo = (() => {
  const S = {
    health: 100, armor: 62, hunger: 74, thirst: 58, stress: 22, oxygen: 100, stamina: 100,
    heading: 210, speed: 0, rpm: 0, fuel: 78, engine: 92, gear: 'N',
    cash: 4820, bank: 152400, black: 3100,
    inVehicle: false, belt: false, indicators: 0, t: 0,
  };

  const STREETS = [
    ['Vespucci Blvd', 'Prosperity St', 'Vespucci Beach'],
    ['Alta St', 'Las Lagunas Blvd', 'Alta'],
    ['Route 68', '', 'Grand Senora Desert'],
    ['Elgin Ave', 'Vinewood Blvd', 'Downtown Vinewood'],
  ];

  function seedSettings() {
    Object.assign(NX.settings, {
      hudEnabled: true, accent: '#5B8CFF', scale: 100, opacity: 100, theme: 'dark',
      statusLayout: 'ring', statusOffsetX: 0, statusOffsetY: 0, statusScale: 100,
      showHealth: true, showArmor: true, showHunger: true, showThirst: true,
      showStress: true, showOxygen: true, showStamina: true, hideWhenFull: false,
      showVehicleHud: true, units: 'kmh', showRpm: true, showFuel: true, showEngine: true, showBelt: true,
      showCompass: true, showStreet: true,
      showServerPanel: true, showMoney: true, showVoice: true, showPlayers: true,
      notifySound: false, stressEffects: true, cinematicBars: false,
    });
    NX.state.framework = 'demo';
    App.handlers.settings({ settings: NX.settings, config: { locale: 'es', currency: '$', serverName: 'NEXYTT RP', notify: { position: 'top-right', maxStack: 5 } } });
  }

  function tick() {
    S.t += 0.1;

    /* Estado */
    S.hunger = Math.max(0, S.hunger - 0.02);
    S.thirst = Math.max(0, S.thirst - 0.03);
    S.stress = 30 + Math.sin(S.t / 7) * 28;
    S.stamina = 60 + Math.sin(S.t / 2) * 40;
    S.health = 78 + Math.sin(S.t / 11) * 20;

    App.handlers.status({
      health: S.health, armor: S.armor, hunger: S.hunger, thirst: S.thirst,
      stress: S.stress, oxygen: S.oxygen, stamina: S.stamina,
      underwater: false, warnAt: 25, dangerAt: 12,
    });

    /* Brujula */
    S.heading = (S.heading + (S.inVehicle ? 0.9 : 0.35)) % 360;
    const place = STREETS[Math.floor(S.t / 18) % STREETS.length];
    App.handlers.compass({
      visible: true, heading: S.heading,
      street: place[0], crossing: place[1], zone: place[2],
    });

    /* Vehiculo */
    if (S.inVehicle) {
      const target = 40 + Math.sin(S.t / 5) * 55 + 40;
      S.speed += (target - S.speed) * 0.06;
      S.rpm = NX.clamp(28 + (S.speed / 160) * 70 + Math.sin(S.t * 2) * 6, 5, 100);
      S.fuel = Math.max(0, S.fuel - 0.012);
      S.gear = S.speed < 3 ? 'N' : String(Math.min(6, Math.max(1, Math.round(S.speed / 26))));
      S.indicators = Math.floor(S.t / 9) % 6 === 0 ? 2 : (Math.floor(S.t / 9) % 6 === 3 ? 1 : 0);

      App.handlers.vehicle({
        visible: true, speed: Math.round(S.speed), speedPct: (S.speed / 300) * 100,
        units: 'km/h', rpm: S.rpm, gear: S.gear, fuel: S.fuel, engine: S.engine,
        lights: true, highBeams: false, indicators: S.indicators,
        seatbelt: S.belt, cruise: false,
        showRpm: true, showFuel: true, showEngine: true, showBelt: true,
      });
    } else {
      App.handlers.vehicle({ visible: false });
    }

    /* Voz */
    App.handlers.voice({
      visible: true, range: 2, label: 'Normal',
      talking: Math.sin(S.t / 3) > 0.6, radio: 3, radioTalking: false,
    });
  }

  function slow() {
    App.handlers.server({
      visible: true, name: 'NEXYTT RP', showLogo: true,
      players: 48 + Math.floor(Math.sin(S.t / 20) * 6), maxPlayers: 64,
      id: 12, time: new Date().toTimeString().slice(0, 5),
      job: 'Policía · Sargento', framework: 'demo',
    });

    App.handlers.money({
      visible: true, currency: '$',
      cash: NX.money(S.cash), bank: NX.money(S.bank), black: NX.money(S.black),
      changes: {},
    });
  }

  function events() {
    const roll = Math.random();

    if (roll < 0.3) {
      const delta = Math.round((Math.random() - 0.4) * 900);
      S.cash = Math.max(0, S.cash + delta);
      App.handlers.money({
        visible: true, currency: '$',
        cash: NX.money(S.cash), bank: NX.money(S.bank), black: NX.money(S.black),
        changes: { cash: delta },
      });
    } else if (roll < 0.55) {
      S.inVehicle = !S.inVehicle;
      if (S.inVehicle) { S.speed = 0; S.belt = false; }
      App.handlers.notify({
        text: S.inVehicle ? 'Has entrado en un Sultan RS.' : 'Has salido del vehículo.',
        kind: 'info', duration: 4000,
      });
    } else if (roll < 0.75 && S.inVehicle) {
      S.belt = !S.belt;
      App.handlers.notify({
        text: S.belt ? 'Cinturón abrochado' : 'Ponte el cinturón',
        kind: S.belt ? 'success' : 'warning', duration: 3500,
      });
    } else {
      const pool = [
        { text: 'Recibiste una transferencia de $1.200 de Marta Ruiz.', kind: 'success' },
        { text: 'No tienes llaves de este vehículo.', kind: 'error' },
        { text: 'Reinicio del servidor en 15 minutos.', kind: 'warning' },
      ];
      App.handlers.notify({ ...pool[Math.floor(Math.random() * pool.length)], duration: 5000 });
    }
  }

  function start() {
    seedSettings();
    slow();
    setInterval(tick, 100);
    setInterval(slow, 1000);
    setInterval(events, 6500);
    setTimeout(() => { S.inVehicle = true; }, 3000);
  }

  return { start };
})();

document.addEventListener('DOMContentLoaded', App.init);
