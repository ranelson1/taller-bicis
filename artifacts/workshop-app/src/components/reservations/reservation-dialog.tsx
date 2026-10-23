import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateReservation, useGetWorkshopSettings, useListClients, useListServices, usePreviewReservation,
  getListReservationsQueryKey, type Reservation, type ReservationQuoteItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { reservationMessage } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";
import { CalendarClock, Check, Plus, X } from "lucide-react";

// Cotizar y reservar: lo acordado por WhatsApp (servicios y cobros con su precio), el día que llega la bici y las
// fechas estimadas de ingreso y entrega. No consume número de OT; al llegar el cliente se convierte en el trabajo.

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

  const empty = { name: "", phone: "", bike: "", note: "", hours: "", date: tomorrow(), time: "" };
  const [f, setF] = useState(empty);
  const [items, setItems] = useState<ReservationQuoteItem[]>([]);
  const [extra, setExtra] = useState({ description: "", price: "" });
  const [saved, setSaved] = useState<Reservation | null>(null);

  useEffect(() => { if (open) { setF({ ...empty, date: tomorrow() }); setItems([]); setExtra({ description: "", price: "" }); setSaved(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeClients = useMemo(() => (clients ?? []).filter(c => c.active), [clients]);
  const activeServices = useMemo(() => (services ?? []).filter((s: any) => s.active !== false), [services]);
  const match = activeClients.find(c => c.name.toLowerCase() === f.name.trim().toLowerCase()) ?? null;

  const total = items.reduce((s, i) => s + (i.quantity ?? 1) * i.unitPrice, 0);
  const itemHours = items.reduce((s, i) => s + (i.quantity ?? 1) * (i.hours ?? 0), 0);
  const hours = f.hours.trim() !== "" ? Number(f.hours.replace(",", ".")) : itemHours;

  const serviceOn = (id: number) => items.some(i => i.serviceId === id);
  const toggleService = (svc: any) => setItems(prev => serviceOn(svc.id)
    ? prev.filter(i => i.serviceId !== svc.id)
    : [...prev, { itemType: "service", description: svc.name, quantity: 1, unitPrice: Number(svc.basePrice ?? 0), hours: Number(svc.estimatedHours ?? 0), serviceId: svc.id }]);
  const addExtra = () => {
    const description = extra.description.trim();
    const price = Number(extra.price || 0);
    if (!description || isNaN(price) || price < 0) return;
    setItems(prev => [...prev, { itemType: "part", description, quantity: 1, unitPrice: price, hours: 0, serviceId: null }]);
    setExtra({ description: "", price: "" });
  };

  // Fechas estimadas en vivo, según la carga del taller y las otras reservas.
  useEffect(() => {
    if (!open || !f.date) return;
    const t = setTimeout(() => preview.mutate({ data: { expectedOn: f.date, estimatedHours: hours || null } }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, f.date, hours]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const valid = f.name.trim().length > 0 && !!f.date;

  const submit = () => create.mutate({
    data: {
      clientId: match?.id ?? null, clientName: f.name.trim(), clientPhone: f.phone.trim() || match?.phone || null,
      bicycleText: f.bike.trim() || null, note: f.note.trim() || null, quoteItems: items,
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
              <DialogTitle>{saved.quoteItems && saved.quoteItems.length > 0 ? "Cotización y reserva listas" : "Reservado"}</DialogTitle>
              <DialogDescription>Mándale el mensaje a {saved.clientName} por WhatsApp para confirmar.</DialogDescription>
            </DialogHeader>
            <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-line">{reservationMessage(saved, settings?.name)}</p>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Listo</Button>
              <WhatsAppButton size="default" phone={saved.clientPhone} label="Enviar por WhatsApp" text={reservationMessage(saved, settings?.name)} />
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />Cotizar y reservar</DialogTitle>
              <DialogDescription>Arma la cotización, aparta el día y mándala por WhatsApp. El número de OT se asigna cuando llegue la bici.</DialogDescription>
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

              <div className="space-y-1.5">
                <Label>Qué se va a hacer (toca para agregar)</Label>
                <div className="flex flex-wrap gap-2">
                  {activeServices.map((s: any) => (
                    <button key={s.id} type="button" onClick={() => toggleService(s)} data-testid={`reservation-service-${s.id}`}
                      className={cn("rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors", serviceOn(s.id) ? "bg-primary/10 border-primary" : "hover:bg-muted")}>
                      <span className="flex items-center gap-1 font-medium">{serviceOn(s.id) && <Check className="h-3.5 w-3.5 text-primary" />}{s.name}</span>
                      <span className="text-xs text-muted-foreground">{formatCLP(Number(s.basePrice ?? 0))}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input className="flex-1" placeholder="Repuesto u otro cobro" value={extra.description} onChange={e => setExtra(x => ({ ...x, description: e.target.value }))} onKeyDown={e => e.key === "Enter" && addExtra()} />
                  <Input className="w-28" type="number" inputMode="numeric" min="0" placeholder="Precio" value={extra.price} onChange={e => setExtra(x => ({ ...x, price: e.target.value }))} onKeyDown={e => e.key === "Enter" && addExtra()} />
                  <Button type="button" variant="outline" onClick={addExtra} aria-label="Agregar" data-testid="button-reservation-add-extra"><Plus className="h-4 w-4" /></Button>
                </div>
                {items.length > 0 && (
                  <div className="rounded-md border divide-y text-sm" data-testid="reservation-items">
                    {items.map((i, k) => (
                      <div key={k} className="flex items-center gap-2 px-2.5 py-1.5">
                        <span className="flex-1 min-w-0 truncate">{i.description}</span>
                        <span className="text-muted-foreground">{formatCLP(i.unitPrice)}</span>
                        <button type="button" onClick={() => setItems(prev => prev.filter((_, n) => n !== k))} aria-label="Quitar" className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                      </div>
                    ))}
                    <div className="flex justify-between px-2.5 py-1.5 font-semibold bg-muted/40"><span>Total</span><span data-testid="reservation-total">{formatCLP(total)}</span></div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Día que llega *</Label>
                  <Input type="date" min={ymd(new Date())} value={f.date} onChange={set("date")} data-testid="input-reservation-date" /></div>
                <div className="space-y-1.5"><Label>Hora</Label>
                  <Input type="time" value={f.time} onChange={set("time")} /></div>
                <div className="space-y-1.5"><Label>Horas</Label>
                  <Input inputMode="decimal" value={f.hours} onChange={set("hours")} placeholder={itemHours ? String(itemHours) : "1"} /></div>
              </div>
              <div className="space-y-1.5"><Label>Nota</Label>
                <Textarea rows={2} value={f.note} onChange={set("note")} placeholder="Ej: la deja el jueves antes de las 10, pasa a buscarla el sábado" /></div>
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
              <Button onClick={submit} disabled={!valid || create.isPending} data-testid="button-save-reservation">{items.length > 0 ? "Guardar cotización y reserva" : "Reservar"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
