import { useState } from "react";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useGetService, getGetServiceQueryKey,
  useCreateServiceStep, useUpdateServiceStep, useDeleteServiceStep, useMoveServiceStep,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Clock, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ArrowLeft } from "lucide-react";

const stepSchema = z.object({
  description: z.string().min(1, "La descripción es requerida"),
  notes: z.string().optional().nullable(),
});
type StepForm = z.infer<typeof stepSchema>;
type StepRow = { id: number; serviceId: number; description: string; order: number; notes?: string | null };

export default function ServiceDetail() {
  const params = useParams();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: service, isLoading } = useGetService(id, {
    query: { enabled: !!id, queryKey: getGetServiceQueryKey(id) },
  });

  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<StepRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StepRow | null>(null);

  const createStepMutation = useCreateServiceStep();
  const updateStepMutation = useUpdateServiceStep();
  const deleteStepMutation = useDeleteServiceStep();
  const moveStepMutation = useMoveServiceStep();

  const stepForm = useForm<StepForm>({
    resolver: zodResolver(stepSchema),
    defaultValues: { description: "", notes: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetServiceQueryKey(id) });

  const openCreateStep = () => {
    setEditingStep(null);
    stepForm.reset({ description: "", notes: "" });
    setStepDialogOpen(true);
  };

  const openEditStep = (step: StepRow) => {
    setEditingStep(step);
    stepForm.reset({ description: step.description, notes: step.notes ?? "" });
    setStepDialogOpen(true);
  };

  const onStepSubmit = (values: StepForm) => {
    if (editingStep) {
      updateStepMutation.mutate({ id: editingStep.id, data: { description: values.description, notes: values.notes || null } }, {
        onSuccess: () => { toast({ title: "Paso actualizado" }); setStepDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createStepMutation.mutate({ data: { serviceId: id, description: values.description, notes: values.notes || null } }, {
        onSuccess: () => { toast({ title: "Paso agregado" }); setStepDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al agregar" }),
      });
    }
  };

  const handleMove = (step: StepRow, direction: "up" | "down") => {
    moveStepMutation.mutate({ id: step.id, data: { direction } }, {
      onSuccess: () => invalidate(),
      onError: () => toast({ variant: "destructive", title: "Error al mover" }),
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteStepMutation.mutate({ id: deleteTarget.id }, {
      onSuccess: () => { toast({ title: "Paso eliminado" }); setDeleteTarget(null); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al eliminar" }),
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!service) return <div className="p-8">Servicio no encontrado</div>;

  const steps = service.steps ?? [];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <Link href="/admin/servicios" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 w-fit">
          <ArrowLeft className="h-4 w-4" /> Volver a Servicios
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-foreground">{service.name}</h1>
          {!service.active && <Badge variant="destructive">Inactivo</Badge>}
        </div>
        {service.categoryName && <p className="text-muted-foreground mt-1">{service.categoryName}</p>}
      </div>

      {/* Info card */}
      <Card>
        <CardHeader><CardTitle>Detalles del Servicio</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground text-sm">Precio Base</span>
              <span className="font-medium flex items-center gap-1">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                {service.basePrice != null ? Number(service.basePrice).toLocaleString("es-CL") : "No definido"}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground text-sm">Tiempo Estimado</span>
              <span className="font-medium flex items-center gap-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                {service.estimatedHours != null ? `${service.estimatedHours} horas` : "No definido"}
              </span>
            </div>
          </div>
          <div className="space-y-3">
            {service.clientDescription && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Descripción para cliente</p>
                <p className="text-sm">{service.clientDescription}</p>
              </div>
            )}
            {service.internalDescription && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notas internas</p>
                <p className="text-sm bg-muted p-2 rounded-md">{service.internalDescription}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Checklist
              <Badge variant="secondary">{steps.length} {steps.length === 1 ? "paso" : "pasos"}</Badge>
            </CardTitle>
            <Button onClick={openCreateStep} size="sm" className="flex items-center gap-2" data-testid="button-add-step">
              <Plus className="h-4 w-4" /> Agregar Paso
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="mb-2">No hay pasos definidos para este servicio.</p>
              <Button variant="outline" onClick={openCreateStep} className="flex items-center gap-2 mx-auto">
                <Plus className="h-4 w-4" /> Agregar el primer paso
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {steps.map((step, index) => (
                <li key={step.id} data-testid={`step-${step.id}`} className="flex gap-3 items-start p-3 bg-muted/40 rounded-lg border group hover:bg-muted/70 transition-colors">
                  {/* Order badge */}
                  <div className="bg-background rounded-full w-7 h-7 flex items-center justify-center flex-shrink-0 border shadow-sm text-xs font-semibold text-muted-foreground mt-0.5">
                    {index + 1}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{step.description}</p>
                    {step.notes && <p className="text-xs text-muted-foreground mt-1">{step.notes}</p>}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => handleMove(step as StepRow, "up")}
                      disabled={index === 0 || moveStepMutation.isPending}
                      data-testid={`button-move-up-${step.id}`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => handleMove(step as StepRow, "down")}
                      disabled={index === steps.length - 1 || moveStepMutation.isPending}
                      data-testid={`button-move-down-${step.id}`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => openEditStep(step as StepRow)}
                      data-testid={`button-edit-step-${step.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(step as StepRow)}
                      data-testid={`button-delete-step-${step.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Step Dialog */}
      <Dialog open={stepDialogOpen} onOpenChange={setStepDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingStep ? "Editar Paso" : "Agregar Paso"}</DialogTitle></DialogHeader>
          <Form {...stepForm}>
            <form onSubmit={stepForm.handleSubmit(onStepSubmit)} className="space-y-4">
              <FormField control={stepForm.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción *</FormLabel>
                  <FormControl><Input placeholder="Ej: Desmontar horquilla..." {...field} data-testid="input-step-description" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={stepForm.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas internas</FormLabel>
                  <FormControl><Textarea placeholder="Aclaraciones, especificaciones..." {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStepDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createStepMutation.isPending || updateStepMutation.isPending} data-testid="button-submit-step">
                  {editingStep ? "Guardar" : "Agregar paso"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Alert */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar paso?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminará permanentemente: <strong>{deleteTarget?.description}</strong></AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
