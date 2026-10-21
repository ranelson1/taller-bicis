import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListPaymentMethods, useCreatePaymentMethod, useUpdatePaymentMethod,
  getListPaymentMethodsQueryKey,
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
  notes: z.string().optional().nullable(),
});
type PMForm = z.infer<typeof schema>;
type PMRow = { id: number; name: string; notes?: string | null; active: boolean };

export default function PaymentMethods() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: methods, isLoading } = useListPaymentMethods();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PMRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PMRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const createMutation = useCreatePaymentMethod();
  const updateMutation = useUpdatePaymentMethod();

  const form = useForm<PMForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", notes: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPaymentMethodsQueryKey() });

  const openCreate = () => { setEditing(null); form.reset({ name: "", notes: "" }); setDialogOpen(true); };
  const openEdit = (m: PMRow) => { setEditing(m); form.reset({ name: m.name, notes: m.notes ?? "" }); setDialogOpen(true); };

  const onSubmit = (values: PMForm) => {
    const data = { name: values.name, notes: values.notes || null };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Método actualizado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => { toast({ title: "Método creado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al crear" }),
      });
    }
  };

  const handleToggleActive = (m: PMRow) => {
    if (m.active) setDeactivateTarget(m);
    else updateMutation.mutate({ id: m.id, data: { active: true } }, {
      onSuccess: () => { toast({ title: "Método reactivado" }); invalidate(); },
    });
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    updateMutation.mutate({ id: deactivateTarget.id, data: { active: false } }, {
      onSuccess: () => { toast({ title: "Método desactivado" }); setDeactivateTarget(null); invalidate(); },
    });
  };

  const visible = methods?.filter(m => showInactive ? true : m.active) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Métodos de Pago</h1>
          <p className="text-muted-foreground mt-1">Formas de pago aceptadas en el taller.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "Ocultar inactivos" : "Ver inactivos"}
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2" data-testid="button-create-payment-method">
            <Plus className="h-4 w-4" /> Nuevo Método
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
                <TableHead>Notas</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((m) => (
                <TableRow key={m.id} data-testid={`row-pm-${m.id}`} className={!m.active ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{m.notes || "—"}</TableCell>
                  <TableCell>
                    {m.active ? <Badge className="bg-green-500/10 text-green-700">Activo</Badge> : <Badge variant="destructive">Inactivo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(m)} data-testid={`button-edit-pm-${m.id}`}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleToggleActive(m)}>
                        {m.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">No hay métodos de pago.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar Método" : "Nuevo Método de Pago"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Nombre *</FormLabel><FormControl><Input {...field} data-testid="input-pm-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notas</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-pm">
                  {editing ? "Guardar" : "Crear método"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar método de pago?</AlertDialogTitle>
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
