Config = {}

--=====================================================================
--  GENERAL
--=====================================================================

Config.Locale = 'es'                -- 'es' | 'en'
Config.Debug  = false               -- imprime en consola la deteccion de framework/fuel/voz

-- 'auto' detecta el framework leyendo el estado de los resources.
-- Forzalo si tenes un fork con otro nombre: 'esx' | 'qb' | 'qbx' | 'standalone'
Config.Framework = 'auto'

Config.Resources = {
    esx   = 'es_extended',
    qb    = 'qb-core',
    qbx   = 'qbx_core',
    voice = 'pma-voice',
}

-- Frecuencia de los loops en ms. Subilos si te preocupa el rendimiento.
Config.Tick = {
    fast   = 100,   -- vida, chaleco, vehiculo, stamina
    normal = 250,   -- calle, zona, brujula, voz
    slow   = 1000,  -- hambre, sed, estres, dinero, jugadores, hora
}

--=====================================================================
--  COMANDOS / TECLAS
--=====================================================================

Config.Commands = {
    settings = 'hud',          -- /hud abre el menu de ajustes
    toggle   = 'hudtoggle',    -- /hudtoggle oculta o muestra todo el HUD
    cinema   = 'cinematic',    -- /cinematic barras negras + HUD oculto
}

Config.Keys = {
    -- Nombres de tecla de FiveM: https://docs.fivem.net/docs/game-references/input-mapper-parameter-ids/
    settings  = 'F7',     -- abrir ajustes    (nil para desactivar)
    seatbelt  = 'B',      -- cinturon
    cruise    = 'PAGEUP', -- control de crucero
    cinematic = nil,      -- modo cine
}

--=====================================================================
--  COMPONENTES NATIVOS DEL HUD QUE OCULTAMOS
--=====================================================================
-- Por defecto solo ocultamos lo que este HUD reemplaza de verdad.
-- Referencia completa:
--   1 WANTED_STARS · 2 WEAPON_ICON · 3 CASH · 4 MP_CASH · 5 MP_MESSAGE
--   6 VEHICLE_NAME · 7 AREA_NAME · 8 VEHICLE_CLASS · 9 STREET_NAME
--  10 HELP_TEXT · 13 CASH_CHANGE · 14 RETICLE (la mira: no la toques)
--  17 SAVING_GAME · 19 WEAPON_WHEEL · 20 WEAPON_WHEEL_STATS
--
-- Si tambien queres esconder las estrellas de busqueda o el icono de
-- arma, agregales el 1 y el 2 aca.
Config.HideHudComponents = { 3, 4, 6, 7, 8, 9, 13 }

-- Barras de vida y chaleco del minimapa. Se apagan con el metodo
-- SETUP_HEALTH_ARMOUR del scaleform del minimapa, porque no hay
-- componente de HudComponent para ellas.
Config.HideNativeHealth = true

--=====================================================================
--  ESTADO / NECESIDADES
--=====================================================================

Config.Status = {
    -- Si el framework no provee hambre/sed/estres, el HUD los simula.
    fallbackDecay   = true,
    hungerPerMinute = 0.9,   -- % que baja el hambre cada minuto en standalone
    thirstPerMinute = 1.2,
    stressDecay     = 0.5,   -- % de estres que se recupera por minuto

    -- Umbrales de aviso (parpadeo + color de alerta)
    warnAt   = 25,
    dangerAt = 12,

    -- Estres: efectos visuales (blur + shake) cuando esta alto
    stressEffects   = true,
    stressBlurAt    = 60,
    stressShakeAt   = 80,
}

--=====================================================================
--  VEHICULO
--=====================================================================

Config.Vehicle = {
    units        = 'kmh',    -- 'kmh' | 'mph'
    maxSpeedKmh  = 300,      -- tope de la aguja del velocimetro
    maxSpeedMph  = 180,
    showRpm      = true,
    showFuel     = true,
    showEngine   = true,
    showGear     = true,
    showLights   = true,
    showIndicators = true,
    cruiseControl  = true,
    -- Solo mostrar el HUD del vehiculo si vas de conductor
    driverOnly     = false,
}

-- Deteccion de combustible. 'auto' prueba en orden los resources conocidos
-- y si no encuentra ninguno usa el nativo GetVehicleFuelLevel.
Config.Fuel = {
    resource = 'auto',
    -- resource / export a usar cuando resource ~= 'auto'
    known = {
        { name = 'LegacyFuel',    export = 'GetFuel' },
        { name = 'ox_fuel',       export = nil       },  -- ox_fuel usa statebag / nativo
        { name = 'ps-fuel',       export = 'GetFuel' },
        { name = 'cdn-fuel',      export = 'GetFuel' },
        { name = 'lc_fuel',       export = 'GetFuel' },
        { name = 'okokGasStation',export = 'GetFuel' },
    },
}

--=====================================================================
--  CINTURON DE SEGURIDAD
--=====================================================================

