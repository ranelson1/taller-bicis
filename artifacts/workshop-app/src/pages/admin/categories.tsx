import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListCategories, useCreateCategory, useUpdateCategory,
  getListCategoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string().optional().nullable(),
});
type CatForm = z.infer<typeof schema>;
type CatRow = { id: number; name: string; description?: string | null; active: boolean };

export default function Categories() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: categories, isLoading } = useListCategories();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CatRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<CatRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();

  const form = useForm<CatForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() });

  const openCreate = () => { setEditing(null); form.reset({ name: "", description: "" }); setDialogOpen(true); };
  const openEdit = (c: CatRow) => { setEditing(c); form.reset({ name: c.name, description: c.description ?? "" }); setDialogOpen(true); };

  const onSubmit = (values: CatForm) => {
    const data = { name: values.name, description: values.description || null };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Categoría actualizada" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => { toast({ title: "Categoría creada" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al crear" }),
      });
    }
  };

  const handleToggleActive = (c: CatRow) => {
    if (c.active) setDeactivateTarget(c);
    else updateMutation.mutate({ id: c.id, data: { active: true } }, {
      onSuccess: () => { toast({ title: "Categoría reactivada" }); invalidate(); },
    });
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    updateMutation.mutate({ id: deactivateTarget.id, data: { active: false } }, {
      onSuccess: () => { toast({ title: "Categoría desactivada" }); setDeactivateTarget(null); invalidate(); },
    });
  };

  const visible = categories?.filter(c => showInactive ? true : c.active) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Categorías</h1>
          <p className="text-muted-foreground mt-1">Clasificación para servicios y repuestos.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "Ocultar inactivas" : "Ver inactivas"}
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2" data-testid="button-create-category">
            <Plus className="h-4 w-4" /> Nueva Categoría
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c) => (
                <TableRow key={c.id} data-testid={`row-category-${c.id}`} className={!c.active ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.description || "—"}</TableCell>
                  <TableCell>
                    {c.active ? <Badge className="bg-green-500/10 text-green-700">Activa</Badge> : <Badge variant="destructive">Inactiva</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(c)} data-testid={`button-edit-category-${c.id}`}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleToggleActive(c)}>
                        {c.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No hay categorías.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar Categoría" : "Nueva Categoría"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Nombre *</FormLabel><FormControl><Input {...field} data-testid="input-category-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Descripción</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-category">
                  {editing ? "Guardar" : "Crear categoría"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar categoría?</AlertDialogTitle>
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
