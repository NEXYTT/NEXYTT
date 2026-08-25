# nexytt_hud

HUD completo para FiveM al estilo de los packs comerciales (Orbit y compañía):
anillos segmentados alrededor del minimapa, velocímetro circular, brújula con calle y
zona, panel de servidor, dinero, voz/radio, notificaciones y un menú de ajustes propio.

Detecta el framework solo. Funciona sobre **ESX Legacy**, **QBCore**, **QBox** o
**sin framework** — el mismo resource, sin tocar código.

---

## Qué incluye

| Módulo | Qué muestra |
|---|---|
| **Estado** | Vida y chaleco en arcos segmentados alrededor del minimapa · hambre, sed, estrés, oxígeno y energía en insignias circulares |
| **Vehículo** | Velocímetro con aguja de velocidad y anillo de RPM (con línea roja), marcha, gasolina, estado del motor, luces, largas, intermitentes |
| **Cinturón** | Tecla `B`, bloqueo de salida en marcha, eyección por el parabrisas al chocar sin cinturón, aviso a alta velocidad |
| **Crucero** | Control de crucero con `Re Pág`, se corta al frenar o poner el freno de mano |
| **Brújula** | Cinta de rumbo con cardinales, grados, calle actual, cruce y zona |
| **Servidor** | Nombre, jugadores conectados, tu ID, hora in-game y trabajo |
| **Dinero** | Efectivo, banco y dinero negro con animación de `+` / `−` al cambiar |
| **Voz** | Proximidad de pma-voice (susurro / normal / grito), indicador de canal de radio |
| **Notificaciones** | Sistema propio con exports, y reemplazo opcional de las del framework |
| **Ajustes** | Menú `/hud` (o `F7`): tema, color de acento, tamaño, opacidad, qué métricas ver, unidades, alineación del grupo de estado… Se guarda por jugador con KVP |

---

## Instalación

1. Copiá la carpeta `nexytt_hud` a tus `resources/`.
2. En `server.cfg`, **después** de tu framework:

   ```cfg
   ensure nexytt_hud
   ```

3. Abrí `config.lua` y cambiá al menos `Config.Server.name`.
4. Reiniciá el servidor.

No hace falta base de datos: los ajustes de cada jugador se guardan en su propio cliente.

### Compatibilidad

- **ESX Legacy** (`es_extended`) — dinero, cuentas, trabajo y, si tenés `esx_status`,
  hambre / sed / estrés.
- **QBCore** (`qb-core`) y **QBox** (`qbx_core`) — dinero, metadata y los eventos
  estándar `hud:client:UpdateNeeds` / `hud:client:UpdateStress`.
- **Standalone** — el HUD simula hambre y sed con un decaimiento configurable.

Si tu framework tiene otro nombre de resource, ajustá `Config.Resources`.
Si querés forzarlo, `Config.Framework = 'esx' | 'qb' | 'qbx' | 'standalone'`.

### Combustible

`Config.Fuel.resource = 'auto'` prueba en orden `LegacyFuel`, `ox_fuel`, `ps-fuel`,
`cdn-fuel`, `lc_fuel` y `okokGasStation`. Si no encuentra ninguno usa el nativo
`GetVehicleFuelLevel`. Para forzar uno concreto poné su nombre ahí.

---

## Anillos o barras

El diseño **Anillos** está pensado para un **minimapa circular**: los arcos abrazan el
círculo. Con el minimapa rectangular por defecto de GTA los arcos quedan por encima del
mapa, así que en ese caso usá el diseño **Barras**
(*Ajustes → Estado → Diseño*, o `Config.Defaults.statusLayout = 'bars'`).

Para poner el minimapa redondo mirá [`stream/README.md`](stream/README.md).

Si los anillos no te encajan con tu minimapa, los sliders de
*Ajustes → Estado* (ajuste horizontal, vertical y tamaño del conjunto) los mueven en
vivo y se guardan por jugador.

---

## Comandos y teclas

| Atajo | Qué hace |
|---|---|
| `/hud` · `F7` | Abre o cierra el menú de ajustes |
| `/hudtoggle` | Enciende o apaga todo el HUD |
| `/cinematic` | Barras de cine + minimapa oculto |
| `B` | Cinturón |
| `Re Pág` | Control de crucero |

Todas las teclas se pueden reasignar en `Config.Keys`, y el jugador puede cambiarlas
desde *Ajustes de FiveM → Asignación de teclas → FiveM*.

---

## Integración con otros resources

### Notificaciones

```lua
-- Cliente
exports['nexytt_hud']:Notify('Has recogido el paquete.', 'success', 5000)

-- Servidor
exports['nexytt_hud']:Notify(source, 'Te han multado con $500.', 'error')
exports['nexytt_hud']:NotifyAll('Reinicio en 5 minutos.', 'warning')
```

Tipos: `success`, `error`, `warning`, `info`.

#### Redirigir las notificaciones del framework

`Config.Notify.overrideFramework` viene en **`false`** a propósito. Si lo ponés en
`true`, este HUD escucha los mismos eventos que ESX y QBCore (`esx:showNotification`,
`QBCore:Notify`) — pero el framework los sigue escuchando también, así que verías cada
aviso **dos veces**.

