# NEXYTT — Casino online y tienda de dropshipping

Dos aplicaciones web completas en un repositorio, construidas sin dependencias
y sin proceso de compilación: HTML, CSS y ES modules nativos.

> **Nota sobre este repositorio:** `NEXYTT/NEXYTT` es tu repositorio de perfil de
> GitHub, así que `README.md` es lo que se ve en tu página pública. Está intacto.
> Esta documentación vive aquí, en `PROYECTO.md`, para no tocarlo.

```bash
npm start                # servidor estático en http://localhost:8000
npm test                 # lógica pura: node --test
npm run test:smoke       # las 16 páginas en Chromium headless
npm run test:e2e         # flujo de compra completo, de catálogo a pedido
npm run rtp              # regenera la tabla de RTP medidos
```

**No hace falta `npm install`**: no hay ni una dependencia. El `package.json`
solo guarda los atajos. Cualquier página funciona también abriéndola
directamente desde disco.

---

## 🎰 NEXYTT Casino — `casino/`

Casino con **créditos virtuales**, sin dinero real, y con justicia verificable de
verdad.

### Justicia verificable (*provably fair*)

Es el núcleo del proyecto, no un adorno. Esquema *commit–reveal*:

1. La casa genera una semilla secreta y publica solo su `SHA-256`. A partir de
   ese momento no puede cambiarla sin romper el hash.
2. Tú aportas tu propia semilla de cliente, y puedes cambiarla cuando quieras.
   Así la casa no puede elegir una semilla favorable contra una tuya conocida.
3. Cada ronda consume un `nonce` incremental. Los números salen de
   `HMAC-SHA256(semilla_servidor, "cliente:nonce:cursor")`, leídos byte a byte.
4. Al rotar la semilla se revela la anterior y puedes recalcular **todas** tus
   rondas pasadas y comprobarlas contra el hash publicado.

`SHA-256` y `HMAC-SHA256` están implementados a mano en JavaScript síncrono
(`casino/js/core/sha256.js`) y contrastados contra `node:crypto` en cada longitud
alrededor del límite de bloque. Ningún juego usa `Math.random()`: todo resultado
es reproducible desde su terna `(semilla_servidor, semilla_cliente, nonce)`.

La página `casino/fairness.html` es un verificador independiente donde puedes
pegar una semilla revelada y recomputar cualquier ronda.

### Juegos

| Juego | Reglas | RTP declarado | RTP medido |
| --- | --- | --- | --- |
| **Neon Reels** | Tragaperras 5×3, 20 líneas, wild, scatter y tiradas gratis | 96,08% | 96,49% ± 1,03 |
| **Blackjack 21** | 6 barajas, S17, 3:2, doblar, dividir, seguro, rendición | 99,66% | 99,64% |
| **Ruleta Europea** | Un solo cero, tapete completo con todos los tipos de apuesta | 97,30% | 97,14% ± 0,36 |
| **Dados** | Objetivo ajustable de 2 a 98, multiplicador exacto | 99,00% | 98,84% ± 0,35 |
| **Crash** | Curva creciente, retirada manual o automática | 99,00% | 99,14% ± 0,36 |
| **Minas** | 5×5, número de minas configurable, multiplicador combinatorio | 99,00% | 98,95% ± 0,31 |

Cada RTP está **medido por simulación de Monte Carlo**, no prometido. Los
intervalos son al 95 %, sobre 200.000–400.000 rondas por juego. Regenera la
tabla con `node tests/rtp-report.mjs`.

Las tolerancias de los tests se **derivan del error estándar** de cada muestra,
nunca se eligen a mano: una apuesta a rojo y una tirada de dados que paga 49×
tienen varianzas con órdenes de magnitud de diferencia, y una tolerancia fija
sería demasiado laxa para una y demasiado estricta para la otra. Además la tabla
de estrategia básica del blackjack se comprueba por **enumeración exhaustiva** de
todas las manos de dos cartas contra todas las cartas vistas del crupier, que
detecta una sola casilla mal — algo que se esconde dentro del ruido de un millón
de manos simuladas.

### Cartera y libro mayor

