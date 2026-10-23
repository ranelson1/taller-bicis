import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListServices, useCreateService, useUpdateService,
  useListCategories, getListServicesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, ListChecks, DollarSign, Clock, Pencil, Ban, RotateCcw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link, useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  categoryId: z.coerce.number().int().optional().nullable(),
  basePrice: z.coerce.number().min(0).optional().nullable(),
  estimatedHours: z.coerce.number().min(0).optional().nullable(),
  clientDescription: z.string().optional().nullable(),
  internalDescription: z.string().optional().nullable(),
  followupMonths: z.coerce.number().int().min(0).max(60).optional().nullable(),
});
type SvcForm = z.infer<typeof schema>;
type SvcRow = { id: number; name: string; categoryId?: number | null; categoryName?: string | null; basePrice?: number | string | null; estimatedHours?: number | string | null; clientDescription?: string | null; internalDescription?: string | null; followupMonths?: number | null; active: boolean; stepCount: number };

export default function Services() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: services, isLoading } = useListServices();
  const { data: categories } = useListCategories();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SvcRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<SvcRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const createMutation = useCreateService();
  const updateMutation = useUpdateService();

  const form = useForm<SvcForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", categoryId: null, basePrice: null, estimatedHours: null, clientDescription: "", internalDescription: "", followupMonths: null },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListServicesQueryKey() });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", categoryId: null, basePrice: null, estimatedHours: null, clientDescription: "", internalDescription: "", followupMonths: null });
    setDialogOpen(true);
  };

  const openEdit = (s: SvcRow) => {
    setEditing(s);
    form.reset({
      name: s.name,
      categoryId: s.categoryId ?? null,
      basePrice: s.basePrice != null ? Number(s.basePrice) : null,
      estimatedHours: s.estimatedHours != null ? Number(s.estimatedHours) : null,
      clientDescription: s.clientDescription ?? "",
      internalDescription: s.internalDescription ?? "",
      followupMonths: s.followupMonths ?? null,
    });
    setDialogOpen(true);
  };

  const onSubmit = (values: SvcForm) => {
    const data = {
      name: values.name,
      categoryId: values.categoryId || null,
      basePrice: values.basePrice ?? null,
      estimatedHours: values.estimatedHours ?? null,
      clientDescription: values.clientDescription || null,
      internalDescription: values.internalDescription || null,
      followupMonths: values.followupMonths ?? null,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Servicio actualizado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: (created) => {
          toast({ title: "Servicio creado", description: "Ahora puedes agregar pasos al checklist." });
          setDialogOpen(false);
          invalidate();
          navigate(`/admin/servicios/${created.id}`);
        },
        onError: () => toast({ variant: "destructive", title: "Error al crear" }),
      });
    }
  };

  const handleToggleActive = (s: SvcRow) => {
    if (s.active) setDeactivateTarget(s);
    else updateMutation.mutate({ id: s.id, data: { active: true } }, {
      onSuccess: () => { toast({ title: "Servicio reactivado" }); invalidate(); },
    });
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    updateMutation.mutate({ id: deactivateTarget.id, data: { active: false } }, {
      onSuccess: () => { toast({ title: "Servicio desactivado" }); setDeactivateTarget(null); invalidate(); },
    });
  };

  const visible = services?.filter(s => showInactive ? true : s.active) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Servicios</h1>
          <p className="text-muted-foreground mt-1">Catálogo de servicios y tareas de reparación.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "Ocultar inactivos" : "Ver inactivos"}
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2" data-testid="button-create-service">
            <Plus className="h-4 w-4" /> Nuevo Servicio
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
                  <TableHead>Nombre</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Precio Base</TableHead>
                  <TableHead>Tiempo Est.</TableHead>
                  <TableHead>Pasos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((s) => (
                  <TableRow key={s.id} data-testid={`row-service-${s.id}`} className={!s.active ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      <Link href={`/admin/servicios/${s.id}`} className="hover:underline text-primary flex items-center gap-1">
                        {s.name} <ExternalLink className="h-3 w-3 opacity-50" />
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.categoryName || "—"}</TableCell>
                    <TableCell>
                      {s.basePrice != null ? (
                        <span className="flex items-center gap-1 text-sm"><DollarSign className="h-3 w-3 text-muted-foreground" />{Number(s.basePrice).toLocaleString("es-CL")}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {s.estimatedHours != null ? (
                        <span className="flex items-center gap-1 text-sm"><Clock className="h-3 w-3 text-muted-foreground" />{s.estimatedHours}h</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="flex w-fit items-center gap-1">
                        <ListChecks className="h-3 w-3" />{s.stepCount}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.active ? <Badge className="bg-green-500/10 text-green-700">Activo</Badge> : <Badge variant="destructive">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/admin/servicios/${s.id}`}>
                          <Button size="icon" variant="ghost" title="Gestionar checklist" data-testid={`button-checklist-${s.id}`}>
                            <ListChecks className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(s)} data-testid={`button-edit-service-${s.id}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleToggleActive(s)}>
                          {s.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No hay servicios.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {visible.map((s) => (
              <Card key={s.id} data-testid={`card-service-${s.id}`} className={!s.active ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">
                      <Link href={`/admin/servicios/${s.id}`} className="hover:underline text-primary">{s.name}</Link>
                    </CardTitle>
                    {!s.active && <Badge variant="destructive">Inactivo</Badge>}
                  </div>
                  {s.categoryName && <p className="text-sm text-muted-foreground">{s.categoryName}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-4 text-sm">
                    {s.basePrice != null && <span className="flex items-center gap-1"><DollarSign className="h-4 w-4 text-muted-foreground" />{Number(s.basePrice).toLocaleString("es-CL")}</span>}
                    {s.estimatedHours != null && <span className="flex items-center gap-1"><Clock className="h-4 w-4 text-muted-foreground" />{s.estimatedHours}h</span>}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <Link href={`/admin/servicios/${s.id}`}>
                      <Button variant="outline" size="sm" className="flex items-center gap-1.5" data-testid={`button-checklist-mobile-${s.id}`}>
                        <ListChecks className="h-4 w-4" />
                        Checklist
                        {s.stepCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{s.stepCount}</Badge>}
                      </Button>
                    </Link>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleToggleActive(s)}>
                        {s.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar Servicio" : "Nuevo Servicio"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Nombre *</FormLabel><FormControl><Input {...field} data-testid="input-service-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="categoryId" render={({ field }) => (
                <FormItem><FormLabel>Categoría</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))} value={field.value != null ? String(field.value) : "none"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">Sin categoría</SelectItem>
                      {categories?.filter(c => c.active).map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="basePrice" render={({ field }) => (
                  <FormItem><FormLabel>Precio base (CLP)</FormLabel><FormControl><Input type="number" min={0} {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? null : Number(e.target.value))} data-testid="input-service-price" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="estimatedHours" render={({ field }) => (
                  <FormItem><FormLabel>Horas estimadas</FormLabel><FormControl><Input type="number" min={0} step={0.5} {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? null : Number(e.target.value))} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="followupMonths" render={({ field }) => (
                <FormItem>
                  <FormLabel>Recordar al cliente cada (meses)</FormLabel>
                  <FormControl><Input type="number" min={0} max={60} placeholder="Automático" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? null : Number(e.target.value))} data-testid="input-service-followup" /></FormControl>
                  <p className="text-xs text-muted-foreground">Cuándo te sugerimos escribirle para repetir este servicio. Vacío = automático según el nombre; 0 = nunca.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="clientDescription" render={({ field }) => (
                <FormItem><FormLabel>Descripción para el cliente</FormLabel><FormControl><Textarea rows={2} {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="internalDescription" render={({ field }) => (
                <FormItem><FormLabel>Notas internas</FormLabel><FormControl><Textarea rows={2} {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-service">
                  {editing ? "Guardar cambios" : "Crear servicio"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar servicio?</AlertDialogTitle>
            <AlertDialogDescription>Se desactivará <strong>{deactivateTarget?.name}</strong>.</AlertDialogDescription>
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
