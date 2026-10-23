// Ayudas del inventario: unidades, cantidades y margen de un artículo.

export const VAT_RATE = 0.19;

export const UNITS = [
  { value: "un", label: "unidad" }, { value: "par", label: "par" }, { value: "ml", label: "ml" },
  { value: "lt", label: "litro" }, { value: "g", label: "gramo" }, { value: "kg", label: "kilo" },
  { value: "m", label: "metro" }, { value: "cm", label: "cm" },
];

export const KIND_LABELS: Record<string, string> = { part: "Repuesto", supply: "Insumo" };

export const fmtQty = (n: number | null | undefined, unit?: string | null) => {
  if (n == null) return "—";
  const v = n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
  return unit && unit !== "un" ? `${v} ${unit}` : v;
};

// Margen de vender a `price` (con IVA, como se cobra) algo que costó `cost`.
// Si el taller recupera el IVA, se compara contra el neto de la venta.
export function marginPct(price: number | null | undefined, cost: number | null | undefined, recoversVat: boolean): number | null {
  if (!price || cost == null) return null;
  const revenue = recoversVat ? price / (1 + VAT_RATE) : price;
  return revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
}

// Costo real de lo comprado: neto si se recupera el IVA, con IVA si no.
export const effectiveCost = (unitCostNet: number, recoversVat: boolean) =>
  Math.round((recoversVat ? unitCostNet : unitCostNet * (1 + VAT_RATE)) * 100) / 100;

// Precio sugerido al cliente: costo + margen, redondeado a $10 (mismo cálculo que la API).
export const priceWithMargin = (unitCost: number, marginPctValue: number) =>
  Math.round((unitCost * (1 + marginPctValue / 100)) / 10) * 10;
