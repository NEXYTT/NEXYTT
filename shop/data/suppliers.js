/**
 * Supplier directory.
 *
 * In dropshipping the supplier *is* the product: lead time, defect rate and
 * dispute rate drive the margin far more than the listing price does. These
 * fields feed the back-office scorecard.
 */
export const SUPPLIERS = [
  {
    id: "sup1",
    name: "Shenzhen Lumina Tech",
    country: "CN",
    platform: "AliExpress",
    leadTimeDays: [8, 14],
    defectRate: 0.018,
    disputeRate: 0.011,
    rating: 4.7,
    since: "2022-03",
    paymentTerms: "Prepago",
    notes: "Fiable en iluminación y pequeño electrónico. Acepta etiqueta blanca desde 50 uds.",
  },
  {
    id: "sup2",
    name: "CJ Dropshipping ES",
    country: "ES",
    platform: "CJ Dropshipping",
    leadTimeDays: [2, 5],
    defectRate: 0.009,
    disputeRate: 0.006,
    rating: 4.9,
    since: "2023-01",
    paymentTerms: "Prepago",
    notes: "Almacén en Madrid. Coste algo mayor, pero entrega en 48-72 h y devoluciones locales.",
  },
  {
    id: "sup3",
    name: "Yiwu Home Living",
    country: "CN",
    platform: "1688",
    leadTimeDays: [12, 20],
    defectRate: 0.031,
    disputeRate: 0.024,
    rating: 4.3,
    since: "2021-09",
    paymentTerms: "30% anticipo",
    notes: "Precios muy agresivos en menaje. Vigilar control de calidad en lotes grandes.",
  },
  {
    id: "sup4",
    name: "Guangzhou ActiveGear",
    country: "CN",
    platform: "AliExpress",
    leadTimeDays: [9, 16],
    defectRate: 0.021,
    disputeRate: 0.014,
    rating: 4.6,
    since: "2022-11",
    paymentTerms: "Prepago",
    notes: "Especialista en fitness y textil técnico. Tallaje asiático: publicar tabla de tallas.",
  },
  {
    id: "sup5",
    name: "Barcelona Petcare Hub",
    country: "ES",
    platform: "Proveedor directo",
    leadTimeDays: [1, 3],
    defectRate: 0.007,
    disputeRate: 0.004,
    rating: 4.8,
    since: "2023-06",
    paymentTerms: "Net 15",
    notes: "Stock local de mascotas. Margen menor pero mejor conversión por entrega rápida.",
  },
];

export const supplierById = (id) => SUPPLIERS.find((s) => s.id === id) ?? null;
