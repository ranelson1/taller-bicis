import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useQuickCreateWorkCase,
  usePreviewWorkOrderEstimate,
  useListClients,
  useListBicycles,
  useListUsers,
  useListServices,
  useListParts,
  getListWorkCasesQueryKey,
  getListWorkOrdersQueryKey,
  type QuickCreateInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWorkers } from "@/hooks/use-workers";
import { ArrowLeft, Bike, CalendarClock, Check, ChevronDown, ChevronUp, Plus, Search, Trash2, User, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";

// Nuevo trabajo en una sola pantalla: cliente → bicicleta → qué hay que hacer.
// Por dentro crea cliente/bici si hacen falta, presupuesto aprobado, recepción y OT.

const BIKE_TYPES = [
  { value: "mtb", label: "MTB" }, { value: "road", label: "Ruta" }, { value: "gravel", label: "Gravel" },
  { value: "urban", label: "Urbana" }, { value: "ebike", label: "E-Bike" }, { value: "kids", label: "Niños" },
  { value: "other", label: "Otra" },
] as const;

const CHANNELS = [
  { value: "presencial", label: "Presencial" }, { value: "whatsapp", label: "WhatsApp" },
  { value: "telefono", label: "Teléfono" }, { value: "instagram", label: "Instagram" },
  { value: "email", label: "Email" }, { value: "otro", label: "Otro" },
];

const ACCESSORIES = ["Luces", "Candado", "Bolso", "Bombín", "Ciclocomputador", "Pedales", "Portabotella"];

const EXTRA_TYPES = [
  { value: "part", label: "Repuesto" },
  { value: "additional_labor", label: "Mano de obra" },
  { value: "other", label: "Otro" },
];

const MAX_YEAR = new Date().getFullYear() + 1;

type Item = {
  key: string;
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  hours: number; // por unidad, para estimar el término
  serviceId?: number | null;
  partId?: number | null;
};

type NewClient = { name: string; phone: string; email: string };
type NewBike = { brand: string; model: string; type: string; year: string; color: string; serialNumber: string };

const digits = (s: string) => s.replace(/\D/g, "");

function Section({ n, title, icon: Icon, done, children }: { n: number; title: string; icon: typeof User; done?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <span className={cn("h-6 w-6 rounded-full text-xs flex items-center justify-center", done ? "bg-green-600 text-white" : "bg-primary text-primary-foreground")}>
            {done ? <Check className="h-3.5 w-3.5" /> : n}
          </span>
          <Icon className="h-4 w-4 text-muted-foreground" />{title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default function TrabajoNuevo() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: clients } = useListClients();
  const { data: bicycles } = useListBicycles();
  const { data: users } = useListUsers();
  const { data: services } = useListServices({});
  const { data: allParts } = useListParts({});
  const parts = useMemo(() => (allParts ?? []).filter((p: any) => p.kind !== "supply"), [allParts]);
  const quickCreate = useQuickCreateWorkCase();
  const preview = usePreviewWorkOrderEstimate();

  // 1. Cliente
  const [clientId, setClientId] = useState<number | null>(null);
  const [newClient, setNewClient] = useState<NewClient | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  // 2. Bicicleta
  const [bikeId, setBikeId] = useState<number | null>(null);
  const [newBike, setNewBike] = useState<NewBike | null>(null);
  const [showBikeMore, setShowBikeMore] = useState(false);
  // 3. Trabajo
  const [items, setItems] = useState<Item[]>([]);
  const [extra, setExtra] = useState({ itemType: "part", description: "", unitPrice: "" });
  const [problem, setProblem] = useState("");
  const [mechanicId, setMechanicId] = useState("none");
  const [accessories, setAccessories] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [channel, setChannel] = useState("presencial");
  const [visualCondition, setVisualCondition] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [otherAccessory, setOtherAccessory] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const activeClients = (clients ?? []).filter(c => c.active);
  const { workers: mechanics, solo } = useWorkers();
  const activeServices = (services ?? []).filter((s: any) => s.active !== false);
  const selectedClient = activeClients.find(c => c.id === clientId) ?? null;
  const clientBikes = (bicycles ?? []).filter(b => b.clientId === clientId && b.active);

  const q = clientQuery.trim().toLowerCase();
  const clientMatches = q.length === 0 ? [] : activeClients.filter(c =>
    c.name.toLowerCase().includes(q) || (digits(q).length >= 3 && digits(c.phone ?? "").includes(digits(q))),
  ).slice(0, 6);

  const total = items.reduce((s, i) => s + (i.itemType === "discount" ? -1 : 1) * i.quantity * i.unitPrice, 0);
  const laborHours = items.reduce((s, i) => s + i.hours * i.quantity, 0);
  const mechanicNum = mechanicId !== "none" ? Number(mechanicId) : null;

  // Término estimado en vivo según la carga del taller.
  useEffect(() => {
    if (items.length === 0) return;
    const t = setTimeout(() => preview.mutate({ data: { laborHours, mechanicId: mechanicNum } }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laborHours, mechanicNum, items.length]);
  const eta = items.length > 0 ? preview.data : undefined;

  const pickClient = (id: number) => {
    setClientId(id); setNewClient(null); setClientQuery("");
    setBikeId(null); setNewBike(null); setErrors({});
  };
  const startNewClient = () => {
    const isPhone = digits(clientQuery).length >= 6;
    setNewClient({ name: isPhone ? "" : clientQuery.trim(), phone: isPhone ? clientQuery.trim() : "", email: "" });
    setClientId(null); setClientQuery("");
    setBikeId(null); setNewBike({ brand: "", model: "", type: "mtb", year: "", color: "", serialNumber: "" });
  };
  const resetClient = () => { setClientId(null); setNewClient(null); setBikeId(null); setNewBike(null); };

  const serviceSelected = (id: number) => items.some(i => i.serviceId === id);
  const toggleService = (svc: any) => {
    setErrors(e => ({ ...e, items: "" }));
    if (serviceSelected(svc.id)) { setItems(prev => prev.filter(i => i.serviceId !== svc.id)); return; }
    setItems(prev => [...prev, {
      key: `s${svc.id}`, itemType: "service", description: svc.name, quantity: 1,
      unitPrice: Number(svc.basePrice ?? 0), hours: Number(svc.estimatedHours ?? 0), serviceId: svc.id,
    }]);
  };

  const partByName = useMemo(() => new Map((parts ?? []).map((p: any) => [p.name.toLowerCase(), p])), [parts]);
  const onExtraDescription = (value: string) => {
    const part = extra.itemType === "part" ? partByName.get(value.toLowerCase()) : undefined;
    setExtra(e => ({ ...e, description: value, unitPrice: part ? String(part.suggestedPrice ?? 0) : e.unitPrice }));
  };
  const addExtra = () => {
    const description = extra.description.trim();
    const price = Number(extra.unitPrice || 0);
    if (!description) { setErrors(e => ({ ...e, extra: "Escribe qué es" })); return; }
    if (isNaN(price) || price < 0) { setErrors(e => ({ ...e, extra: "Precio inválido" })); return; }
    const part = extra.itemType === "part" ? partByName.get(description.toLowerCase()) : undefined;
    setItems(prev => [...prev, {
      key: `x${Date.now()}`, itemType: extra.itemType, description, quantity: 1, unitPrice: price, hours: 0,
      partId: part?.id ?? null,
    }]);
    setExtra(e => ({ ...e, description: "", unitPrice: "" }));
    setErrors(e => ({ ...e, extra: "", items: "" }));
  };
  const updateItem = (key: string, patch: Partial<Item>) => setItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)));

  const toggleAccessory = (a: string) => setAccessories(prev => (prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]));

  const clientDone = !!selectedClient || !!newClient?.name.trim();
  const bikeDone = !!bikeId || (!!newBike?.brand.trim() && !!newBike?.model.trim());

  const validate = () => {
    const e: Record<string, string> = {};
    if (!clientDone) e.client = newClient ? "Escribe el nombre del cliente" : "Busca un cliente o crea uno nuevo";
    if (!bikeDone) e.bike = newBike ? "Marca y modelo son obligatorios" : "Elige la bicicleta";
    if (newBike?.year.trim()) {
      const y = Number(newBike.year);
      if (!Number.isInteger(y) || y < 1990 || y > MAX_YEAR) e.bike = `Año entre 1990 y ${MAX_YEAR}`;
    }
    if (items.length === 0) e.items = "Agrega al menos un servicio o ítem";
    if (items.some(i => !(i.quantity > 0))) e.items = "Revisa las cantidades";
    setErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(`section-${e.client ? "client" : e.bike ? "bike" : "items"}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  };

  const submit = () => {
    if (!validate()) return;
    const client: QuickCreateInput["client"] = selectedClient
      ? { id: selectedClient.id, name: selectedClient.name }
      : { name: newClient!.name.trim(), phone: newClient!.phone.trim() || null, email: newClient!.email.trim() || null };
    const bicycle: QuickCreateInput["bicycle"] = bikeId
      ? ({ id: bikeId } as QuickCreateInput["bicycle"])
      : {
          brand: newBike!.brand.trim(), model: newBike!.model.trim(),
          type: newBike!.type as QuickCreateInput["bicycle"]["type"],
          year: newBike!.year.trim() ? Number(newBike!.year) : null,
          color: newBike!.color.trim() || null, serialNumber: newBike!.serialNumber.trim() || null,
        };
    const acc = [...accessories, ...otherAccessory.split(",").map(s => s.trim()).filter(Boolean)];

    quickCreate.mutate({
      data: {
        client, bicycle,
        originChannel: channel,
        assignedMechanicId: mechanicNum,
        customerComment: problem.trim() || null,
        mechanicComment: internalNote.trim() || null,
        initialVisualCondition: visualCondition.trim() || null,
        accessoriesReceived: acc.length > 0 ? acc : null,
        items: items.map(i => ({
          itemType: i.itemType as any, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice,
          serviceId: i.serviceId ?? null, partId: i.partId ?? null,
          estimatedLaborHours: i.serviceId ? null : (i.hours ? i.hours * i.quantity : null),
        })),
      },
    }, {
      onSuccess: (result) => {
        const etaText = result.estimatedDeliveryDate
          ? ` · Término estimado: ${new Date(result.estimatedDeliveryDate).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "short" })}`
          : "";
        toast({ title: `Trabajo ${result.workOrderNumber} creado`, description: `Listo para enviar al cliente${etaText}` });
        qc.invalidateQueries({ queryKey: getListWorkCasesQueryKey() });
        qc.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });
        navigate(`/trabajos/${result.workCaseId}?avisar=1`);
      },
      onError: (err: any) => toast({ variant: "destructive", title: "No se pudo crear el trabajo", description: err?.data?.error ?? err?.message }),
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-4 pb-40 md:pb-28">
      <div className="flex items-center gap-2">
        <Link href="/trabajos"><Button variant="ghost" size="icon" className="-ml-2"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <h1 className="text-2xl font-bold">Nuevo trabajo</h1>
      </div>

      {/* 1. Cliente */}
      <div id="section-client">
        <Section n={1} title="Cliente" icon={User} done={clientDone}>
          {selectedClient ? (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">{selectedClient.name}</p>
                <p className="text-sm text-muted-foreground">{selectedClient.phone ?? "Sin teléfono"}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={resetClient} data-testid="button-change-client">Cambiar</Button>
            </div>
          ) : newClient ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Cliente nuevo</p>
                <Button variant="ghost" size="sm" onClick={resetClient}><X className="h-4 w-4 mr-1" />Buscar existente</Button>
              </div>
              <Input autoFocus placeholder="Nombre *" value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} data-testid="input-client-name" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input type="tel" inputMode="tel" placeholder="Teléfono (para WhatsApp)" value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} data-testid="input-client-phone" />
                <Input type="email" placeholder="Email (opcional)" value={newClient.email} onChange={e => setNewClient({ ...newClient, email: e.target.value })} data-testid="input-client-email" />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input autoFocus className="pl-9 h-11" placeholder="Nombre o teléfono del cliente" value={clientQuery}
                  onChange={e => setClientQuery(e.target.value)} data-testid="input-client-search" />
              </div>
              {clientMatches.length > 0 && (
                <ul className="rounded-md border divide-y">
                  {clientMatches.map(c => (
                    <li key={c.id}>
                      <button type="button" className="w-full text-left px-3 py-2.5 hover:bg-muted" onClick={() => pickClient(c.id)} data-testid={`client-option-${c.id}`}>
                        <span className="font-medium">{c.name}</span>
                        <span className="text-sm text-muted-foreground ml-2">{c.phone ?? ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {q.length > 0 && clientMatches.length === 0 && <p className="text-sm text-muted-foreground">No hay clientes con “{clientQuery}”.</p>}
              <Button variant="outline" className="w-full" onClick={startNewClient} data-testid="button-new-client">
                <Plus className="h-4 w-4 mr-1" />{q ? `Crear cliente “${clientQuery.trim()}”` : "Cliente nuevo"}
              </Button>
            </div>
          )}
          {errors.client && <p className="text-sm text-destructive">{errors.client}</p>}
        </Section>
      </div>

      {/* 2. Bicicleta */}
      {(selectedClient || newClient) && (
        <div id="section-bike">
          <Section n={2} title="Bicicleta" icon={Bike} done={bikeDone}>
            {selectedClient && (
              <div className="flex flex-wrap gap-2">
                {clientBikes.map(b => (
                  <button key={b.id} type="button" onClick={() => { setBikeId(b.id); setNewBike(null); setErrors(e => ({ ...e, bike: "" })); }}
                    className={cn("rounded-full border px-3 py-2 text-sm", bikeId === b.id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}
                    data-testid={`bike-option-${b.id}`}>
                    {b.brand} {b.model}
                  </button>
                ))}
                <button type="button" onClick={() => { setBikeId(null); setNewBike({ brand: "", model: "", type: "mtb", year: "", color: "", serialNumber: "" }); }}
                  className={cn("rounded-full border border-dashed px-3 py-2 text-sm", newBike ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}
                  data-testid="button-new-bike">
                  <Plus className="h-3.5 w-3.5 inline mr-1" />Otra bicicleta
                </button>
              </div>
            )}
            {newBike && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Marca *" value={newBike.brand} onChange={e => setNewBike({ ...newBike, brand: e.target.value })} data-testid="input-bike-brand" />
                  <Input placeholder="Modelo *" value={newBike.model} onChange={e => setNewBike({ ...newBike, model: e.target.value })} data-testid="input-bike-model" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {BIKE_TYPES.map(t => (
                    <button key={t.value} type="button" onClick={() => setNewBike({ ...newBike, type: t.value })}
                      className={cn("rounded-full border px-2.5 py-1 text-xs", newBike.type === t.value ? "bg-foreground text-background" : "hover:bg-muted")}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="text-xs text-primary flex items-center gap-1" onClick={() => setShowBikeMore(v => !v)}>
                  {showBikeMore ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}Año, color, n° de serie
                </button>
                {showBikeMore && (
                  <div className="grid grid-cols-3 gap-2">
                    <Input type="number" inputMode="numeric" placeholder="Año" value={newBike.year} onChange={e => setNewBike({ ...newBike, year: e.target.value })} />
                    <Input placeholder="Color" value={newBike.color} onChange={e => setNewBike({ ...newBike, color: e.target.value })} />
                    <Input placeholder="N° serie" value={newBike.serialNumber} onChange={e => setNewBike({ ...newBike, serialNumber: e.target.value })} />
                  </div>
                )}
              </div>
            )}
            {errors.bike && <p className="text-sm text-destructive">{errors.bike}</p>}
          </Section>
        </div>
      )}

      {/* 3. Trabajo */}
      {(selectedClient || newClient) && (
        <div id="section-items">
          <Section n={3} title="Qué hay que hacer" icon={Wrench} done={items.length > 0}>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Problema que cuenta el cliente</Label>
              <Textarea rows={2} placeholder="Ej: frena mal adelante, cambios saltan" value={problem} onChange={e => setProblem(e.target.value)} data-testid="textarea-problem" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Servicios (toca para agregar)</Label>
              <div className="flex flex-wrap gap-2">
                {activeServices.map((s: any) => (
                  <button key={s.id} type="button" onClick={() => toggleService(s)} data-testid={`service-chip-${s.id}`}
                    className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", serviceSelected(s.id) ? "bg-primary/10 border-primary text-foreground" : "hover:bg-muted")}>
                    <span className="flex items-center gap-1 font-medium">{serviceSelected(s.id) && <Check className="h-3.5 w-3.5 text-primary" />}{s.name}</span>
                    <span className="text-xs text-muted-foreground">{formatCLP(Number(s.basePrice ?? 0))}{s.estimatedHours ? ` · ${Number(s.estimatedHours)} h` : ""}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Repuesto u otro cobro</Label>
              <div className="flex flex-wrap gap-2">
                <Select value={extra.itemType} onValueChange={v => setExtra(e => ({ ...e, itemType: v }))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{EXTRA_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="flex-1 min-w-40" list="parts-catalog" placeholder={extra.itemType === "part" ? "Repuesto (escribe o elige)" : "Descripción"}
                  value={extra.description} onChange={e => onExtraDescription(e.target.value)} onKeyDown={e => e.key === "Enter" && addExtra()} data-testid="input-extra-description" />
                <Input className="w-28" type="number" inputMode="numeric" min="0" placeholder="Precio" value={extra.unitPrice}
                  onChange={e => setExtra(x => ({ ...x, unitPrice: e.target.value }))} onKeyDown={e => e.key === "Enter" && addExtra()} data-testid="input-extra-price" />
                <Button variant="outline" onClick={addExtra} data-testid="button-add-extra"><Plus className="h-4 w-4" /></Button>
              </div>
              <datalist id="parts-catalog">{(parts ?? []).map((p: any) => <option key={p.id} value={p.name} />)}</datalist>
              {errors.extra && <p className="text-sm text-destructive">{errors.extra}</p>}
            </div>

            {items.length > 0 && (
              <ul className="rounded-md border divide-y">
                {items.map(i => (
                  <li key={i.key} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 p-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{i.description}</p>
                      {i.hours > 0 && <p className="text-xs text-muted-foreground">{i.hours * i.quantity} h estimadas</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input className="w-14 h-8 text-center" type="number" inputMode="numeric" min="1" value={i.quantity}
                        onChange={e => updateItem(i.key, { quantity: Number(e.target.value) })} aria-label="Cantidad" />
                      <span className="text-xs text-muted-foreground">×</span>
                      <Input className="w-24 h-8 text-right" type="number" inputMode="numeric" min="0" value={i.unitPrice}
                        onChange={e => updateItem(i.key, { unitPrice: Number(e.target.value) })} aria-label="Precio" />
                      <span className="flex-1 sm:hidden" />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setItems(prev => prev.filter(x => x.key !== i.key))} aria-label="Quitar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {errors.items && <p className="text-sm text-destructive">{errors.items}</p>}

            <div className={cn("grid grid-cols-1 gap-3", !solo && "sm:grid-cols-2")}>
              {/* Con una sola persona que repara no hay nada que elegir: se asigna sola al iniciar. */}
              {!solo && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Mecánico</Label>
                  <Select value={mechanicId} onValueChange={setMechanicId}>
                    <SelectTrigger data-testid="select-mechanic"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Asignar después</SelectItem>
                      {mechanics.map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Deja con la bici</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ACCESSORIES.map(a => (
                    <button key={a} type="button" onClick={() => toggleAccessory(a)}
                      className={cn("rounded-full border px-2.5 py-1 text-xs", accessories.includes(a) ? "bg-foreground text-background" : "hover:bg-muted")}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button type="button" className="text-sm text-primary flex items-center gap-1" onClick={() => setShowMore(v => !v)} data-testid="button-more-details">
              {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}Más detalles (estado visual, nota interna, canal)
            </button>
            {showMore && (
              <div className="space-y-3">
                <Textarea rows={2} placeholder="Estado visual al recibir (rayones, golpes…)" value={visualCondition} onChange={e => setVisualCondition(e.target.value)} />
                <Textarea rows={2} placeholder="Nota interna (solo el taller)" value={internalNote} onChange={e => setInternalNote(e.target.value)} />
                <Input placeholder="Otros accesorios, separados por coma" value={otherAccessory} onChange={e => setOtherAccessory(e.target.value)} />
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1 self-center">Llegó por:</span>
                  {CHANNELS.map(c => (
                    <button key={c.value} type="button" onClick={() => setChannel(c.value)}
                      className={cn("rounded-full border px-2.5 py-1 text-xs", channel === c.value ? "bg-foreground text-background" : "hover:bg-muted")}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      {/* Barra inferior: total, término estimado y crear */}
      <div className="fixed left-0 right-0 bottom-16 md:bottom-0 md:left-64 z-40 border-t bg-background/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold leading-tight">{formatCLP(total)}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 truncate" data-testid="eta-preview">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {eta
                ? <>Lista aprox. el <strong className="text-foreground">{new Date(eta.date).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" })}</strong></>
                : items.length > 0 ? "Calculando término…" : "Agrega servicios para estimar el término"}
            </p>
          </div>
          <Button className="h-11 px-6" onClick={submit} disabled={quickCreate.isPending} data-testid="button-create-work">
            {quickCreate.isPending ? "Creando…" : "Crear trabajo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
