import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation } from "wouter";
import {
  useCreateQuote,
  useListClients,
  useListBicycles,
  getListQuotesQueryKey,
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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Check, ChevronsUpDown } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const schema = z.object({
  clientId: z.string().min(1, "Selecciona un cliente"),
  bicycleId: z.string().optional(),
  originChannel: z.string().min(1, "Selecciona el canal"),
  initialRequirement: z.string().optional(),
  customerNotes: z.string().optional(),
  internalNotes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "presencial", label: "Presencial" },
  { value: "telefono", label: "Teléfono" },
  { value: "email", label: "Email" },
  { value: "instagram", label: "Instagram" },
  { value: "otro", label: "Otro" },
];

export default function PresupuestoNuevo() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: clients } = useListClients();
  const { data: bicycles } = useListBicycles();
  const createMutation = useCreateQuote();
  const [clientOpen, setClientOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      clientId: "",
      bicycleId: "",
      originChannel: "whatsapp",
      initialRequirement: "",
      customerNotes: "",
      internalNotes: "",
    },
  });

  const watchedClientId = form.watch("clientId");
  const clientBicycles = (bicycles ?? []).filter(
    (b) => b.clientId === parseInt(watchedClientId || "0") && b.active
  );

  const onSubmit = (values: FormValues) => {
    createMutation.mutate({
      data: {
        clientId: parseInt(values.clientId),
        bicycleId: values.bicycleId && values.bicycleId !== "none" ? parseInt(values.bicycleId) : null,
        originChannel: values.originChannel,
        initialRequirement: values.initialRequirement || null,
        customerNotes: values.customerNotes || null,
        internalNotes: values.internalNotes || null,
      },
    }, {
      onSuccess: (data) => {
        toast({ title: "Presupuesto creado", description: `Se creó el presupuesto ${data.quoteNumber}` });
        qc.invalidateQueries({ queryKey: getListQuotesQueryKey() });
        navigate(`/presupuestos/${data.id}`);
      },
      onError: () => toast({ variant: "destructive", title: "Error al crear el presupuesto" }),
    });
  };

  const activeClients = (clients ?? []).filter(c => c.active);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/presupuestos">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Nuevo Presupuesto</h1>
          <p className="text-muted-foreground mt-1">Crea un presupuesto de reparación para un cliente.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del presupuesto</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente *</FormLabel>
                    <FormControl>
                      <Popover open={clientOpen} onOpenChange={setClientOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={clientOpen}
                            className="w-full justify-between font-normal"
                            data-testid="select-client"
                          >
                            {field.value
                              ? activeClients.find(c => String(c.id) === field.value)?.name ?? "Selecciona un cliente"
                              : "Selecciona un cliente"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Buscar cliente..." />
                            <CommandList>
                              <CommandEmpty>No se encontró ningún cliente.</CommandEmpty>
                              <CommandGroup>
                                {activeClients.map(c => (
                                  <CommandItem
                                    key={c.id}
                                    value={c.name}
                                    onSelect={() => {
                                      field.onChange(String(c.id));
                                      form.setValue("bicycleId", "");
                                      setClientOpen(false);
                                    }}
                                  >
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

              <FormField
                control={form.control}
                name="bicycleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bicicleta</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!watchedClientId}
                      >
                        <SelectTrigger data-testid="select-bicycle">
                          <SelectValue placeholder={watchedClientId ? "Sin bicicleta (opcional)" : "Primero selecciona un cliente"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin bicicleta</SelectItem>
                          {clientBicycles.map(b => (
                            <SelectItem key={b.id} value={String(b.id)}>
                              {b.brand} {b.model} {b.color ? `— ${b.color}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="originChannel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Canal de origen *</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger data-testid="select-channel">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHANNELS.map(c => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="initialRequirement"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Requerimiento inicial</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="¿Qué necesita el cliente? Descripción del problema o trabajo solicitado..."
                        rows={3}
                        {...field}
                        data-testid="textarea-requirement"
                      />
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
                    <FormLabel>Notas para el cliente</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Notas visibles para el cliente..."
                        rows={2}
                        {...field}
                        data-testid="textarea-customer-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="internalNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas internas</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Notas internas del taller (no visibles para el cliente)..."
                        rows={2}
                        {...field}
                        data-testid="textarea-internal-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-2">
                <Link href="/presupuestos" className="flex-1">
                  <Button type="button" variant="outline" className="w-full">Cancelar</Button>
                </Link>
                <Button
                  type="submit"
                  className="flex-1 flex items-center gap-2"
                  disabled={createMutation.isPending}
                  data-testid="button-create-quote"
                >
                  <Save className="h-4 w-4" />
                  {createMutation.isPending ? "Creando..." : "Crear Presupuesto"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
