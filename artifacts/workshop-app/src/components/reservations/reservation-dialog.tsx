import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateReservation, useGetWorkshopSettings, useListClients, useListServices, usePreviewReservation,
  getListReservationsQueryKey, type Reservation,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { reservationMessage } from "@/lib/whatsapp";
import { CalendarClock } from "lucide-react";

// Reservar un espacio para una bici que llega (acordado por WhatsApp). No consume número de OT.

const NONE = "none";
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); };
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });

export function ReservationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const { data: services } = useListServices({});
  const { data: settings } = useGetWorkshopSettings();
  const create = useCreateReservation();
  const preview = usePreviewReservation();

  const empty = { name: "", phone: "", bike: "", note: "", serviceId: NONE, hours: "", date: tomorrow(), time: "" };
  const [f, setF] = useState(empty);
  const [saved, setSaved] = useState<Reservation | null>(null);

  useEffect(() => { if (open) { setF({ ...empty, date: tomorrow() }); setSaved(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeClients = useMemo(() => (clients ?? []).filter(c => c.active), [clients]);
  const match = activeClients.find(c => c.name.toLowerCase() === f.name.trim().toLowerCase()) ?? null;
  const svc = f.serviceId !== NONE ? (services ?? []).find((s: any) => String(s.id) === f.serviceId) : null;
  const hours = f.hours.trim() !== "" ? Number(f.hours.replace(",", ".")) : svc ? Number(svc.estimatedHours ?? 0) : 0;

  // Fechas estimadas en vivo, según la carga del taller y las otras reservas.
  useEffect(() => {
    if (!open || !f.date) return;
    const t = setTimeout(() => preview.mutate({ data: { expectedOn: f.date, estimatedHours: hours || null, serviceId: svc ? Number(svc.id) : null } }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, f.date, hours, f.serviceId]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const valid = f.name.trim().length > 0 && !!f.date;

  const submit = () => create.mutate({
    data: {
      clientId: match?.id ?? null, clientName: f.name.trim(), clientPhone: f.phone.trim() || match?.phone || null,
      bicycleText: f.bike.trim() || null, note: f.note.trim() || null, serviceId: svc ? Number(svc.id) : null,
      estimatedHours: f.hours.trim() !== "" ? hours : null, expectedOn: f.date, expectedTime: f.time || null,
    },
  }, {
    onSuccess: r => { setSaved(r); qc.invalidateQueries({ queryKey: getListReservationsQueryKey() }); },
    onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo reservar" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {saved ? (
          <>
            <DialogHeader>
              <DialogTitle>Reservado</DialogTitle>
              <DialogDescription>Avísale a {saved.clientName} por WhatsApp para confirmar.</DialogDescription>
            </DialogHeader>
            <p className="rounded-md bg-muted p-3 text-sm">
              {reservationMessage(saved, settings?.name)}
            </p>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Listo</Button>
              <WhatsAppButton size="default" phone={saved.clientPhone} label="Confirmar por WhatsApp" text={reservationMessage(saved, settings?.name)} />
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />Reservar espacio</DialogTitle>
              <DialogDescription>Aparta el día para una bici que llega. El número de OT se asigna cuando llegue.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Cliente *</Label>
                <Input list="reservation-clients" value={f.name} onChange={set("name")} placeholder="Nombre (elige uno existente o escribe uno nuevo)" data-testid="input-reservation-name" />
                <datalist id="reservation-clients">{activeClients.map(c => <option key={c.id} value={c.name} />)}</datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Teléfono</Label>
                  <Input type="tel" inputMode="tel" value={f.phone || (match?.phone ?? "")} onChange={set("phone")} placeholder="Para WhatsApp" data-testid="input-reservation-phone" /></div>
                <div className="space-y-1.5"><Label>Bicicleta</Label>
                  <Input value={f.bike} onChange={set("bike")} placeholder="Trek Marlin 7" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Servicio (opcional)</Label>
                  <Select value={f.serviceId} onValueChange={v => setF(x => ({ ...x, serviceId: v, hours: "" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Aún no sé</SelectItem>
                      {(services ?? []).filter((s: any) => s.active !== false).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>Horas estimadas</Label>
                  <Input inputMode="decimal" value={f.hours} onChange={set("hours")} placeholder={svc ? String(svc.estimatedHours ?? "") : "1"} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Día que llega *</Label>
                  <Input type="date" min={ymd(new Date())} value={f.date} onChange={set("date")} data-testid="input-reservation-date" /></div>
                <div className="space-y-1.5"><Label>Hora (opcional)</Label>
                  <Input type="time" value={f.time} onChange={set("time")} /></div>
              </div>
              <div className="space-y-1.5"><Label>Lo acordado</Label>
                <Textarea rows={2} value={f.note} onChange={set("note")} placeholder="Ej: cambio de transmisión, cotizado en $85.000" /></div>
              {preview.data && (
                <div className="rounded-md bg-muted p-3 text-sm space-y-0.5" data-testid="reservation-preview">
                  <p>Llega: <strong className="first-letter:uppercase">{fmtDay(`${f.date}T12:00:00`)}</strong></p>
                  <p>Lista aprox.: <strong className="first-letter:uppercase">{fmtDay(preview.data.estimatedDeliveryDate)}</strong></p>
                  <p className="text-xs text-muted-foreground">Según el trabajo que ya tienes y las otras reservas ({preview.data.backlogHours} h en cola).</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={!valid || create.isPending} data-testid="button-save-reservation">Reservar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
