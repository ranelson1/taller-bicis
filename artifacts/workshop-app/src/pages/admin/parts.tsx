import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListParts, useCreatePart, useUpdatePart,
  useListCategories, getListPartsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, DollarSign, Pencil, Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  categoryId: z.coerce.number().int().optional().nullable(),
  brand: z.string().optional().nullable(),
  suggestedPrice: z.coerce.number().min(0).optional().nullable(),
  sku: z.string().optional().nullable(),
});
type PartForm = z.infer<typeof schema>;
type PartRow = { id: number; name: string; categoryId?: number | null; categoryName?: string | null; brand?: string | null; suggestedPrice?: number | string | null; sku?: string | null; active: boolean };

export default function Parts() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: parts, isLoading } = useListParts();
  const { data: categories } = useListCategories();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PartRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PartRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const createMutation = useCreatePart();
  const updateMutation = useUpdatePart();

  const form = useForm<PartForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", categoryId: null, brand: "", suggestedPrice: null, sku: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPartsQueryKey() });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", categoryId: null, brand: "", suggestedPrice: null, sku: "" });
    setDialogOpen(true);
  };

  const openEdit = (p: PartRow) => {
    setEditing(p);
    form.reset({
      name: p.name,
      categoryId: p.categoryId ?? null,
      brand: p.brand ?? "",
      suggestedPrice: p.suggestedPrice != null ? Number(p.suggestedPrice) : null,
      sku: p.sku ?? "",
    });
    setDialogOpen(true);
  };

  const onSubmit = (values: PartForm) => {
    const data = {
      name: values.name,
      categoryId: values.categoryId || null,
      brand: values.brand || null,
      suggestedPrice: values.suggestedPrice ?? null,
      sku: values.sku || null,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Repuesto actualizado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => { toast({ title: "Repuesto creado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al crear" }),
      });
    }
  };

  const handleToggleActive = (p: PartRow) => {
    if (p.active) setDeactivateTarget(p);
    else updateMutation.mutate({ id: p.id, data: { active: true } }, {
      onSuccess: () => { toast({ title: "Repuesto reactivado" }); invalidate(); },
    });
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    updateMutation.mutate({ id: deactivateTarget.id, data: { active: false } }, {
      onSuccess: () => { toast({ title: "Repuesto desactivado" }); setDeactivateTarget(null); invalidate(); },
    });
  };

  const visible = parts?.filter(p => showInactive ? true : p.active) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Repuestos</h1>
          <p className="text-muted-foreground mt-1">Catálogo de repuestos y accesorios.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "Ocultar inactivos" : "Ver inactivos"}
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2" data-testid="button-create-part">
            <Plus className="h-4 w-4" /> Nuevo Repuesto
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
                  <TableHead>SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Marca</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Precio Sugerido</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
                  <TableRow key={p.id} data-testid={`row-part-${p.id}`} className={!p.active ? "opacity-60" : ""}>
                    <TableCell>
                      {p.sku ? <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{p.sku}</code> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.brand || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.categoryName || "—"}</TableCell>
                    <TableCell>
                      {p.suggestedPrice != null ? (
                        <span className="flex items-center gap-1 text-sm"><DollarSign className="h-3 w-3 text-muted-foreground" />{Number(p.suggestedPrice).toLocaleString("es-CL")}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {p.active ? <Badge className="bg-green-500/10 text-green-700">Activo</Badge> : <Badge variant="destructive">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(p)} data-testid={`button-edit-part-${p.id}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleToggleActive(p)}>
                          {p.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No hay repuestos.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {visible.map((p) => (
              <Card key={p.id} data-testid={`card-part-${p.id}`} className={!p.active ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{p.name}</CardTitle>
                      {p.brand && <p className="text-sm text-muted-foreground">{p.brand}</p>}
                    </div>
                    {!p.active && <Badge variant="destructive">Inactivo</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {p.sku && <code className="bg-muted px-2 py-0.5 rounded text-xs">{p.sku}</code>}
                  {p.categoryName && <p className="text-sm text-muted-foreground">{p.categoryName}</p>}
                  <div className="flex items-center justify-between pt-2 border-t">
                    {p.suggestedPrice != null && (
                      <span className="flex items-center gap-1 text-sm font-medium"><DollarSign className="h-4 w-4 text-muted-foreground" />{Number(p.suggestedPrice).toLocaleString("es-CL")}</span>
                    )}
                    <div className="flex gap-1 ml-auto">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleToggleActive(p)}>
                        {p.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
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
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar Repuesto" : "Nuevo Repuesto"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Nombre *</FormLabel><FormControl><Input {...field} data-testid="input-part-name" /></FormControl><FormMessage /></FormItem>
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
                <FormField control={form.control} name="brand" render={({ field }) => (
                  <FormItem><FormLabel>Marca</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="sku" render={({ field }) => (
                  <FormItem><FormLabel>SKU / Código</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="suggestedPrice" render={({ field }) => (
                <FormItem><FormLabel>Precio sugerido (CLP)</FormLabel><FormControl><Input type="number" min={0} {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? null : Number(e.target.value))} data-testid="input-part-price" /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-part">
                  {editing ? "Guardar cambios" : "Crear repuesto"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar repuesto?</AlertDialogTitle>
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
