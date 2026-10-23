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

const normText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Distancia de edición con tope: para tolerar una o dos letras mal escritas ("mantecion", "sangardo").
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Búsqueda difusa liviana (el catálogo es de decenas de servicios): cada palabra escrita debe aparecer en el nombre,
// en cualquier orden, o parecerse a una de sus palabras; sin eso, las letras escritas en orden dentro del nombre.
// Mientras más al inicio y más exacta la coincidencia, más arriba sale.
function rankServices(services: any[], q: string) {
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: { s: any; score: number }[] = [];
  for (const s of services) {
    const name = normText(s.name);
    const words = name.split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      const at = name.indexOf(t);
      if (at >= 0) { score += words.some(w => w.startsWith(t)) ? 0 : 2; score += at === 0 ? 0 : 1; continue; }
      const max = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
      const near = max > 0 && words.some(w => editDistance(t, w.slice(0, Math.max(t.length, 1) + 1), max) <= max || editDistance(t, w, max) <= max);
      if (near) { score += 4; continue; }
      ok = false; break;
    }
    if (!ok) {
      const compact = q.replace(/\s+/g, "");
      let i = 0;
      for (const ch of name) if (ch === compact[i]) i++;
      if (compact.length >= 3 && i === compact.length) { ok = true; score = 10; }
    }
    if (ok) scored.push({ s, score });
  }
  return scored.sort((a, b) => a.score - b.score).map(x => x.s);
}

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
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [saved, setSaved] = useState<Reservation | null>(null);

  useEffect(() => { if (open) { setF({ ...empty, date: tomorrow() }); setItems([]); setQuery(""); setListOpen(false); setSaved(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeClients = useMemo(() => (clients ?? []).filter(c => c.active), [clients]);
  const activeServices = useMemo(() => (services ?? []).filter((s: any) => s.active !== false), [services]);
  const match = activeClients.find(c => c.name.toLowerCase() === f.name.trim().toLowerCase()) ?? null;

  const total = items.reduce((s, i) => s + (i.quantity ?? 1) * i.unitPrice, 0);
  const itemHours = items.reduce((s, i) => s + (i.quantity ?? 1) * (i.hours ?? 0), 0);
  const hours = f.hours.trim() !== "" ? Number(f.hours.replace(",", ".")) : itemHours;

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const serviceOn = (id: number) => items.some(i => i.serviceId === id);
  const q = norm(query.trim());
  const matches = q ? rankServices(activeServices, q).slice(0, 8) : activeServices.slice(0, 8);
  const exact = q !== "" && activeServices.some((s: any) => norm(s.name) === q);
  // Opciones del buscador: los servicios que calzan y, si lo escrito no existe, agregarlo tal cual como texto libre.
  const options: ({ svc: any } | { free: string })[] = [
    ...matches.map((svc: any) => ({ svc })),
    ...(q && !exact ? [{ free: query.trim() }] : []),
  ];
  const addOption = (o: { svc: any } | { free: string }) => {
    if ("svc" in o) {
      const svc = o.svc;
      setItems(prev => serviceOn(svc.id)
        ? prev.filter(i => i.serviceId !== svc.id)
        : [...prev, { itemType: "service", description: svc.name, quantity: 1, unitPrice: Number(svc.basePrice ?? 0), hours: Number(svc.estimatedHours ?? 0), serviceId: svc.id }]);
    } else {
      setItems(prev => [...prev, { itemType: "service", description: o.free, quantity: 1, unitPrice: 0, hours: 0, serviceId: null }]);
    }
    setQuery(""); setHi(0); setListOpen(true);
  };
  const setPrice = (k: number, v: string) => setItems(prev => prev.map((i, n) => n === k ? { ...i, unitPrice: Math.max(0, Number(v) || 0) } : i));
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setListOpen(true); setHi(h => Math.min(h + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Escape") { if (listOpen) { e.stopPropagation(); setListOpen(false); } }
    else if (e.key === "Enter") { e.preventDefault(); const o = options[Math.min(hi, options.length - 1)]; if (o) addOption(o); }
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
                <Label>Qué se va a hacer</Label>
                <Input value={query} placeholder="Busca un servicio o escribe uno nuevo y presiona Enter" autoComplete="off" data-testid="input-reservation-service-search"
                  onChange={e => { setQuery(e.target.value); setHi(0); setListOpen(true); }}
                  onFocus={() => setListOpen(true)} onBlur={() => setTimeout(() => setListOpen(false), 150)} onKeyDown={onSearchKey} />
                {listOpen && options.length > 0 && (
                  <div className="rounded-md border divide-y max-h-52 overflow-y-auto text-sm" role="listbox" data-testid="reservation-service-options">
                    {options.map((o, k) => (
                      <button key={"svc" in o ? o.svc.id : "free"} type="button" role="option" aria-selected={k === hi}
                        onMouseDown={e => e.preventDefault()} onClick={() => addOption(o)} onMouseEnter={() => setHi(k)}
                        className={cn("flex w-full items-center gap-2 px-2.5 py-2 text-left", k === hi ? "bg-muted" : "hover:bg-muted/60")}>
                        {"svc" in o ? (
                          <>
                            <span className="flex-1 min-w-0 truncate flex items-center gap-1">{serviceOn(o.svc.id) && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}{o.svc.name}</span>
                            <span className="text-xs text-muted-foreground">{formatCLP(Number(o.svc.basePrice ?? 0))}</span>
                          </>
                        ) : (
                          <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />Agregar «{o.free}»</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {items.length > 0 && (
                  <div className="rounded-md border divide-y text-sm" data-testid="reservation-items">
                    {items.map((i, k) => (
                      <div key={k} className="flex items-center gap-2 px-2.5 py-1.5">
                        <span className="flex-1 min-w-0 truncate">{i.description}</span>
                        <Input className="h-8 w-24 text-right" type="number" inputMode="numeric" min="0" placeholder="Precio" value={i.unitPrice || ""} onChange={e => setPrice(k, e.target.value)} aria-label={`Precio de ${i.description}`} />
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