El saldo se guarda en **unidades menores enteras** (1 crédito = 100 unidades).
Ningún importe pasa nunca por un `float`: `0.1 + 0.2 !== 0.3` es una clase de
error real en software de apuestas. El libro mayor es de solo anexado, y el RTP
que ves es *derivado* de él, no un número declarado.

### Juego responsable

Comprobado **antes** de aceptar cualquier apuesta, no como aviso decorativo:

- Apuesta máxima por jugada
- Pérdida máxima de la sesión
- Duración máxima de sesión, con recordatorio previo
- Autoexclusión temporal que no se puede acortar una vez activada

---

## 🛒 NEXYTT Store — `shop/`

Tienda de dropshipping completa: escaparate por delante y operación por detrás.

### Escaparate

- 26 productos en 6 categorías, con variantes, especificaciones y reseñas
- Búsqueda insensible a acentos, filtros por categoría, etiqueta, precio,
  valoración y stock, con facetas y recuentos
- Ficha de producto con galería, selector de variante que ajusta el precio, y
  cálculo de envío real según el país de destino y el peso
- Carrito con códigos promocionales, umbral de envío gratis e IVA desglosado
- Checkout en tres pasos con validación real: Luhn para la tarjeta, códigos
  postales por país, caducidad y CVC según la marca
- Seguimiento de pedido con línea de tiempo y un envío por proveedor

### Operación — `shop/admin.html`

La parte que convierte un escaparate en un negocio:

- **Economía unitaria** por producto: coste de proveedor, envío, comisión de
  pasarela, coste de adquisición y reserva de devoluciones. El margen se calcula
  sobre ingresos **netos de IVA**, porque el IVA nunca es margen.
- **Precio sugerido** resuelto para un margen objetivo, iterando porque la
  comisión y el IVA dependen del propio precio.
- **ROAS de equilibrio**: cuántos euros debe devolver cada euro de publicidad.
- **Ficha de proveedor** con plazo de entrega, tasa de defectos y de disputas.
- **Simulador mensual** de cuenta de resultados.

Un pedido genera una orden de compra **por proveedor**, porque un carrito real se
reparte entre varios y cada uno envía su propio paquete con su seguimiento.

---

## Decisiones de diseño

**Cero dependencias.** Nada que instalar, nada que compilar, nada que se rompa
en dos años. El precio es escribirlo todo: los ayudantes de DOM, el sistema de
iconos, el motor de barajas y la criptografía.

**El dinero es entero.** Toda cantidad viaja en unidades menores. Se redondea
una sola vez, al formatear. Se cumple siempre `neto + IVA === total`.

**La lógica es pura.** Los módulos de `core/` no tocan el DOM ni el
almacenamiento: reciben un `store` inyectado. Por eso el mismo código corre en el
navegador y bajo `node --test`, y por eso el RTP se puede simular.

**El resultado se decide antes de la animación.** En Crash el punto de explosión
se calcula al abrir la ronda; en Minas las minas se colocan antes del primer
clic. La animación representa un resultado ya fijado, nunca al revés.

---

## Estructura

```
assets/            código compartido (tokens, componentes, dom, formato, iconos)
casino/
  js/core/         sha256, rng, wallet, responsible, cards, context
  js/games/        lógica pura de cada juego, sin DOM
  js/ui/           controladores DOM y shell
shop/
  js/core/         pricing, cart, catalog, orders, validation, analytics
  js/ui/           páginas y componentes
  data/            catálogo, proveedores, reseñas
tests/             suite de lógica pura + prueba de humo en navegador
docs/              contrato de arquitectura
```

Detalle del contrato entre módulos en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## Aviso

Proyecto de demostración técnica.

El casino usa **créditos virtuales sin valor monetario**: no se puede depositar
ni retirar. Un casino con dinero real requiere licencia del regulador
correspondiente (DGOJ en España, MGA en Malta…), verificación de identidad,
prevención de blanqueo de capitales y una pasarela de pago autorizada. Eso no se
resuelve con código.

La tienda tiene el **pago simulado**: no se procesa ningún cobro y no debe
introducirse una tarjeta real. Los productos, proveedores y pedidos son
ficticios.

Si el juego deja de ser un entretenimiento, en España el 900 200 225 (FEJAR) es
gratuito y confidencial.
