import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation, Link } from "wouter";
import {
  useQuickCreateWorkCase,
  useListClients,
  useListBicycles,
  useListUsers,
  useListServices,
  useListParts,
  getListWorkCasesQueryKey,
  type QuickCreateInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Check, ChevronsUpDown, Plus, Trash2, User, Bike, ClipboardList, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "presencial", label: "Presencial" },
  { value: "telefono", label: "Teléfono" },
  { value: "email", label: "Email" },
  { value: "instagram", label: "Instagram" },
  { value: "otro", label: "Otro" },
];

const BIKE_TYPES = [
  { value: "mtb", label: "MTB" },
  { value: "road", label: "Ruta" },
  { value: "gravel", label: "Gravel" },
  { value: "urban", label: "Urbana" },
  { value: "ebike", label: "E-Bike" },
  { value: "kids", label: "Niños" },
  { value: "other", label: "Otra" },
];

const ITEM_TYPES = [
  { value: "service", label: "Servicio" },
  { value: "part", label: "Repuesto" },
  { value: "additional_labor", label: "Mano de obra" },
  { value: "other", label: "Otro" },
];

const MAX_YEAR = new Date().getFullYear() + 1;

const schema = z.object({
  clientMode: z.enum(["existing", "new"]),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
  clientEmail: z.string().optional(),
  clientNotes: z.string().optional(),

  bicycleMode: z.enum(["existing", "new"]),
  bicycleId: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  year: z.string().optional(),
  bikeType: z.string().optional(),
  color: z.string().optional(),
  serialNumber: z.string().optional(),
  bicycleNotes: z.string().optional(),

  originChannel: z.string().min(1, "Selecciona el canal"),
  assignedMechanicId: z.string().optional(),
  customerComment: z.string().optional(),
  mechanicComment: z.string().optional(),
  initialVisualCondition: z.string().optional(),
  accessoriesReceived: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

type DraftItem = {
  itemType: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

const STEPS = [
  { n: 1, label: "Cliente", icon: User },
  { n: 2, label: "Bicicleta", icon: Bike },
  { n: 3, label: "Recepción", icon: ClipboardList },
  { n: 4, label: "Trabajo", icon: ListChecks },
];

function formatCLP(value: number): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

export default function TrabajoNuevo() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: clients } = useListClients();
  const { data: bicycles } = useListBicycles();
  const { data: users } = useListUsers();
  const { data: services } = useListServices({});
  const { data: parts } = useListParts({});
  const quickCreate = useQuickCreateWorkCase();

  const [step, setStep] = useState(1);
  const [clientOpen, setClientOpen] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [draft, setDraft] = useState<DraftItem>({ itemType: "service", description: "", quantity: "1", unitPrice: "0" });
  const [catalogId, setCatalogId] = useState("");
  const [itemError, setItemError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      clientMode: "existing",
      clientId: "",
      clientName: "",
      clientPhone: "",
      clientEmail: "",
      clientNotes: "",
      bicycleMode: "existing",
      bicycleId: "",
      brand: "",
      model: "",
      year: "",
      bikeType: "mtb",
      color: "",
      serialNumber: "",
      bicycleNotes: "",
      originChannel: "presencial",
      assignedMechanicId: "none",
      customerComment: "",
      mechanicComment: "",
      initialVisualCondition: "",
      accessoriesReceived: "",
    },
  });

  const activeClients = (clients ?? []).filter((c) => c.active);
  const mechanics = (users ?? []).filter((u: any) => u.role === "mechanic" && u.active !== false);

  const clientMode = form.watch("clientMode");
  const bicycleMode = form.watch("bicycleMode");
  const watchedClientId = form.watch("clientId");
  const clientBicycles = (bicycles ?? []).filter(
    (b) => b.clientId === parseInt(watchedClientId || "0") && b.active
  );

  const itemsTotal = items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0), 0);

  const setClientMode = (mode: "existing" | "new") => {
    form.setValue("clientMode", mode);
    form.clearErrors(["clientId", "clientName"]);
    if (mode === "new") {
      // A brand-new client cannot have existing bicycles.
      form.setValue("bicycleMode", "new");
      form.setValue("bicycleId", "");
    }
  };

  const setBicycleMode = (mode: "existing" | "new") => {
    form.setValue("bicycleMode", mode);
    form.clearErrors(["bicycleId", "brand", "model", "bikeType", "year"]);
  };

  const validateStep = (): boolean => {
    const v = form.getValues();
    if (step === 1) {
      if (v.clientMode === "existing") {
        if (!v.clientId) { form.setError("clientId", { message: "Selecciona un cliente" }); return false; }
      } else {
        if (!v.clientName?.trim()) { form.setError("clientName", { message: "El nombre es requerido" }); return false; }
      }
      return true;
    }
    if (step === 2) {
      if (v.bicycleMode === "existing") {
        if (!v.bicycleId) { form.setError("bicycleId", { message: "Selecciona una bicicleta" }); return false; }
      } else {
        let ok = true;
        if (!v.brand?.trim()) { form.setError("brand", { message: "La marca es requerida" }); ok = false; }
        if (!v.model?.trim()) { form.setError("model", { message: "El modelo es requerido" }); ok = false; }
        if (!v.bikeType?.trim()) { form.setError("bikeType", { message: "Selecciona el tipo" }); ok = false; }
        if (v.year?.trim()) {
          const y = parseInt(v.year);
          if (isNaN(y) || y < 1990 || y > MAX_YEAR) { form.setError("year", { message: `Año entre 1990 y ${MAX_YEAR}` }); ok = false; }
        }
        return ok;
      }
      return true;
    }
    if (step === 3) {
      if (!v.originChannel) { form.setError("originChannel", { message: "Selecciona el canal" }); return false; }
      return true;
    }
    return true;
  };

  const goNext = () => {
    if (validateStep()) setStep((s) => Math.min(4, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const addItem = () => {
    setItemError(null);
    if (!draft.description.trim()) { setItemError("Ingresa una descripción"); return; }
    const qty = parseFloat(draft.quantity);
    const price = parseFloat(draft.unitPrice);
    if (isNaN(qty) || qty <= 0) { setItemError("Cantidad inválida"); return; }
    if (isNaN(price) || price < 0) { setItemError("Precio inválido"); return; }
    setItems((prev) => [...prev, { ...draft, description: draft.description.trim() }]);
    setDraft({ itemType: "service", description: "", quantity: "1", unitPrice: "0" });
    setCatalogId("");
  };

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = () => {
    if (items.length === 0) {
      setItemError("Agrega al menos un ítem al trabajo");
      return;
    }
    const v = form.getValues();

    const client: QuickCreateInput["client"] =
      v.clientMode === "existing"
        ? {
            id: parseInt(v.clientId!),
            name: activeClients.find((c) => String(c.id) === v.clientId)?.name ?? "",
          }
        : {
            name: v.clientName!.trim(),
            phone: v.clientPhone?.trim() || null,
            email: v.clientEmail?.trim() || null,
            notes: v.clientNotes?.trim() || null,
          };

    const existingBike = clientBicycles.find((b) => String(b.id) === v.bicycleId);
    const bicycle: QuickCreateInput["bicycle"] =
      v.bicycleMode === "existing"
        ? (
            { id: parseInt(v.bicycleId!) } as QuickCreateInput["bicycle"]
          )
        : {
            brand: v.brand!.trim(),
            model: v.model!.trim(),
            year: v.year?.trim() ? parseInt(v.year) : null,
            type: v.bikeType as QuickCreateInput["bicycle"]["type"],
            color: v.color?.trim() || null,
            serialNumber: v.serialNumber?.trim() || null,
            notes: v.bicycleNotes?.trim() || null,
          };

    const accessories = (v.accessoriesReceived ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const data: QuickCreateInput = {
      client,
      bicycle,
      originChannel: v.originChannel,
      assignedMechanicId: v.assignedMechanicId && v.assignedMechanicId !== "none" ? parseInt(v.assignedMechanicId) : null,
      customerComment: v.customerComment?.trim() || null,
      mechanicComment: v.mechanicComment?.trim() || null,
      initialVisualCondition: v.initialVisualCondition?.trim() || null,
      accessoriesReceived: accessories.length > 0 ? accessories : null,
      items: items.map((it) => ({
        itemType: it.itemType,
        description: it.description,
        quantity: parseFloat(it.quantity),
        unitPrice: parseFloat(it.unitPrice),
      })),
    };

    quickCreate.mutate(
      { data },
      {
        onSuccess: (result) => {
          toast({ title: "Trabajo creado", description: `Se creó ${result.workCaseNumber} con la OT ${result.workOrderNumber}` });
          qc.invalidateQueries({ queryKey: getListWorkCasesQueryKey() });
          navigate(`/trabajos/${result.workCaseId}`);
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error al crear el trabajo", description: err?.message });
        },
      }
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/trabajos">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Nuevo Trabajo</h1>
          <p className="text-muted-foreground mt-1">Registra cliente, bicicleta y trabajo en un solo paso.</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const isDone = step > s.n;
          const isCurrent = step === s.n;
          return (
            <div key={s.n} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center border-2 text-sm font-bold",
                  isDone ? "border-green-500 bg-green-500 text-white" :
                  isCurrent ? "border-primary bg-primary text-primary-foreground" :
                  "border-gray-200 bg-white text-gray-400"
                )}>
                  {isDone ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </div>
                <span className={cn("text-[11px] mt-1 font-medium", isCurrent ? "text-primary" : isDone ? "text-green-600" : "text-muted-foreground")}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && <div className={cn("h-0.5 flex-1 mx-1", isDone ? "bg-green-400" : "bg-gray-200")} />}
            </div>
          );
        })}
      </div>

      <Form {...form}>
        <form onSubmit={(e) => e.preventDefault()}>
          {/* STEP 1: Cliente */}
          {step === 1 && (
            <Card>
              <CardHeader><CardTitle>Cliente</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={clientMode === "existing" ? "default" : "outline"} onClick={() => setClientMode("existing")} data-testid="button-client-existing">
                    Cliente existente
                  </Button>
                  <Button type="button" variant={clientMode === "new" ? "default" : "outline"} onClick={() => setClientMode("new")} data-testid="button-client-new">
                    Cliente nuevo
                  </Button>
                </div>

                {clientMode === "existing" ? (
                  <FormField
                    control={form.control}
                    name="clientId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cliente *</FormLabel>
                        <FormControl>
                          <Popover open={clientOpen} onOpenChange={setClientOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" role="combobox" aria-expanded={clientOpen} className="w-full justify-between font-normal" data-testid="select-client">
                                {field.value ? activeClients.find((c) => String(c.id) === field.value)?.name ?? "Selecciona un cliente" : "Selecciona un cliente"}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Buscar cliente..." />
                                <CommandList>
                                  <CommandEmpty>No se encontró ningún cliente.</CommandEmpty>
                                  <CommandGroup>
                                    {activeClients.map((c) => (
                                      <CommandItem key={c.id} value={c.name} onSelect={() => {
                                        field.onChange(String(c.id));
                                        form.setValue("bicycleId", "");
                                        form.clearErrors("clientId");
                                        setClientOpen(false);
                                      }}>
                                        <Check className={cn("mr-2 h-4 w-4", field.value === String(c.id) ? "opacity-100" : "opacity-0")} />
                                        {c.name}
                                        {c.phone && <span className="ml-2 text-xs text-muted-foreground">{c.phone}</span>}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <div className="space-y-4">
                    <FormField control={form.control} name="clientName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre *</FormLabel>
                        <FormControl><Input placeholder="Nombre del cliente" {...field} data-testid="input-client-name" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="clientPhone" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Teléfono</FormLabel>
                          <FormControl><Input placeholder="+56 9..." {...field} data-testid="input-client-phone" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="clientEmail" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl><Input placeholder="correo@ejemplo.com" {...field} data-testid="input-client-email" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="clientNotes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notas</FormLabel>
                        <FormControl><Textarea rows={2} placeholder="Notas del cliente..." {...field} data-testid="textarea-client-notes" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* STEP 2: Bicicleta */}
          {step === 2 && (
            <Card>
              <CardHeader><CardTitle>Bicicleta</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={bicycleMode === "existing" ? "default" : "outline"} onClick={() => setBicycleMode("existing")} disabled={clientMode === "new"} data-testid="button-bike-existing">
                    Bici existente
                  </Button>
                  <Button type="button" variant={bicycleMode === "new" ? "default" : "outline"} onClick={() => setBicycleMode("new")} data-testid="button-bike-new">
                    Bici nueva
                  </Button>
                </div>

                {bicycleMode === "existing" ? (
                  <FormField control={form.control} name="bicycleId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bicicleta *</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={(val) => { field.onChange(val); form.clearErrors("bicycleId"); }}>
                          <SelectTrigger data-testid="select-bicycle">
                            <SelectValue placeholder={clientBicycles.length ? "Selecciona una bicicleta" : "Este cliente no tiene bicicletas"} />
                          </SelectTrigger>
                          <SelectContent>
                            {clientBicycles.map((b) => (
                              <SelectItem key={b.id} value={String(b.id)}>
                                {b.brand} {b.model}{b.color ? ` — ${b.color}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="brand" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Marca *</FormLabel>
                          <FormControl><Input placeholder="Trek, Specialized..." {...field} data-testid="input-bike-brand" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="model" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Modelo *</FormLabel>
                          <FormControl><Input placeholder="Marlin 5..." {...field} data-testid="input-bike-model" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="bikeType" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo *</FormLabel>
                          <FormControl>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger data-testid="select-bike-type"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {BIKE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="year" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Año</FormLabel>
                          <FormControl><Input type="number" inputMode="numeric" placeholder="2024" {...field} data-testid="input-bike-year" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="color" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Color</FormLabel>
                          <FormControl><Input placeholder="Negro..." {...field} data-testid="input-bike-color" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="serialNumber" render={({ field }) => (
                        <FormItem>
                          <FormLabel>N° de serie</FormLabel>
                          <FormControl><Input placeholder="Opcional" {...field} data-testid="input-bike-serial" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="bicycleNotes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notas de la bicicleta</FormLabel>
                        <FormControl><Textarea rows={2} placeholder="Notas..." {...field} data-testid="textarea-bike-notes" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* STEP 3: Recepción */}
          {step === 3 && (
            <Card>
              <CardHeader><CardTitle>Recepción</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="originChannel" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Canal de origen *</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger data-testid="select-channel"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="assignedMechanicId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mecánico asignado</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger data-testid="select-mechanic"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin asignar</SelectItem>
                            {mechanics.map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="customerComment" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comentario del cliente</FormLabel>
                    <FormControl><Textarea rows={2} placeholder="¿Qué reportó el cliente? Problema o requerimiento..." {...field} data-testid="textarea-customer-comment" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="initialVisualCondition" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condición visual inicial</FormLabel>
                    <FormControl><Textarea rows={2} placeholder="Estado visual al ingresar..." {...field} data-testid="textarea-visual-condition" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="accessoriesReceived" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Accesorios recibidos</FormLabel>
                    <FormControl><Input placeholder="Separados por coma: luz, candado, portabultos" {...field} data-testid="input-accessories" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="mechanicComment" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comentario del mecánico (interno)</FormLabel>
                    <FormControl><Textarea rows={2} placeholder="Notas internas del taller..." {...field} data-testid="textarea-mechanic-comment" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>
          )}

          {/* STEP 4: Trabajo / ítems */}
          {step === 4 && (
            <Card>
              <CardHeader><CardTitle>Trabajo a realizar</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  Agrega los servicios y repuestos. Se crea un presupuesto aprobado y la orden de trabajo con estos ítems.
                </p>

                {/* Existing items */}
                {items.length > 0 && (
                  <div className="space-y-2">
                    {items.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 rounded-md border bg-muted/40" data-testid={`item-row-${idx}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{it.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {ITEM_TYPES.find((t) => t.value === it.itemType)?.label} · {it.quantity} × {formatCLP(parseFloat(it.unitPrice) || 0)}
                          </p>
                        </div>
                        <span className="text-sm font-medium">{formatCLP((parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0))}</span>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(idx)} data-testid={`button-remove-item-${idx}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-1 font-semibold">
                      <span>Total</span>
                      <span>{formatCLP(itemsTotal)}</span>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Add item */}
                <div className="space-y-3">
                  <p className="text-sm font-medium">Agregar ítem</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <Select value={draft.itemType} onValueChange={(val) => { setDraft((d) => ({ ...d, itemType: val })); setCatalogId(""); }}>
                        <SelectTrigger data-testid="select-item-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ITEM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input className="col-span-2" placeholder="Descripción" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} data-testid="input-item-description" />
                  </div>

                  {/* Catalog picker for services */}
                  {draft.itemType === "service" && (services ?? []).length > 0 && (
                    <div>
                      <label className="text-xs text-muted-foreground">Elegir del catálogo (opcional)</label>
                      <Select value={catalogId} onValueChange={(v) => {
                        setCatalogId(v);
                        const svc = (services ?? []).find((s: any) => String(s.id) === v);
                        if (svc) {
                          setDraft((d) => ({
                            ...d,
                            description: (svc as any).name,
                            unitPrice: String((svc as any).basePrice ?? 0),
                          }));
                        }
                      }}>
                        <SelectTrigger data-testid="select-catalog-service"><SelectValue placeholder="Elegir servicio del catálogo..." /></SelectTrigger>
                        <SelectContent>
                          {(services ?? []).map((s: any) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name}{s.basePrice ? ` — ${formatCLP(s.basePrice)}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Catalog picker for parts */}
                  {draft.itemType === "part" && (parts ?? []).length > 0 && (
                    <div>
                      <label className="text-xs text-muted-foreground">Elegir del catálogo (opcional)</label>
                      <Select value={catalogId} onValueChange={(v) => {
                        setCatalogId(v);
                        const part = (parts ?? []).find((p: any) => String(p.id) === v);
                        if (part) {
                          setDraft((d) => ({
                            ...d,
                            description: (part as any).name,
                            unitPrice: String((part as any).suggestedPrice ?? 0),
                          }));
                        }
                      }}>
                        <SelectTrigger data-testid="select-catalog-part"><SelectValue placeholder="Elegir repuesto del catálogo..." /></SelectTrigger>
                        <SelectContent>
                          {(parts ?? []).map((p: any) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.name}{p.suggestedPrice ? ` — ${formatCLP(p.suggestedPrice)}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Cantidad</label>
                      <Input type="number" inputMode="decimal" min="0" value={draft.quantity} onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))} data-testid="input-item-quantity" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Precio unit.</label>
                      <Input type="number" inputMode="numeric" min="0" value={draft.unitPrice} onChange={(e) => setDraft((d) => ({ ...d, unitPrice: e.target.value }))} data-testid="input-item-price" />
                    </div>
                    <div className="flex items-end">
                      <Button type="button" variant="outline" className="w-full flex items-center gap-1" onClick={addItem} data-testid="button-add-item">
                        <Plus className="h-4 w-4" /> Agregar
                      </Button>
                    </div>
                  </div>
                  {itemError && <p className="text-sm text-destructive">{itemError}</p>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-5">
            {step > 1 ? (
              <Button type="button" variant="outline" className="flex-1" onClick={goBack} data-testid="button-back">
                Atrás
              </Button>
            ) : (
              <Link href="/trabajos" className="flex-1">
                <Button type="button" variant="outline" className="w-full">Cancelar</Button>
              </Link>
            )}
            {step < 4 ? (
              <Button type="button" className="flex-1 flex items-center gap-2" onClick={goNext} data-testid="button-next">
                Siguiente <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" className="flex-1 flex items-center gap-2" onClick={handleSubmit} disabled={quickCreate.isPending} data-testid="button-create-work">
                <Check className="h-4 w-4" />
                {quickCreate.isPending ? "Creando..." : "Crear Trabajo"}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
