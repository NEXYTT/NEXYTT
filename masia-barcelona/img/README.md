# Fotografías

Esta carpeta está vacía a propósito. La página funciona sin ella: cada fondo es
una ilustración SVG dibujada en el propio código.

## Cómo poner fotos de verdad

Deja aquí un archivo con el nombre exacto de la tabla y **listo**: al cargar la
página, la foto se superpone a la ilustración con un fundido corto. No hay que
tocar HTML, CSS ni JS. Si el archivo no existe, sigue viéndose la ilustración.

| Archivo               | Dónde aparece                        | Proporción recomendada |
|-----------------------|--------------------------------------|------------------------|
| `hero.jpg`            | Fondo de la portada                  | 16:10 apaisada, ancha  |
| `era-noche.jpg`       | Banda panorámica de la cita          | 2,5:1 muy apaisada     |
| `masia-fachada.jpg`   | Sección «La masía»                   | 5:4                    |
| `mesa-jardin.jpg`     | Sección «Gastronomía»                | 4:3                    |
| `ceremonia.jpg`       | Sección «Eventos»                    | 9:8 (casi cuadrada)    |

Se admite cualquier formato que entienda el navegador; si prefieres `.webp` o
`.png`, cambia la extensión en el atributo `data-photo` del elemento
correspondiente en `index.html`.

## Recomendaciones

- **Ancho:** 2000–2600 px para `hero.jpg` y `era-noche.jpg`; 1400–1800 px para
  el resto. Comprime a calidad ~80: son fondos, no fotos de catálogo.
- **Encuadre:** las dos primeras se recortan con `object-fit: cover` y llevan
  parallax, así que reserva margen arriba y abajo; lo importante debe quedar
  hacia el centro.
- **Exposición:** sobre la portada y la banda hay un velo oscuro para que el
  texto se lea. Funcionan mejor las tomas de luz baja (amanecer, atardecer,
  hora azul) que las de mediodía a pleno sol.

## Derechos

Usa solo fotografías propias o con licencia para este uso. Las imágenes del
hotel publicadas en portales de reserva son de sus titulares: no las copies aquí
sin permiso.

## Nota técnica

Como la comprobación es automática, mientras no haya fotos el navegador anota en
consola un 404 por cada archivo ausente. Es inofensivo y desaparece en cuanto
añades las imágenes; es el precio de que baste con soltar el archivo.
