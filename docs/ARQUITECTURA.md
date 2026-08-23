# Arquitectura y contrato de módulos

Documento de referencia del proyecto. Describe qué hace cada módulo y **cómo se
usa**, para que cualquier página nueva se apoye en lo que ya existe en lugar de
reimplementarlo.

## Principios

1. **Cero dependencias, cero build.** Todo es HTML + CSS + ES modules nativos.
   Cualquier página se abre directamente desde disco (`file://`) o desde un
   servidor estático, sin `npm install` ni transpilación.
2. **El dinero es entero.** Todos los importes viajan en *unidades menores*
   (céntimos / créditos ×100). Ningún saldo se guarda nunca en un `float`.
   El redondeo ocurre una sola vez, al formatear para mostrar.
3. **La lógica es pura.** Los módulos de `core/` no tocan el DOM ni
   `localStorage` directamente: reciben un `store` inyectado. Por eso el mismo
   código se ejecuta en el navegador y bajo `node --test`.
4. **Nada de `Math.random()` en el juego.** Todo resultado sale de una ronda
   `Round` sembrada, así que es reproducible y verificable.

## Estructura

```
assets/          código compartido por casino y tienda
  css/tokens.css     variables de diseño (única fuente de color/espaciado)
  css/base.css       reset + componentes (.btn .card .input .badge .table …)
  js/dom.js          el(), $, $$, delegate(), toast(), tween(), ready()
  js/format.js       money(), credits(), percent(), multiplier(), dateTime()
  js/storage.js      createStore(namespace) → adaptador local/memoria
  js/emitter.js      Emitter (on/off/emit)
  js/icons.js        icon(name), iconMarkup(name) — SVG inline

casino/
  css/casino.css     shell, mesa, cartas, fichas, historial
  js/core/sha256.js  SHA-256 y HMAC-SHA256 en JS puro, síncronos
  js/core/rng.js     FairnessEngine, Round, verifyRound
  js/core/wallet.js  Wallet (saldo + libro mayor)
  js/core/responsible.js  límites de juego responsable
  js/core/cards.js   baraja, handValue(), evaluatePoker()
  js/core/context.js wallet/fairness/responsible ya conectados + playRound()
  js/ui/shell.js     mountShell(), betControls(), historyStrip(), statsPanel()
  js/games/*.js      lógica pura de cada juego
  js/ui/*.js         controlador DOM de cada juego

shop/
  css/shop.css       shell, tarjeta de producto, ficha, carrito, checkout
  data/products.js   catálogo (26 productos) + CATEGORIES
  data/suppliers.js  proveedores con lead time y tasa de defectos
  js/core/pricing.js IVA, zonas de envío, unitEconomics(), suggestPrice()
  js/core/cart.js    Cart (líneas, promos, totales)
  js/core/catalog.js queryCatalog(), facetas, relatedProducts()
  js/core/orders.js  createOrder(), advanceOrder(), routeToSuppliers()
  js/core/context.js cart + pedidos + wishlist ya conectados
  js/ui/shell.js     mountHeader(), mountFooter(), productCard(), addToCart()
  js/ui/productArt.js  ilustración SVG generada por producto
```

## Contrato del casino

Un juego de una sola fase (tragaperras, ruleta, dados) se resuelve así:

```js
import { playRound } from "../core/context.js";

const result = playRound({
  stake: 1000,              // unidades menores
  game: "dice",
  // resolve DEBE ser pura: solo puede leer números de `round`
  resolve: (round) => {
    const roll = round.at(0) * 100;
    const win = roll < target;
    return { payout: win ? Math.round(stake * multiplier) : 0, roll };
  },
});
// result = { payout, stake, net, nonce, balance, ...lo que devuelva resolve }
```

`playRound` comprueba los límites de juego responsable, debita la apuesta,
genera la ronda, ejecuta `resolve`, abona el pago y persiste el nonce — en ese
orden. Si `resolve` lanza, la apuesta se devuelve.

`payout` es **el retorno total al jugador**, no el beneficio: una pérdida paga
0 y un acierto a dinero par sobre 100 paga 200.

Un juego multifase (blackjack, crash, minas) usa `openRound()`:

```js
const hand = openRound({ stake, game: "blackjack" });
hand.round            // el stream de la ronda
hand.addStake(extra)  // doblar / dividir / seguro
hand.settle(payout, detail)
hand.cancel()
```

### API de `Round`

| Método | Devuelve |
| --- | --- |
| `round.floats(n)` | `n` números uniformes en `[0,1)` |
| `round.at(i)` | el número en la posición `i` |
| `round.int(max, i)` | entero uniforme en `[0, max)` |
| `round.shuffle(array, offset)` | copia barajada (Fisher–Yates) |
| `round.pick(k, pool)` | `k` enteros distintos de `[0, pool)` |

### UI compartida del casino

```js
mountShell({ active: "dice" });     // barra superior + saldo en vivo
const bet = betControls({ onAction: (stake) => spin(stake) });
const history = historyStrip();     // tiras de resultados recientes
const stats = statsPanel();         // rondas, apostado, resultado, RTP real
bet.setBusy(true, "Girando…");
```

## Contrato de la tienda

```js
import { cart, products } from "./js/core/context.js";
import { queryCatalog } from "./js/core/catalog.js";
import { mountHeader, mountFooter, productCard, addToCart } from "./js/ui/shell.js";

mountHeader({ active: "catalog" });
const page = queryCatalog(products, { q, categories, sort, page: 1, perPage: 12 });
grid.append(...page.items.map((p) => productCard(p, { onAdd: addToCart })));
```

`cart.totals()` devuelve el desglose completo: `subtotal`, `discount`,
`shipping`, `tax`, `net`, `total`, `savings`, `missingForFree` y la zona de
envío aplicada. Siempre se cumple `net + tax === total`.

## Convenciones de estilo

- Usa las clases de `base.css` antes de escribir CSS nuevo.
- Ningún color literal fuera de `tokens.css`.
- Cada página añade `data-theme="casino"` o `data-theme="shop"` al `<html>`.
- Todo control interactivo necesita nombre accesible (`aria-label` o texto).
- Objetivo táctil mínimo de 42 px; contraste mínimo AA.

## Cómo ejecutar

```bash
python3 -m http.server 8000    # y abre http://localhost:8000
node --test tests/             # suite de lógica pura
```
