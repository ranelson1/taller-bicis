// Estados de un trabajo (su OT), con los mismos nombres en toda la app.

export const WO_STATUSES = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup", "delivered", "cancelled"] as const;
export type WoStatus = typeof WO_STATUSES[number];

export const WO_STATUS_LABELS: Record<string, string> = {
  ready_to_work: "Recibida",
  in_progress: "En reparación",
  quality_control: "Control de calidad",
  ready_for_pickup: "Lista para retiro",
  delivered: "Entregada",
  cancelled: "Cancelada",
};

export const WO_STATUS_COLORS: Record<string, string> = {
  ready_to_work: "bg-sky-50 text-sky-700 border-sky-200",
  in_progress: "bg-yellow-50 text-yellow-700 border-yellow-200",
  quality_control: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_pickup: "bg-green-50 text-green-700 border-green-200",
  delivered: "bg-gray-50 text-gray-500 border-gray-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

// Recorrido normal (sin cancelada).
export const WO_STEPS = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup", "delivered"];

// Siguiente paso de la OT con un toque.
export const WO_NEXT_ACTION: Record<string, { label: string; next: string }> = {
  ready_to_work: { label: "Iniciar trabajo", next: "in_progress" },
  in_progress: { label: "Enviar a control de calidad", next: "quality_control" },
  quality_control: { label: "Marcar lista para retiro", next: "ready_for_pickup" },
  ready_for_pickup: { label: "Marcar como entregada", next: "delivered" },
};

export const OPEN_WO_STATUSES = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup"];

// Sin pago registrado o con saldo pendiente (abono menor al total).
export function hasBalanceDue(wo: { paidAt?: string | null; paidAmount?: number | null; total: number }): boolean {
  return !wo.paidAt || (wo.paidAmount != null && wo.paidAmount < wo.total);
}

// Lo que falta cobrar de un trabajo ya entregado (0 si está pagado completo o aún no se entrega).
export function balanceDue(wo: { status: string; paidAt?: string | null; paidAmount?: number | null; total: number }): number {
  if (wo.status !== "delivered") return 0;
  const paid = wo.paidAt ? wo.paidAmount ?? wo.total : 0;
  return Math.max(0, wo.total - paid);
}

export function formatCLP(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}
