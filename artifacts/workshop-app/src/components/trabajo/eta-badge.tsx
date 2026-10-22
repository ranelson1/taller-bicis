import type { WorkOrder } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { daysBetween } from "./dates-card";

// Días hasta el término estimado (negativo = atrasada). null si no aplica.
export function daysToEta(wo: Pick<WorkOrder, "estimatedDeliveryDate" | "completedAt" | "status">): number | null {
  if (!wo.estimatedDeliveryDate || wo.completedAt) return null;
  if (!["ready_to_work", "in_progress", "quality_control"].includes(wo.status)) return null;
  return daysBetween(new Date(), new Date(wo.estimatedDeliveryDate));
}

export function EtaBadge({ wo, className }: { wo: Pick<WorkOrder, "estimatedDeliveryDate" | "completedAt" | "status">; className?: string }) {
  const days = daysToEta(wo);
  if (days === null) return null;
  const text = days < 0 ? `Atrasada ${-days} d` : days === 0 ? "Vence hoy" : days === 1 ? "Mañana" : `En ${days} d`;
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border whitespace-nowrap",
      days < 0 ? "bg-red-50 text-red-700 border-red-200" : days === 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-muted text-muted-foreground border-transparent",
      className,
    )}>
      {text}
    </span>
  );
}
