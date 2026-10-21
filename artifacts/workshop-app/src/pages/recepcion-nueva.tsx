import { useState, useEffect } from "react";
import { useLocation, useSearch, Link } from "wouter";
import {
  useCreateReception,
  useListClients,
  useListBicycles,
  useListQuotes,
} from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus } from "lucide-react";

const PREDEFINED_ACCESSORIES = [
  "Candado",
  "Pedales",
  "Bolso de sillín",
  "Porta caramayola",
  "Casco",
  "Bomba de mano",
  "Ruedas adicionales",
  "Luz delantera / trasera",
];

const schema = z.object({
  clientId: z.string().min(1, "Selecciona un cliente"),
  bicycleId: z.string().min(1, "Selecciona una bicicleta"),
  quoteId: z.string().optional(),
  receivedAt: z.string().optional(),
  customerReportedProblem: z.string().optional(),
  initialVisualCondition: z.string().optional(),
  accessoriesOther: z.string().optional(),
  internalNotes: z.string().optional(),
  customerNotes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function RecepcionNueva() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const prefillQuoteId = params.get("quoteId") ?? "";
  const { toast } = useToast();
  const createReception = useCreateReception();

  const { data: clients } = useListClients({});
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const { data: bicycles } = useListBicycles({ clientId: selectedClientId ?? undefined });
  const { data: quotes } = useListQuotes({ clientId: selectedClientId ?? undefined });
  const [checkedAccessories, setCheckedAccessories] = useState<string[]>([]);

  const nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      clientId: "",
      bicycleId: "",
      quoteId: "none",
      receivedAt: nowLocal(),
      customerReportedProblem: "",
      initialVisualCondition: "",
      accessoriesOther: "",
      internalNotes: "",
      customerNotes: "",
    },
  });

  const watchedClientId = form.watch("clientId");
  useEffect(() => {
    const cid = parseInt(watchedClientId);
    if (!isNaN(cid) && cid > 0) {
      setSelectedClientId(cid);
      form.setValue("bicycleId", "");
      form.setValue("quoteId", "none");
    } else {
      setSelectedClientId(null);
    }
  }, [watchedClientId]);

  // Prefill quoteId from URL: find client from quote
  const { data: allQuotes } = useListQuotes({});
  useEffect(() => {
    if (!prefillQuoteId || !allQuotes) return;
    const q = allQuotes.find((q: any) => String(q.id) === prefillQuoteId);
    if (q && q.clientId) {
      setSelectedClientId(q.clientId);
      form.setValue("clientId", String(q.clientId));
      setTimeout(() => form.setValue("quoteId", prefillQuoteId), 100);
    }
  }, [prefillQuoteId, allQuotes]);

  const toggleAccessory = (name: string) => {
    setCheckedAccessories(prev =>
      prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name]
    );
  };

  const onSubmit = (values: FormValues) => {
    const otherAccs = values.accessoriesOther
      ? values.accessoriesOther.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    const accessories = [...checkedAccessories, ...otherAccs];

    const quoteIdVal = values.quoteId && values.quoteId !== "none" ? parseInt(values.quoteId) : null;
    const receivedAtVal = values.receivedAt ? new Date(values.receivedAt).toISOString() : undefined;

    createReception.mutate({
      data: {
        clientId: parseInt(values.clientId),
        bicycleId: parseInt(values.bicycleId),
        quoteId: quoteIdVal,
        ...(receivedAtVal ? { receivedAt: receivedAtVal } : {}),
        customerReportedProblem: values.customerReportedProblem || null,
        initialVisualCondition: values.initialVisualCondition || null,
        accessoriesReceived: accessories.length > 0 ? accessories : null,
        internalNotes: values.internalNotes || null,
        customerNotes: values.customerNotes || null,
      },
    }, {
      onSuccess: (data: any) => {
        toast({ title: "Recepción creada", description: `Número ${data.receptionNumber}` });
        navigate(`/recepciones/${data.id}`);
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Error al crear recepción", description: err?.response?.data?.error ?? "Intenta nuevamente." });
      },
    });
  };

  const activeClients = (clients ?? []).filter((c: any) => c.active !== false);
  const clientBikes = (bicycles ?? []).filter((b: any) => b.active !== false);
  const clientQuotes = (quotes ?? []).filter((q: any) => q.active !== false);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/recepciones">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nueva Recepción</h1>
          <p className="text-muted-foreground text-sm">Registrar una bicicleta que ingresa al taller.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Bicicleta a recepcionar</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar cliente..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeClients.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bicycleId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Bicicleta *</FormLabel>
                      {selectedClientId && (
                        <Link href={`/bicicletas/nueva?clientId=${selectedClientId}`}>
                          <Button type="button" variant="ghost" size="sm" className="h-auto py-0.5 px-2 text-xs text-primary flex items-center gap-1">
                            <Plus className="h-3 w-3" /> Crear bicicleta
                          </Button>
                        </Link>
                      )}
                    </div>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!selectedClientId}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={!selectedClientId ? "Primero selecciona un cliente" : clientBikes.length === 0 ? "El cliente no tiene bicicletas" : "Seleccionar bicicleta..."} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clientBikes.map((b: any) => (
                          <SelectItem key={b.id} value={String(b.id)}>{b.brand} {b.model}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="quoteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Presupuesto asociado <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!selectedClientId}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={!selectedClientId ? "Primero selecciona un cliente" : "Sin presupuesto asociado"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Sin presupuesto</SelectItem>
                        {clientQuotes.map((q: any) => (
                          <SelectItem key={q.id} value={String(q.id)}>{q.quoteNumber} — {q.status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Información del cliente</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="customerReportedProblem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Problema reportado por el cliente</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Describe el problema o motivo de ingreso..." rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="customerNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas del cliente</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Indicaciones especiales, preferencias de contacto..." rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Recepción física</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="receivedAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha y hora de ingreso</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="initialVisualCondition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condición visual al ingresar</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Estado general de la bicicleta: limpieza, daños visibles, desgastes..." rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <p className="text-sm font-medium leading-none">Accesorios recibidos</p>
                <div className="grid grid-cols-2 gap-2">
                  {PREDEFINED_ACCESSORIES.map((acc) => (
                    <label key={acc} className="flex items-center gap-2 cursor-pointer text-sm p-2 rounded-md border hover:bg-muted/50 transition-colors">
                      <Checkbox
                        checked={checkedAccessories.includes(acc)}
                        onCheckedChange={() => toggleAccessory(acc)}
                      />
                      {acc}
                    </label>
                  ))}
                </div>
                <FormField
                  control={form.control}
                  name="accessoriesOther"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs">Otros accesorios (separados por coma)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Sillines de repuesto, herramientas..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="internalNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas internas</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Notas solo para el equipo del taller..." rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button type="submit" disabled={createReception.isPending} className="flex-1">
              {createReception.isPending ? "Registrando..." : "Registrar recepción"}
            </Button>
            <Link href="/recepciones">
              <Button type="button" variant="outline">Cancelar</Button>
            </Link>
          </div>
        </form>
      </Form>
    </div>
  );
}
