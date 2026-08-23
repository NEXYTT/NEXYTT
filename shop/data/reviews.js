/**
 * Customer review bank.
 *
 * These reviews are **written for the demo**, like the rest of the catalogue:
 * no real customer wrote them and no real purchase backs the "verified" flag.
 * They exist so the product page can exercise the shapes a real review widget
 * has to handle — a star distribution that is not uniform, mixed verified and
 * unverified authors, and critical three-star reviews that say something
 * concrete. A bank of nothing but five stars is the tell of a fake store.
 *
 * Shipped as an ES module for the same reason as `products.js`: `fetch()` of a
 * local JSON file is blocked under `file://`, an import is not.
 *
 * `date` is a plain ISO day (no clock, no timezone). The UI parses it at midday
 * so a negative UTC offset can never render it as the previous day.
 * `helpful` is the count of readers who marked the review useful.
 *
 * @typedef {{author:string, rating:1|2|3|4|5, date:string, title:string,
 *            body:string, verified:boolean, helpful:number}} Review
 */

/** @type {Record<string, Review[]>} keyed by `product.id`, newest first. */
export const REVIEWS = {
  "p-lumen-aurora": [
    {
      author: "Marta Belmonte",
      rating: 5,
      date: "2026-07-28",
      title: "Mi hija ya no quiere dormir sin ella",
      body: "La compré para la habitación de mi hija de seis años y ha sido un acierto. La proyección se ve bien incluso con la persiana a medio bajar y el modo nocturno en ámbar es lo bastante tenue para dejarlo toda la noche. Lo único que me chirría es que la app pide registro con correo para funcionar.",
      verified: true,
      helpful: 42,
    },
    {
      author: "Javier Ortuño",
      rating: 5,
      date: "2026-06-15",
      title: "Mucho mejor de lo que esperaba por el precio",
      body: "Esperaba un juguete y me he encontrado algo bastante decente. El sincronizado con música funciona sorprendentemente bien con el micro interno: con música tranquila queda precioso, con reguetón se vuelve loca. El cable USB-C que trae es cortísimo, usa uno tuyo.",
      verified: true,
      helpful: 28,
    },
    {
      author: "Nuria Cifuentes",
      rating: 3,
      date: "2026-05-02",
      title: "Bonita, pero la app es mejorable",
      body: "El aparato cumple: los colores son vivos y no hace nada de ruido. El problema es la aplicación, que se desconecta cada dos por tres y hay que volver a emparejar. Con el mando físico va perfecto, así que le doy tres estrellas: si piensas controlarla desde el móvil, prepárate para la paciencia.",
      verified: true,
      helpful: 67,
    },
    {
      author: "Diego Sanchís",
      rating: 5,
      date: "2026-04-19",
      title: "Llegó en cuatro días a Valencia",
      body: "Pedido un lunes, en casa el viernes, con doble caja y sin un golpe. La uso de luz ambiente mientras juego, con un degradado azul y morado que sobre pared blanca queda genial.",
      verified: true,
      helpful: 15,
    },
    {
      author: "Rocío Valcárcel",
      rating: 4,
      date: "2026-03-11",
      title: "Proyecta menos de lo que parece en las fotos",
      body: "La calidad del plástico es mejor de lo que me temía y el difusor gira sin ruido. Ojo con las expectativas: en una habitación grande la nebulosa se difumina bastante. Funciona mucho mejor en cuartos pequeños y con la luz apagada del todo.",
      verified: false,
      helpful: 33,
    },
  ],

  "p-audio-pulse": [
    {
      author: "Álvaro Reguera",
      rating: 5,
      date: "2026-08-05",
      title: "El multipunto es lo que me ha conquistado",
      body: "Trabajo con el portátil y el móvil a la vez y el cambio automático entre los dos funciona sin que tengas que pensarlo. La cancelación en el metro tapa el ruido del túnel casi por completo; las voces cercanas se siguen colando, pero eso pasa con todos.",
      verified: true,
      helpful: 91,
    },
    {
      author: "Elena Prats",
      rating: 5,
      date: "2026-07-02",
      title: "Las 38 horas no son marketing",
      body: "Los uso hora y media al día y los cargo cada dos semanas largas. El estuche entra sin problema en el bolsillo del pantalón, que era mi pega con los anteriores.",
      verified: true,
      helpful: 40,
    },
    {
      author: "Sergio Iriarte",
      rating: 3,
      date: "2026-06-21",
      title: "Suenan bien, pero se me caen corriendo",
      body: "Del sonido y de la cancelación no tengo ninguna queja. El problema es el ajuste: con las almohadillas medianas se me salen en cuanto sudo y con las grandes me molestan a la media hora. Si tienes el canal auditivo pequeño, no cuentes con ellos para deporte.",
      verified: true,
      helpful: 58,
    },
    {
      author: "Cristina Bouza",
      rating: 5,
      date: "2026-05-30",
      title: "En llamadas se me entiende perfectamente",
      body: "Hago tres o cuatro videollamadas al día y nadie me ha vuelto a decir que se me oye lejos. En la calle con viento sí que se cuela algo de ruido de fondo.",
      verified: true,
      helpful: 22,
    },
    {
      author: "Pablo Manzanares",
      rating: 4,
      date: "2026-04-08",
      title: "Aíslan de maravilla, el modo ambiente se queda corto",
      body: "La cancelación está a la altura de auriculares bastante más caros. El modo transparencia, en cambio, suena artificial, como si te hablasen por una radio. Para cruzar la calle sirve; para mantener una conversación, no.",
      verified: false,
      helpful: 19,
    },
  ],

  "p-charge-nova": [
    {
      author: "Ignacio Villarejo",
      rating: 5,
      date: "2026-08-01",
      title: "Se acabó llevar tres cargadores en la mochila",
      body: "Cargo el portátil, el móvil y los auriculares con un solo enchufe. Se calienta, sí, pero notablemente menos que el cargador original del portátil.",
      verified: true,
      helpful: 55,
    },
    {
      author: "Laura Tejeda",
      rating: 5,
      date: "2026-06-27",
      title: "La clavija plegable marca la diferencia",
      body: "Parece una tontería hasta que lo metes en la mochila y no se engancha con nada. Muy compacto para los vatios que da.",
      verified: true,
      helpful: 31,
    },
    {
      author: "Rubén Ascoy",
      rating: 4,
      date: "2026-05-18",
      title: "Muy bien, pero ojo a cómo reparte la potencia",
      body: "Con los tres puertos ocupados el portátil baja a 45 W y carga bastante más lento. Está en las especificaciones, así que no hay engaño, pero conviene saberlo antes de comprarlo pensando en cargar tres cosas a tope.",
      verified: true,
      helpful: 44,
    },
    {
      author: "Miriam Salcedo",
      rating: 5,
      date: "2026-03-26",
      title: "Lo he llevado a México sin transformador",
      body: "Entrada de 100 a 240 V, así que solo necesité el adaptador de clavija. Tres semanas de viaje sin un problema.",
      verified: true,
      helpful: 12,
    },
  ],

  "p-pet-fountain": [
    {
      author: "Beatriz Colomer",
      rating: 5,
      date: "2026-07-19",
      title: "Mi gato bebe el triple",
      body: "Tenía uno de esos gatos que solo bebían del grifo. Con la fuente ha dejado de darme la lata a las siete de la mañana. La bomba no se oye ni de noche, y duerme en mi habitación.",
      verified: true,
      helpful: 78,
    },
    {
      author: "Andrés Lafuente",
      rating: 4,
      date: "2026-06-09",
      title: "Muy buena, pero hay que limpiarla en serio",
      body: "Funciona genial. Eso sí, si no la desmontas cada dos semanas se acumula baba en el fondo del depósito. No es un defecto del producto, es lo que tiene cualquier fuente, pero conviene contarlo antes de comprar.",
      verified: true,
      helpful: 63,
    },
    {
      author: "Silvia Marroquín",
      rating: 5,
      date: "2026-05-25",
      title: "Los filtros duran lo que dicen",
      body: "Un mes largo cada uno con dos gatos en casa. Los repuestos se encuentran sin problema y son baratos.",
      verified: true,
      helpful: 27,
    },
    {
      author: "Óscar Benavent",
      rating: 3,
      date: "2026-04-14",
      title: "El indicador de nivel se ve fatal",
      body: "La fuente cumple, pero la ventana del nivel de agua es diminuta y de plástico ahumado, así que acabas levantando la tapa para saber si queda. Con 2,4 litros aguanta unos tres días con un solo gato.",
      verified: true,
      helpful: 35,
    },
    {
      author: "Ainhoa Berruezo",
      rating: 5,
      date: "2026-03-12",
      title: "Ni un charco alrededor",
      body: "Tenía miedo de que salpicara, porque la anterior nos dejaba el suelo empapado. Esta reparte el agua por la rampa sin ruido y en dos meses no he secado el suelo ni una vez.",
      verified: true,
      helpful: 23,
    },
  ],

  "p-pet-bed": [
    {
      author: "Carmen Ibáñez",
      rating: 5,
      date: "2026-08-10",
      title: "Se metió dentro antes de que le quitara la etiqueta",
      body: "Un galgo de 22 kilos en la talla L, justo de tamaño. El borde elevado le viene perfecto para apoyar la cabeza y duerme del tirón.",
      verified: true,
      helpful: 84,
    },
    {
      author: "Toni Ferriol",
      rating: 5,
      date: "2026-07-06",
      title: "Aguanta el lavado sin apelmazarse",
      body: "Cuatro lavados a 30 grados y sigue igual de mullida. La saco de la lavadora, la sacudo bien y en un día está seca.",
      verified: true,
      helpful: 46,
    },
    {
      author: "Alicia Nadal",
      rating: 4,
      date: "2026-05-21",
      title: "Suelta pelusa la primera semana",
      body: "Comodísima y el perro la adora, pero los primeros días vas a encontrar pelillos blancos por toda la casa. Pasada esa semana deja de soltar.",
      verified: true,
      helpful: 52,
    },
    {
      author: "Gonzalo Prieto",
      rating: 5,
      date: "2026-04-02",
      title: "Mide bien a tu perro antes de elegir talla",
      body: "La S es realmente pequeña, para gatos o perros de menos de cinco kilos. Me equivoqué y cambié a la M: el cambio fue rápido y sin coste, pero te ahorras el trámite midiendo antes.",
      verified: false,
      helpful: 29,
    },
  ],

  "p-acc-wallet": [
    {
      author: "Héctor Ledesma",
      rating: 5,
      date: "2026-07-24",
      title: "Seis meses de uso y ni un arañazo",
      body: "Se me ha caído al suelo dos veces y sigue como el primer día. El abanico con el pulgar es cómodo de verdad, no es un truco de vídeo.",
      verified: true,
      helpful: 61,
    },
    {
      author: "Paula Aguirre",
      rating: 4,
      date: "2026-06-03",
      title: "Seis tarjetas, ni una más",
      body: "Dicen que caben seis y caben seis, pero si alguna es en relieve se queda en cinco. Los billetes hay que doblarlos en la goma exterior y ahí pierde bastante elegancia.",
      verified: true,
      helpful: 48,
    },
    {
      author: "Jorge Etxebarria",
      rating: 5,
      date: "2026-05-09",
      title: "El bloqueo RFID funciona de verdad",
      body: "Lo probé pasando la tarjeta del transporte por el lector con la cartera cerrada y no la lee. Abierta, sí. Prueba superada.",
      verified: true,
      helpful: 37,
    },
    {
      author: "Nerea Solchaga",
      rating: 3,
      date: "2026-03-30",
      title: "Bonita, pero se me abre sola en el bolsillo",
      body: "El mecanismo es suave y agradable de usar, quizá demasiado suave: en el bolsillo del abrigo se me ha abierto varias veces al sentarme. En un bolso no da ningún problema.",
      verified: true,
      helpful: 41,
    },
    {
      author: "Rodrigo Casaus",
      rating: 5,
      date: "2026-03-05",
      title: "Regalo resuelto para mi hermano",
      body: "Viene en una caja rígida que ya sirve de estuche de regalo, así que no tuve ni que envolverla. Él llevaba una de tela reventada desde hacía años y está encantado.",
      verified: true,
      helpful: 14,
    },
  ],

  "p-fit-bands": [
    {
      author: "Raquel Ostiz",
      rating: 5,
      date: "2026-07-15",
      title: "He montado el gimnasio en el pasillo",
      body: "El anclaje de puerta aguanta la banda negra sin moverse ni un milímetro. Las asas llevan un mosquetón decente, no el plástico de feria que traen otros sets.",
      verified: true,
      helpful: 58,
    },
    {
      author: "Dani Corchado",
      rating: 4,
      date: "2026-06-18",
      title: "Las tobilleras son lo más flojo del set",
      body: "Las bandas están genial y el látex ni siquiera huele. Las tobilleras, en cambio, llevan un velcro que se afloja en cuanto haces series largas.",
      verified: true,
      helpful: 44,
    },
    {
      author: "Chema Alcaine",
      rating: 5,
      date: "2026-05-04",
      title: "Perfectas para viajar",
      body: "Caben en la bolsa de aseo y me han salvado en tres hoteles sin gimnasio. La bolsa que traen es fina, pero cumple.",
      verified: true,
      helpful: 20,
    },
    {
      author: "Inés Quiroga",
      rating: 3,
      date: "2026-04-22",
      title: "Los kilos que indican son muy orientativos",
      body: "La resistencia real depende de cuánto estires la banda, así que lo de «50 kg» hay que cogerlo con pinzas. Como material está bien y a este precio no me quejo, pero la etiqueta es puro marketing.",
      verified: true,
      helpful: 71,
    },
  ],

  "p-home-humid": [
    {
      author: "Vanesa Cardeñosa",
      rating: 5,
      date: "2026-08-08",
      title: "El efecto llama engaña de verdad",
      body: "De noche y con la luz apagada parece fuego real. Lo tengo en el salón y todo el que entra pregunta por él.",
      verified: true,
      helpful: 39,
    },
    {
      author: "Kike Berrocal",
      rating: 4,
      date: "2026-06-30",
      title: "Bonito y silencioso, pero 300 ml se van rápido",
      body: "En modo continuo dura unas cinco horas. Para un dormitorio va perfecto; para un salón grande se queda claramente corto.",
      verified: true,
      helpful: 55,
    },
    {
      author: "Lourdes Amestoy",
      rating: 3,
      date: "2026-05-16",
      title: "Cuidado con la superficie donde lo pongas",
      body: "Humidifica bien y el aroma se reparte, pero deja un cerco de humedad alrededor si lo dejas sobre madera. Le he puesto un plato debajo y solucionado, aunque en el manual no lo avisan por ninguna parte.",
      verified: true,
      helpful: 62,
    },
    {
      author: "Marc Vilaplana",
      rating: 5,
      date: "2026-04-05",
      title: "El apagado automático da tranquilidad",
      body: "Se apaga solo al quedarse sin agua, que era justo lo que me frenaba para dejarlo encendido toda la noche.",
      verified: true,
      helpful: 18,
    },
  ],

  "p-brew-arom": [
    {
      author: "Fernando Aizpurua",
      rating: 5,
      date: "2026-07-11",
      title: "Café caliente una hora después",
      body: "La doble pared cumple lo que promete. Sirvo la primera taza a las ocho y la segunda a las nueve, y sigue caliente sin recalentar nada.",
      verified: true,
      helpful: 47,
    },
    {
      author: "Marta Quintás",
      rating: 4,
      date: "2026-06-12",
      title: "Filtra estupendamente, pero cuesta limpiarla",
      body: "Casi no pasan posos, mucho mejor que mi prensa anterior. Lo malo es desmontar el doble filtro después de cada uso: son tres piezas y hay que hacerlo o se queda café atascado dentro.",
      verified: true,
      helpful: 51,
    },
    {
      author: "Salva Redondo",
      rating: 5,
      date: "2026-05-27",
      title: "Acero de verdad, no chapa",
      body: "Pesa lo que tiene que pesar. Se me cayó desde la encimera y no le pasó absolutamente nada.",
      verified: true,
      helpful: 24,
    },
    {
      author: "Teresa Lagunas",
      rating: 3,
      date: "2026-03-19",
      title: "La capacidad de un litro es engañosa",
      body: "El litro es hasta el borde; con el émbolo metido se queda en unos 800 ml reales, tres tazas justas. Buen producto, pero que no te sorprenda como me sorprendió a mí.",
      verified: false,
      helpful: 58,
    },
  ],

  "p-tech-projector": [
    {
      author: "Adrián Bustelo",
      rating: 5,
      date: "2026-07-31",
      title: "Para el patio en verano es perfecto",
      body: "Con la pared blanca y de noche se ve genial a unas 90 pulgadas. El altavoz suena flojito, pero lo conecto por Bluetooth a una barra de sonido y arreglado.",
      verified: true,
      helpful: 66,
    },
    {
      author: "Lidia Mosquera",
      rating: 3,
      date: "2026-06-24",
      title: "Solo sirve completamente a oscuras",
      body: "Es lo que hay con los proyectores portátiles: con algo de luz ambiental la imagen se lava del todo. Además el enfoque es manual y hay que retocarlo cada rato, porque según se calienta se descuadra.",
      verified: true,
      helpful: 88,
    },
    {
      author: "Rafa Iturralde",
      rating: 4,
      date: "2026-05-13",
      title: "El espejo del móvil va mucho mejor por cable",
      body: "Por wifi se ve con tirones en cuanto pones vídeo. Con un adaptador HDMI no falla nunca. Aviso: ese cable no viene incluido.",
      verified: true,
      helpful: 43,
    },
    {
      author: "Marina Escrivá",
      rating: 5,
      date: "2026-04-27",
      title: "Los niños ven los dibujos en el techo",
      body: "Lo apuntamos al techo desde la cama y encantados. Es ligero y se enciende en dos segundos.",
      verified: true,
      helpful: 17,
    },
    {
      author: "Unai Zabaleta",
      rating: 3,
      date: "2026-03-08",
      title: "El ventilador se oye más de la cuenta",
      body: "La imagen a 1080p está bien para lo que cuesta, pero en las escenas silenciosas se oye el ventilador de fondo. Con el volumen alto ni te enteras, con una película tranquila sí.",
      verified: false,
      helpful: 36,
    },
  ],

  "p-beauty-hair": [
    {
      author: "Sonia Peñalver",
      rating: 4,
      date: "2026-08-02",
      title: "Para viajar, perfecto; para casa, no",
      body: "Se pliega por la mitad y no ocupa nada en la maleta. Con el pelo largo tarda bastante más que mi secador de casa, pero es que son 1600 W y hay que asumirlo.",
      verified: true,
      helpful: 34,
    },
    {
      author: "Cecilia Barrenechea",
      rating: 5,
      date: "2026-06-06",
      title: "El voltaje dual me salvó en Estados Unidos",
      body: "Cambié el interruptor a 120 V y funcionó sin problema durante dos semanas. Acuérdate de cambiarlo de vuelta al volver.",
      verified: true,
      helpful: 26,
    },
    {
      author: "Álex Domínguez",
      rating: 3,
      date: "2026-05-11",
      title: "Ruidoso y el difusor es endeble",
      body: "Seca bien y el aire sale caliente de verdad, pero mete un ruido considerable y el difusor que trae es un plástico fino que encaja regular. Por lo que cuesta, aceptable; esperaba algo más.",
      verified: true,
      helpful: 49,
    },
    {
      author: "Rosana Iglesias",
      rating: 4,
      date: "2026-04-16",
      title: "El cable es demasiado corto",
      body: "Metro y medio escaso. En un hotel te apañas, en casa acabas tirando de alargador si el enchufe no está junto al espejo.",
      verified: true,
      helpful: 21,
    },
  ],

  "p-tech-tracker": [
    {
      author: "Manuel Torrijos",
      rating: 5,
      date: "2026-07-20",
      title: "Encontré la cartera entre los cojines",
      body: "Suena lo bastante alto para oírlo dentro del sofá. El grosor es real: no se nota en el bolsillo trasero.",
      verified: true,
      helpful: 45,
    },
    {
      author: "Alba Cañadas",
      rating: 3,
      date: "2026-06-01",
      title: "El alcance real es de una habitación",
      body: "Anuncian 60 metros y en campo abierto puede que sí, pero con dos paredes de por medio pierde la señal. Sirve para «lo tengo en casa», no para encontrar algo que se te ha caído por la calle.",
      verified: true,
      helpful: 74,
    },
    {
      author: "Guillermo Sanz",
      rating: 4,
      date: "2026-05-08",
      title: "La batería no se puede cambiar",
      body: "Dura un año según el fabricante y después a reciclar. Lo sabía al comprarlo, pero sigue siendo una pena en un producto que por lo demás está muy bien resuelto.",
      verified: true,
      helpful: 57,
    },
    {
      author: "Patricia Elorza",
      rating: 4,
      date: "2026-03-24",
      title: "Correcto por lo que cuesta",
      body: "Se empareja en un minuto y la app avisa si te alejas. No es un AirTag ni pretende serlo, y a este precio no se le puede pedir más.",
      verified: false,
      helpful: 19,
    },
  ],

  "p-home-vacuum": [
    {
      author: "Chus Villalonga",
      rating: 5,
      date: "2026-08-14",
      title: "El coche entero en veinte minutos",
      body: "Con la boquilla estrecha llego entre los asientos, que era justo lo que me daba rabia del aspirador grande. La batería me aguantó todo el coche del tirón.",
      verified: true,
      helpful: 53,
    },
    {
      author: "Eduardo Pardiñas",
      rating: 4,
      date: "2026-06-26",
      title: "Bien de succión, justo de autonomía",
      body: "Los 30 minutos son en potencia baja. En modo turbo son nueve o diez, así que conviene planificar por dónde empiezas.",
      verified: true,
      helpful: 68,
    },
    {
      author: "Amaia Goikoetxea",
      rating: 5,
      date: "2026-05-19",
      title: "El filtro HEPA se lava y listo",
      body: "Lo enjuago bajo el grifo, lo dejo secar una noche y queda como nuevo. En un año no he comprado ni un recambio.",
      verified: true,
      helpful: 30,
    },
    {
      author: "Iván Redruello",
      rating: 3,
      date: "2026-04-11",
      title: "Ruidoso y con el depósito pequeño",
      body: "Aspira de verdad, ahí ninguna queja. Pero mete un escándalo considerable y el depósito se llena enseguida si tienes perro: acabas vaciándolo tres veces por sesión.",
      verified: true,
      helpful: 44,
    },
  ],
};

