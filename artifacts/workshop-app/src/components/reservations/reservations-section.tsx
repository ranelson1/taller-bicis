import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkshopSettings, useListReservations, useUpdateReservation, getListReservationsQueryKey, type Reservation,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { reservationMessage } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";
import { CalendarClock, MoreHorizontal } from "lucide-react";

// Reservas pendientes (bicis que van a llegar), por día. "Llegó" abre Nuevo trabajo con lo acordado.

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dayLabel(key: string) {
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (key === ymd(today)) return "Hoy";
  if (key === ymd(tomorrow)) return "Mañana";
  if (key < ymd(today)) return "Atrasadas";
  return new Date(`${key}T12:00:00`).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
}

export function ReservationsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: reservations } = useListReservations();
  const { data: settings } = useGetWorkshopSettings();
  const update = useUpdateReservation();
  if (!reservations || reservations.length === 0) return null;

  const close = (r: Reservation, status: "cancelled" | "no_show") => update.mutate({ id: r.id, data: { status } }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListReservationsQueryKey() }); toast({ title: status === "no_show" ? "Marcada como no llegó" : "Reserva cancelada" }); },
    onError: () => toast({ variant: "destructive", title: "No se pudo actualizar" }),
  });

  const groups = new Map<string, Reservation[]>();
  for (const r of reservations) groups.set(r.expectedOn, [...(groups.get(r.expectedOn) ?? []), r]);

  return (
    <Card data-testid="reservations-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />Reservas ({reservations.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {[...groups.entries()].map(([key, list]) => (
          <div key={key}>
            <p className={cn("text-xs font-medium first-letter:uppercase mb-1", key < ymd(new Date()) ? "text-red-700" : "text-muted-foreground")}>{dayLabel(key)}</p>
            <div className="divide-y rounded-md border">
              {list.map(r => (
                <div key={r.id} className="p-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid={`reservation-${r.id}`}>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-sm font-medium truncate">{r.expectedTime ? `${r.expectedTime} · ` : ""}{r.clientName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[r.bicycleText, r.quoteItems && r.quoteItems.length > 0 ? `${r.quoteItems.length} ítem(s) · ${formatCLP(r.quoteTotal ?? 0)}` : null, r.note].filter(Boolean).join(" · ") || "Sin detalle"}
                      {r.estimatedDeliveryDate && ` · lista ≈ ${new Date(r.estimatedDeliveryDate).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" })}`}
                    </p>
                  </div>
                  <WhatsAppButton phone={r.clientPhone} label="Confirmar" className="h-8" text={reservationMessage(r, settings?.name)} />
                  <Button asChild size="sm" className="h-8" data-testid={`arrived-${r.id}`}><Link href={`/trabajos/nuevo?reserva=${r.id}`}>Llegó</Link></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Más"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => close(r, "no_show")}>No llegó</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => close(r, "cancelled")}>Cancelar reserva</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
