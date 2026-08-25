# Minimapa circular / cuadrado

`Config.Minimap.shape` acepta `default`, `circle` y `square`.

- **`default`** — no se toca nada. El minimapa rectangular del juego se queda como está.
  Con esta forma usá el diseño de estado **Barras** (Ajustes → Estado → Diseño).
- **`circle`** — minimapa redondo. Es la forma para la que está pensado el diseño **Anillos**.
- **`square`** — minimapa cuadrado con esquinas rectas.

## Por qué hace falta un archivo extra

La forma del minimapa no se puede cambiar por código: el juego la saca de una textura
de máscara. `client/minimap.lua` hace el reemplazo con `AddReplaceTexture`, pero necesita
que la textura esté *streameada* desde este resource.

Si la textura no aparece, el HUD **no falla**: detecta que no cargó, lo avisa en consola
cuando `Config.Debug = true` y deja el minimapa por defecto.

## Cómo añadirla

1. Conseguí (o creá con OpenIV / CodeWalker) un `.ytd` que contenga una textura llamada
   `radarmasksm` con la máscara de la forma que quieras: un círculo blanco sobre fondo
   transparente para `circle`, un cuadrado blanco para `square`.
2. Nombrá el archivo según la forma:
   - `circlemap.ytd` para `Config.Minimap.shape = 'circle'`
   - `squaremap.ytd` para `Config.Minimap.shape = 'square'`
3. Dejalo en esta carpeta (`nexytt_hud/stream/`).
4. Añadí a `fxmanifest.lua`:

   ```lua
   this_is_a_map 'yes'   -- solo si tu .ytd va acompañado de un .ymt de minimapa
   files { 'stream/**' } -- NO hace falta: el streaming es automatico por carpeta
   ```

   En realidad no hace falta tocar el manifest: FiveM streamea de forma automática
   todo lo que haya en una carpeta llamada `stream/`.

5. `ensure nexytt_hud` y listo.

## Ajuste fino

Los anillos están calculados para el minimapa en su posición y tamaño por defecto en
1920x1080. Si el tuyo está movido (otra resolución, otro resource que lo reposiciona),
usá **Ajustes → Estado → Ajuste horizontal / vertical / Tamaño del conjunto**: mueven
el grupo de anillos en vivo hasta que encaje, y se guarda por jugador.

También podés reposicionar el minimapa nativo desde `Config.Minimap.reposition`.
