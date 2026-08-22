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
| `index.html` | Estructura, contenido e ilustraciones SVG en línea. Incluye datos estructurados JSON-LD (`schema.org/Hotel`). |
| `styles.css` | Sistema de diseño (tokens de color y tipografía), maquetación responsive y componentes. |
| `script.js`  | Cabecera fija, menú móvil accesible, animación de entrada por secciones y formulario de consulta vía `mailto:`. |

## Secciones de la página

1. **Hero** — presentación con ilustración del valle, el castillo y el mar.
2. **La masía** — historia y carácter de la casa.
3. **Habitaciones** — las tres tipologías (doble con vistas al jardín, doble con
   vistas a la piscina y familiar) sobre un total de seis habitaciones.
4. **Gastronomía** — restaurante de cocina catalana y española.
5. **Servicios** — piscina, jardín, terraza, restaurante, WiFi, parking, salón, A/A.
6. **Eventos** — bodas, eventos de empresa, catas, fiestas privadas, retiros.
7. **Entorno** — Castell de Burriac, ermita de Santa Elena d'Agell, playas, Barcelona.
8. **Cómo llegar** — mapa esquemático y distancias.
9. **Reservas** — datos de contacto y formulario.

## Detalles técnicos

- HTML semántico, español (`lang="es"`), sin frameworks ni recursos externos.
- Todas las imágenes son **SVG originales dibujados a mano en código**: la página
  funciona sin conexión y no depende de CDNs ni de fotografías de terceros.
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
