# La Mer · Masía Barcelona

Página web completa (una sola página, estática) para **La Mer Hotel & Events**
(también conocido como *Masia La Mer*), una masía catalana restaurada convertida
en hotel boutique, restaurante y espacio de eventos en **Cabrera de Mar**
(Maresme, Barcelona).

## Cómo verla

No necesita compilación ni dependencias. Basta con abrir el archivo:

```bash
open masia-barcelona/index.html        # macOS
xdg-open masia-barcelona/index.html    # Linux
```

O servirla en local:

```bash
python3 -m http.server 8000 --directory masia-barcelona
# http://localhost:8000
```

## Archivos

| Archivo      | Contenido                                                        |
|--------------|------------------------------------------------------------------|
| `index.html` | Estructura, contenido y escenas SVG en línea. Incluye datos estructurados JSON-LD (`schema.org/Hotel`). |
| `styles.css` | Sistema de diseño (tokens de color y tipografía), maquetación responsive, componentes y capas de fondo. |
| `script.js`  | Cabecera fija, menú móvil accesible, animación de entrada, parallax de fondos, carga de fotografías y formulario vía `mailto:`. |
| `img/`       | Vacía de serie. Ver **Fondos** más abajo y `img/README.md`.       |

## Secciones de la página

1. **Hero** — presentación con ilustración del valle, el castillo y el mar.
2. **La masía** — historia y carácter de la casa.
3. **Habitaciones** — las tres tipologías (doble con vistas al jardín, doble con
   vistas a la piscina y familiar) sobre un total de seis habitaciones.
4. **Gastronomía** — restaurante de cocina catalana y española.
5. **Servicios** — piscina, jardín, terraza, restaurante, WiFi, parking, salón, A/A.
6. **Eventos** — bodas, eventos de empresa, catas, fiestas privadas, retiros.
7. **Banda panorámica** — escena a sangre de la era a la hora azul, con parallax.
8. **Entorno** — Castell de Burriac, ermita de Santa Elena d'Agell, playas, Barcelona.
9. **Cómo llegar** — mapa esquemático y distancias.
10. **Reservas** — datos de contacto y formulario.

## Detalles técnicos

- HTML semántico, español (`lang="es"`), sin frameworks ni recursos externos.
- Todas las imágenes son **SVG originales dibujados a mano en código**: la página
  funciona sin conexión y no depende de CDNs ni de fotografías de terceros.
- Los fondos son escenas construidas por capas, con perspectiva atmosférica
  (la bruma va lavando los planos según se alejan), grano de película mediante
  `feTurbulence`, desenfoque de primer plano y viñeta. La portada y la banda se
  desplazan en parallax; las superficies planas llevan una textura de yeso muy
  tenue para que no queden como bloques de color liso.
- Accesibilidad: enlace para saltar al contenido, foco visible, `aria-expanded`
  en el menú, `role="img"` con etiquetas en las ilustraciones y respeto por
  `prefers-reduced-motion`.
- Responsive desde 320 px; el menú pasa a desplegable por debajo de 900 px.

## Datos del establecimiento

| Campo                | Valor |
|----------------------|-------|
| Dirección            | Camí de Santa Elena, 30 — 08349 Cabrera de Mar (Barcelona) |
| Teléfono             | +34 937 499 002 |
| Correo               | contact@lamerbcn.com |
| Categoría            | Hotel boutique 3★ |
| Habitaciones         | 6 dobles |
| Espacio exterior     | Más de 2.500 m² |
| Entrada / salida     | 15:00 h / 12:00 h |
| Barcelona            | ≈ 27 km (unos 20 min) |
| Aeropuerto BCN       | ≈ 41 km |

## Fondos: cómo meter fotografías reales

Los fondos son ilustraciones porque el entorno donde se construyó esta página
tiene bloqueado el acceso a cualquier banco de imágenes, así que no había forma
de descargar fotos. Para no dejarlo cerrado, cada escena admite una fotografía
real **sin tocar el código**: basta con dejar el archivo en `img/` con el nombre
esperado y, al cargar, la foto se superpone a la ilustración.

| Archivo             | Dónde aparece               |
|---------------------|-----------------------------|
| `img/hero.jpg`      | Portada                     |
| `img/era-noche.jpg` | Banda panorámica            |
| `img/masia-fachada.jpg` | Sección «La masía»      |
| `img/mesa-jardin.jpg`   | Sección «Gastronomía»   |
| `img/ceremonia.jpg`     | Sección «Eventos»       |

Si el archivo no está, se ve la ilustración y no pasa nada más. Los detalles
(proporciones, encuadre, exposición y derechos) están en `img/README.md`.

## Fuentes

El enlace de Booking.com facilitado (`hotel/es/la-mer-boutique`) y el sitio
oficial del hotel están bloqueados por el proxy de red de este entorno, así que
los datos se han recopilado mediante búsqueda web a partir de fichas públicas del
establecimiento (Booking, TripAdvisor, Maresme Events, Maresme Connect,
Diputació de Barcelona, bodas.net, Planet of Hotels).

## Aviso

Página **de demostración, no oficial**. Los datos pueden haber cambiado y las
ilustraciones no son fotografías del establecimiento. Para reservar de verdad,
use los canales oficiales del hotel.