Config.Seatbelt = {
    enabled          = true,
    -- Salir despedido por el parabrisas al chocar sin cinturon
    ejection         = true,
    ejectMinSpeed    = 45.0,   -- km/h minimos para poder salir despedido
    ejectDeltaSpeed  = 25.0,   -- caida de velocidad en un frame que cuenta como choque
    -- Bloquear el bajarse del coche en marcha si tenes el cinturon puesto
    blockExit        = true,
    -- Clases de vehiculo donde NO aplica el cinturon (motos, bicis, aviones...)
    ignoredClasses   = { 8, 13, 14, 15, 16, 21 },
    -- Aviso sonoro/beep periodico si vas rapido sin cinturon
    reminder         = true,
    reminderSpeed    = 60.0,
}

--=====================================================================
--  MINIMAPA / BRUJULA
--=====================================================================

Config.Minimap = {
    -- 'default'  -> no tocamos nada
    -- 'square'   -> requiere stream/ con la textura squaremap (ver README)
    -- 'circle'   -> requiere stream/ con la textura circlemap (ver README)
    shape       = 'default',
    -- Reposicionar/redimensionar el minimapa nativo
    reposition  = false,
    x           = 0.0,
    y           = 0.0,
    width       = 0.165,
    height      = 0.22,
    -- Ocultar el minimapa cuando vas a pie
    hideOnFoot  = false,
    -- Zoom del radar (0-1400). nil = no tocar
    zoom        = nil,
}

Config.Compass = {
    enabled       = true,
    showStreet    = true,
    showZone      = true,
    showHeading   = true,
    showCrossing  = true,   -- calle secundaria de la interseccion
    -- Ocultar la brujula cuando vas a pie
    vehicleOnly   = false,
}

--=====================================================================
--  VOZ / RADIO
--=====================================================================

Config.Voice = {
    enabled  = true,
    -- Etiquetas por nivel de proximidad de pma-voice (1/2/3)
    ranges   = { 'Susurro', 'Normal', 'Grito' },
    showRadio = true,
}

--=====================================================================
--  DINERO
--=====================================================================

Config.Money = {
    enabled     = true,
    showCash    = true,
    showBank    = true,
    showBlack   = true,     -- black_money (ESX) / crypto (QB)
    currency    = '$',
    -- Cuanto tiempo (ms) se queda visible el +/- al cambiar el dinero
    changeTime  = 3500,
    -- Ocultar el panel si no cambia nada durante X ms (0 = siempre visible)
    idleHide    = 0,
}

--=====================================================================
--  PANEL DE SERVIDOR (arriba a la derecha)
--=====================================================================

Config.Server = {
    name        = 'NEXYTT RP',
    showLogo    = true,
    showPlayers = true,
    showId      = true,
    showTime    = true,
    showJob     = true,
    -- Hora: 'game' usa la hora in-game, 'real' la del sistema
    timeSource  = 'game',
}

--=====================================================================
--  NOTIFICACIONES
--=====================================================================

Config.Notify = {
    enabled   = true,
    duration  = 5000,
    maxStack  = 5,
    position  = 'top-right',   -- top-right | top-left | bottom-right | bottom-left | top-center
    sound     = true,
    -- Escuchar tambien los eventos de notificacion del framework.
    -- OJO: dejalo en false salvo que hayas desactivado las notificaciones
    -- nativas de ESX/QB, porque si no vas a ver cada aviso dos veces.
    -- El README explica como redirigirlas del todo.
    overrideFramework = false,
}

--=====================================================================
--  AJUSTES POR DEFECTO DEL JUGADOR
--  Se guardan por jugador con KVP; esto es solo el valor inicial.
--=====================================================================

Config.Defaults = {
    -- Interfaz
    hudEnabled      = true,
    accent          = '#5B8CFF',
    scale           = 100,      -- % de tamano global (60-140)
    opacity         = 100,      -- % de opacidad global (30-100)
    theme           = 'dark',   -- dark | midnight | carbon | light

    -- Estado
    statusLayout    = 'ring',   -- ring | bars
    statusOffsetX   = 0,        -- px de ajuste fino sobre el minimapa
    statusOffsetY   = 0,
    statusScale     = 100,
    showHealth      = true,
    showArmor       = true,
    showHunger      = true,
    showThirst      = true,
    showStress      = true,
    showOxygen      = true,
    showStamina     = true,
    hideWhenFull    = false,    -- ocultar iconos al 100%

    -- Vehiculo
    showVehicleHud  = true,
    units           = 'kmh',
    showRpm         = true,
    showFuel        = true,
    showEngine      = true,
    showBelt        = true,

    -- Brujula
    showCompass     = true,
    showStreet      = true,

    -- Info servidor
    showServerPanel = true,
    showMoney       = true,
    showVoice       = true,
    showPlayers     = true,

    -- Extra
    notifySound     = true,
    stressEffects   = true,
    cinematicBars   = false,
}
