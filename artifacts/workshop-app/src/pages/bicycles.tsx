import { Link } from "wouter";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListBicycles, useCreateBicycle, useUpdateBicycle,
  useListClients, getListBicyclesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bike, Plus, Pencil, Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const BIKE_TYPES = ["mtb", "road", "gravel", "urban", "ebike", "kids", "other"] as const;
const BIKE_TYPE_LABELS: Record<string, string> = { mtb: "MTB", road: "Ruta", gravel: "Gravel", urban: "Urbana", ebike: "E-Bike", kids: "Infantil", other: "Otro" };

const bikeSchema = z.object({
  clientId: z.coerce.number().int().positive("El cliente es requerido"),
  brand: z.string().min(1, "La marca es requerida"),
  model: z.string().min(1, "El modelo es requerido"),
  type: z.enum(BIKE_TYPES),
  color: z.string().optional().nullable(),
  rimSize: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
type BikeForm = z.infer<typeof bikeSchema>;
type BikeRow = { id: number; clientId: number; clientName?: string | null; brand: string; model: string; type: string; color?: string | null; rimSize?: string | null; serialNumber?: string | null; notes?: string | null; active: boolean };

export default function Bicycles() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: bicycles, isLoading } = useListBicycles();
  const { data: clients } = useListClients();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BikeRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<BikeRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const createMutation = useCreateBicycle();
  const updateMutation = useUpdateBicycle();

  const form = useForm<BikeForm>({
    resolver: zodResolver(bikeSchema),
    defaultValues: { clientId: 0, brand: "", model: "", type: "mtb", color: "", rimSize: "", serialNumber: "", notes: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListBicyclesQueryKey() });

  const openCreate = () => {
    setEditing(null);
    form.reset({ clientId: 0, brand: "", model: "", type: "mtb", color: "", rimSize: "", serialNumber: "", notes: "" });
    setDialogOpen(true);
  };

  const openEdit = (b: BikeRow) => {
    setEditing(b);
    form.reset({ clientId: b.clientId, brand: b.brand, model: b.model, type: b.type as (typeof BIKE_TYPES)[number], color: b.color ?? "", rimSize: b.rimSize ?? "", serialNumber: b.serialNumber ?? "", notes: b.notes ?? "" });
    setDialogOpen(true);
  };

  const onSubmit = (values: BikeForm) => {
    const data = { ...values, color: values.color || null, rimSize: values.rimSize || null, serialNumber: values.serialNumber || null, notes: values.notes || null };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Bicicleta actualizada" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => { toast({ title: "Bicicleta registrada" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al crear" }),
      });
    }
  };

  const handleToggleActive = (b: BikeRow) => {
    if (b.active) setDeactivateTarget(b);
    else updateMutation.mutate({ id: b.id, data: { active: true } }, {
      onSuccess: () => { toast({ title: "Bicicleta reactivada" }); invalidate(); },
    });
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    updateMutation.mutate({ id: deactivateTarget.id, data: { active: false } }, {
      onSuccess: () => { toast({ title: "Bicicleta desactivada" }); setDeactivateTarget(null); invalidate(); },
    });
  };

  const visible = bicycles?.filter(b => showInactive ? true : b.active) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Bicicletas</h1>
          <p className="text-muted-foreground mt-1">Catálogo de todas las bicicletas registradas.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "Ocultar inactivas" : "Ver inactivas"}
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2" data-testid="button-create-bicycle">
            <Plus className="h-4 w-4" /> Registrar Bicicleta
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marca / Modelo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Color / Rodado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((b) => (
                  <TableRow key={b.id} data-testid={`row-bicycle-${b.id}`} className={!b.active ? "opacity-60" : ""}>
                    <TableCell>
                      <Link href={`/bicicletas/${b.id}`} className="block hover:underline" data-testid={`link-bicycle-${b.id}`}>
                        <div className="font-medium">{b.brand}</div>
                        <div className="text-sm text-muted-foreground">{b.model}</div>
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant="outline">{BIKE_TYPE_LABELS[b.type] ?? b.type}</Badge></TableCell>
                    <TableCell className="text-sm">{b.clientName || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[b.color, b.rimSize].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell>
                      {b.active ? <Badge className="bg-green-500/10 text-green-700">Activa</Badge> : <Badge variant="destructive">Inactiva</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(b)} data-testid={`button-edit-bicycle-${b.id}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleToggleActive(b)}>
                          {b.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No hay bicicletas.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {visible.map((b) => (
              <Card key={b.id} data-testid={`card-bicycle-${b.id}`} className={!b.active ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{b.brand}</CardTitle>
                      <p className="text-sm text-muted-foreground">{b.model}</p>
                    </div>
                    <Badge variant="outline">{BIKE_TYPE_LABELS[b.type] ?? b.type}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm"><span className="font-medium">Cliente:</span> {b.clientName || "—"}</div>
                  <div className="text-sm text-muted-foreground">{[b.color, b.rimSize].filter(Boolean).join(" · ") || ""}</div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    {!b.active && <Badge variant="destructive">Inactiva</Badge>}
                    <div className="flex gap-1 ml-auto">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(b)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleToggleActive(b)}>
                        {b.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {visible.length === 0 && <div className="text-center py-10 text-muted-foreground bg-card rounded-lg border">No hay bicicletas.</div>}
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar Bicicleta" : "Registrar Bicicleta"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="clientId" render={({ field }) => (
                <FormItem><FormLabel>Cliente *</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                    <FormControl><SelectTrigger data-testid="select-bicycle-client"><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {clients?.filter(c => c.active).map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="brand" render={({ field }) => (
                  <FormItem><FormLabel>Marca *</FormLabel><FormControl><Input {...field} data-testid="input-bicycle-brand" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="model" render={({ field }) => (
                  <FormItem><FormLabel>Modelo *</FormLabel><FormControl><Input {...field} data-testid="input-bicycle-model" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>Tipo *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-bicycle-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {BIKE_TYPES.map(t => <SelectItem key={t} value={t}>{BIKE_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="color" render={({ field }) => (
                  <FormItem><FormLabel>Color</FormLabel><FormControl><Input {...field} value={field.value ?? ""} data-testid="input-bicycle-color" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="rimSize" render={({ field }) => (
                  <FormItem><FormLabel>Rodado</FormLabel><FormControl><Input placeholder='29", 700c...' {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="serialNumber" render={({ field }) => (
                <FormItem><FormLabel>Número de serie</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notas</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-bicycle">
                  {editing ? "Guardar cambios" : "Registrar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar bicicleta?</AlertDialogTitle>
            <AlertDialogDescription>Se desactivará <strong>{deactivateTarget?.brand} {deactivateTarget?.model}</strong>.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Desactivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