Para redirigirlas de verdad tenés dos opciones:

**A) Activarlo y desactivar las nativas.** Poné `overrideFramework = true` y anulá el
handler del framework (en ESX, comentá el `RegisterNetEvent('esx:showNotification')`
de `es_extended/client/functions.lua`; en QBCore, el de `qb-core/client/functions.lua`).

**B) Apuntar la función del framework a este HUD.** Es lo más limpio, y no toca los
eventos. En `es_extended/client/functions.lua`:

```lua
function ESX.ShowNotification(message, notifyType, length)
    exports['nexytt_hud']:Notify(message, notifyType or 'info', length)
end
```

En `qb-core/client/functions.lua`:

```lua
function QBCore.Functions.Notify(text, texttype, length)
    local body = type(text) == 'table' and (text.text or text.caption) or text
    exports['nexytt_hud']:Notify(body, texttype or 'info', length)
end
```

### Necesidades

```lua
-- Cliente
exports['nexytt_hud']:SetNeed('hunger', 42.0)   -- hunger | thirst | stress

-- Servidor
exports['nexytt_hud']:SetNeed(source, 'thirst', 80.0)
```

### Estado y vehículo

```lua
local status = exports['nexytt_hud']:GetStatus()      -- health, armor, hunger...
local veh    = exports['nexytt_hud']:GetVehicleData() -- speed, rpm, fuel... o nil
local belt   = exports['nexytt_hud']:IsSeatbeltOn()
local brujula= exports['nexytt_hud']:GetCompass()     -- heading, cardinal, street, zone
```

### Ocultar el HUD desde otro script

```lua
exports['nexytt_hud']:SetVisible(false)   -- cinemáticas, creador de personaje...
exports['nexytt_hud']:SetCinematic(true)  -- barras de cine
exports['nexytt_hud']:OpenSettings()
```

### Cinturón

```lua
exports['nexytt_hud']:SetSeatbelt(true)
```

---

## Previsualizar sin levantar el servidor

`html/index.html` detecta que no está dentro de FiveM y arranca un **modo demo**:
simula estado, conducción, dinero y notificaciones. Abrí el archivo en el navegador y
tenés el HUD entero funcionando para ajustar CSS sin reiniciar nada.

---

## Rendimiento

- Tres cadencias distintas en `Config.Tick`: `fast` (100 ms) para vida, chaleco y
  vehículo; `normal` (250 ms) para brújula y voz; `slow` (1000 ms) para dinero,
  jugadores y necesidades.
- Los bucles se paran solos cuando el HUD está oculto, en pausa o el jugador está
  muerto — no hay `Wait(0)` permanentes salvo el que oculta los componentes nativos y
  el del crucero mientras está activo.
- La NUI solo repinta lo que cambia: los arcos se mueven con `stroke-dasharray`, sin
  reconstruir el DOM.

---

## Notas

- **Barras nativas de vida y chaleco.** No son un `HudComponent`, las dibuja el
  scaleform del minimapa. `Config.HideNativeHealth` las apaga con
  `SETUP_HEALTH_ARMOUR` y las vuelve a apagar al reaparecer, que es cuando el juego
  las repinta. Si preferís conservarlas, ponelo en `false` y desactivá los anillos
  desde el menú.
- **Componentes del HUD nativo.** `Config.HideHudComponents` solo esconde por defecto
  lo que este HUD reemplaza (dinero, nombre de vehículo, calle, zona…). Las estrellas
  de búsqueda y el icono de arma se dejan visibles porque el HUD no los sustituye:
  agregá `1` y `2` a la lista si querés ocultarlos igualmente.
- **Tipografías.** La NUI intenta cargar Inter y Rajdhani desde Google Fonts. Si el
  cliente no tiene salida a internet cae en la pila de fuentes del sistema y todo
  sigue legible; nada depende de que carguen.

## Estructura

```
nexytt_hud/
├── fxmanifest.lua
├── config.lua              todo lo configurable
├── locales/                es · en (+ helper L())
├── bridge/
│   ├── client.lua          detección y adaptadores de framework
│   └── server.lua          idem en el servidor
├── client/
│   ├── utils.lua           helpers + cola de mensajes a la NUI
│   ├── notify.lua          notificaciones y compatibilidad con el framework
│   ├── settings.lua        ajustes del jugador (KVP) y callbacks NUI
│   ├── minimap.lua         forma del minimapa, componentes nativos y brújula
│   ├── status.lua          vida, chaleco, necesidades y efectos de estrés
│   ├── seatbelt.lua        cinturón y eyección
│   ├── vehicle.lua         velocímetro, combustible y crucero
│   ├── voice.lua           pma-voice / mumble
│   ├── money.lua           efectivo, banco y dinero negro
│   └── main.lua            panel de servidor, visibilidad y limpieza
├── server/main.lua         jugadores conectados y exports
├── stream/                 texturas opcionales del minimapa
└── html/                   NUI (index.html + css/ + js/)
```