/**
 * Reviews published for a product.
 * @param {string} productId
 * @returns {Review[]} empty array when the product has none — never undefined,
 *   so callers can map over the result without a guard.
 */
export const reviewsFor = (productId) => REVIEWS[productId] ?? [];

/**
 * Aggregate of the published reviews: the numbers the rating summary renders.
 *
 * Deliberately computed from the bank itself rather than from
 * `product.rating` / `product.reviewCount`. Those are the catalogue-wide
 * figures; showing them over a five-review breakdown would mean inventing a
 * distribution for the other 1.279 ratings.
 *
 * @param {string} productId
 * @returns {{count:number, average:number, verified:number,
 *            distribution:{stars:number, count:number, share:number}[]}}
 *   `distribution` always has five entries, 5 stars first, and `share` is a
 *   0–1 ratio of the total (0 when there are no reviews, so the bars render
 *   empty instead of dividing by zero).
 */
export function reviewSummary(productId) {
  const list = reviewsFor(productId);
  const counts = [0, 0, 0, 0, 0, 0]; // index = star value, [0] unused

  let sum = 0;
  let verified = 0;
  for (const review of list) {
    counts[review.rating]++;
    sum += review.rating;
    if (review.verified) verified++;
  }

  return {
    count: list.length,
    // One decimal is what the UI shows; rounding here keeps the headline
    // figure and the stars derived from it in agreement.
    average: list.length ? Math.round((sum / list.length) * 10) / 10 : 0,
    verified,
    distribution: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: counts[stars],
      share: list.length ? counts[stars] / list.length : 0,
    })),
  };
}
