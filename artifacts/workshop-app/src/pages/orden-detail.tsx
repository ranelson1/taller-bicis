import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetWorkOrder,
  useUpdateWorkOrder,
  useUpdateWorkOrderStatus,
  useCancelWorkOrder,
  useAssignMechanicToWorkOrder,
  useUpdateWorkOrderChecklistItem,
  useUpdateWorkOrderItem,
  useGetWorkOrderTimeline,
  getGetWorkOrderQueryKey,
  useListUsers,
  type WorkOrderChecklistItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Wrench, FileText, Pencil, ChevronDown, ChevronUp,
  CheckCircle, User, Bike, Clock, AlertTriangle, AlertCircle, Play,
  RotateCcw, Package,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  ready_to_work: "Lista para trabajar",
  in_progress: "En trabajo",
  quality_control: "Control de calidad",
  ready_for_pickup: "Lista para retiro",
  delivered: "Entregada",
  cancelled: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  ready_to_work: "bg-sky-50 text-sky-700 border-sky-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  quality_control: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_pickup: "bg-emerald-50 text-emerald-700 border-emerald-200",
  delivered: "bg-gray-50 text-gray-600 border-gray-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

const CHECKLIST_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  completed: "Completado",
  not_applicable: "No aplica",
  with_observation: "Con observación",
};

const CHECKLIST_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  not_applicable: "bg-gray-50 text-gray-400",
  with_observation: "bg-blue-100 text-blue-700",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  completed: "Completado",
  cancelled: "Cancelado",
};

function formatCLP(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

const editSchema = z.object({
  mechanicId: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  estimatedDeliveryDate: z.string().optional(),
  internalNotes: z.string().optional(),
  customerNotes: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

export default function OrdenDetail() {
  const { id } = useParams<{ id: string }>();
  const workOrderId = parseInt(id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: wo, isLoading } = useGetWorkOrder(workOrderId);
  const { data: timeline } = useGetWorkOrderTimeline(workOrderId);
  const { data: users } = useListUsers();
  const mechanics = (users ?? []).filter(u => u.role === "mechanic" && u.active);

  const [showTimeline, setShowTimeline] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelComment, setCancelComment] = useState("");
  const [statusDialog, setStatusDialog] = useState<string | null>(null);
  const [checklistNote, setChecklistNote] = useState<Record<number, string>>({});

  const updateWO = useUpdateWorkOrder();
  const updateStatus = useUpdateWorkOrderStatus();
  const cancelWO = useCancelWorkOrder();
  const assignMechanic = useAssignMechanicToWorkOrder();
  const updateChecklist = useUpdateWorkOrderChecklistItem();
  const updateItem = useUpdateWorkOrderItem();

  const form = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { mechanicId: "", priority: "normal", estimatedDeliveryDate: "", internalNotes: "", customerNotes: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetWorkOrderQueryKey(workOrderId) });

  const openEdit = () => {
    if (!wo) return;
    form.reset({
      mechanicId: wo.mechanicId ? String(wo.mechanicId) : "none",
      priority: (wo.priority as any) ?? "normal",
      estimatedDeliveryDate: wo.estimatedDeliveryDate ? new Date(wo.estimatedDeliveryDate).toISOString().split("T")[0] : "",
      internalNotes: wo.internalNotes ?? "",
      customerNotes: wo.customerNotes ?? "",
    });
    setEditDialog(true);
  };

  const handleEdit = (values: EditForm) => {
    updateWO.mutate({
      id: workOrderId,
      data: {
        mechanicId: values.mechanicId && values.mechanicId !== "none" ? parseInt(values.mechanicId) : null,
        priority: values.priority,
        estimatedDeliveryDate: values.estimatedDeliveryDate || null,
        internalNotes: values.internalNotes || null,
        customerNotes: values.customerNotes || null,
      },
    }, {
      onSuccess: () => { toast({ title: "Orden actualizada" }); setEditDialog(false); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
    });
  };

  const handleStatusChange = (newStatus: string) => {
    updateStatus.mutate({ id: workOrderId, data: { status: newStatus as any } }, {
      onSuccess: () => { toast({ title: `Estado cambiado a: ${STATUS_LABELS[newStatus] ?? newStatus}` }); setStatusDialog(null); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al cambiar estado" }),
    });
  };

  const handleCancel = () => {
    cancelWO.mutate({ id: workOrderId, data: { comment: cancelComment || undefined } as any }, {
      onSuccess: () => { toast({ title: "Orden cancelada" }); setCancelDialog(false); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al cancelar" }),
    });
  };

  const handleChecklistUpdate = (item: WorkOrderChecklistItem, newStatus: string, note?: string) => {
    updateChecklist.mutate({
      id: workOrderId,
      checklistItemId: item.id,
      data: { status: newStatus as any, mechanicNote: note ?? item.mechanicNote ?? null },
    }, {
      onSuccess: () => { toast({ title: "Paso actualizado" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al actualizar paso" }),
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!wo) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <p className="text-muted-foreground">Orden de trabajo no encontrada.</p>
        <Link href="/ordenes"><Button variant="ghost" className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Volver</Button></Link>
      </div>
    );
  }

  const isCancelled = wo.status === "cancelled";
  const isDelivered = wo.status === "delivered";
  const isDone = isCancelled || isDelivered;

  const checklist = (wo as any).checklist ?? [];
  const items = (wo as any).items ?? [];

  // Group checklist by workOrderItemId
  const checklistByItem: Record<string | number, WorkOrderChecklistItem[]> = {};
  for (const ci of checklist) {
    const key = ci.workOrderItemId ?? "general";
    if (!checklistByItem[key]) checklistByItem[key] = [];
    checklistByItem[key].push(ci);
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/ordenes">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold font-mono text-primary">{wo.workOrderNumber}</h1>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[wo.status] ?? ""}`}>
              {STATUS_LABELS[wo.status] ?? wo.status}
            </span>
            {(wo as any).workCaseId && (wo as any).workCaseNumber && (
              <Link href={`/trabajos/${(wo as any).workCaseId}`}>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer font-mono">
                  Trabajo: {(wo as any).workCaseNumber}
                </span>
              </Link>
            )}
            {!wo.mechanicId && !isDone && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                <AlertCircle className="h-3.5 w-3.5" /> Sin mecánico
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 truncate">
            {wo.clientName ?? "—"}{wo.bicycleName ? ` · ${wo.bicycleName}` : ""}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      {!isDone && (
        <div className="flex flex-wrap gap-2">
          {wo.status === "ready_to_work" && (
            <Button onClick={() => handleStatusChange("in_progress")} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700">
              <Play className="h-4 w-4" /> Iniciar trabajo
            </Button>
          )}
          {wo.status === "in_progress" && (
            <Button onClick={() => handleStatusChange("quality_control")} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700">
              <CheckCircle className="h-4 w-4" /> Pasar a control de calidad
            </Button>
          )}
          {wo.status === "quality_control" && (
            <Button onClick={() => handleStatusChange("ready_for_pickup")} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700">
              <CheckCircle className="h-4 w-4" /> Lista para retiro
            </Button>
          )}
          {wo.status === "ready_for_pickup" && (
            <Button onClick={() => handleStatusChange("delivered")} className="flex items-center gap-2">
              <Package className="h-4 w-4" /> Marcar como entregada
            </Button>
          )}
          <Button variant="outline" onClick={openEdit} className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Editar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCancelDialog(true)} className="flex items-center gap-2 text-destructive hover:text-destructive ml-auto">
            <AlertTriangle className="h-4 w-4" /> Cancelar OT
          </Button>
        </div>
      )}

      {/* Info card */}
      <Card>
        <CardHeader><CardTitle className="text-base">Información de la orden</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground mb-0.5">Cliente</p>
            <p className="font-medium">{wo.clientName ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Bicicleta</p>
            <p className="font-medium">{wo.bicycleName ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Mecánico</p>
            <p className="font-medium">{wo.mechanicName ?? <span className="text-amber-600">Sin asignar</span>}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Prioridad</p>
            <p className="font-medium">{PRIORITY_LABELS[wo.priority] ?? wo.priority}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Total</p>
            <p className="font-medium font-mono">{formatCLP(wo.total)}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5">Horas estimadas</p>
            <p className="font-medium">{wo.estimatedLaborHours ?? 0} h</p>
          </div>
          {wo.estimatedDeliveryDate && (
            <div>
              <p className="text-muted-foreground mb-0.5">Entrega estimada</p>
              <p className="font-medium">{new Date(wo.estimatedDeliveryDate).toLocaleDateString("es-CL")}</p>
            </div>
          )}
          {wo.quoteNumber && (
            <div>
              <p className="text-muted-foreground mb-0.5">Presupuesto</p>
              <Link href={`/presupuestos/${wo.quoteId}`}>
                <span className="font-medium text-primary underline">{wo.quoteNumber}</span>
              </Link>
            </div>
          )}
          {wo.receptionNumber && (
            <div>
              <p className="text-muted-foreground mb-0.5">Recepción</p>
              <Link href={`/recepciones/${wo.receptionId}`}>
                <span className="font-medium text-primary underline">{wo.receptionNumber}</span>
              </Link>
            </div>
          )}
          <div>
            <p className="text-muted-foreground mb-0.5">Creada</p>
            <p className="font-medium">{new Date(wo.createdAt).toLocaleDateString("es-CL")}</p>
          </div>
          {wo.startedAt && (
            <div>
              <p className="text-muted-foreground mb-0.5">Iniciada</p>
              <p className="font-medium">{new Date(wo.startedAt).toLocaleDateString("es-CL")}</p>
            </div>
          )}
          {wo.customerNotes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Notas al cliente</p>
              <p className="font-medium">{wo.customerNotes}</p>
            </div>
          )}
          {wo.internalNotes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Notas internas</p>
              <p className="font-medium">{wo.internalNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Work order items */}
      {items.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wrench className="h-4 w-4" /> Ítems de trabajo</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {items.map((item: any) => (
              <div key={item.id} className="flex items-start justify-between p-3 rounded-lg border bg-muted/20 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <p className="text-xs text-muted-foreground">{item.quantity} × {formatCLP(item.unitPrice)}</p>
                  {!isDone && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {item.status === "pending" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => updateItem.mutate({ id: workOrderId, itemId: item.id, data: { status: "in_progress" } }, { onSuccess: () => { toast({ title: "Ítem iniciado" }); invalidate(); } })}>
                          Iniciar
                        </Button>
                      )}
                      {item.status === "in_progress" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-green-400 text-green-700 hover:bg-green-50"
                          onClick={() => updateItem.mutate({ id: workOrderId, itemId: item.id, data: { status: "completed" } }, { onSuccess: () => { toast({ title: "Ítem completado" }); invalidate(); } })}>
                          Completar
                        </Button>
                      )}
                      {(item.status === "pending" || item.status === "in_progress") && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => updateItem.mutate({ id: workOrderId, itemId: item.id, data: { status: "cancelled" } }, { onSuccess: () => { toast({ title: "Ítem cancelado" }); invalidate(); } })}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    item.status === "completed" ? "bg-green-100 text-green-700" :
                    item.status === "in_progress" ? "bg-amber-100 text-amber-700" :
                    item.status === "cancelled" ? "bg-red-100 text-red-600" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {ITEM_STATUS_LABELS[item.status] ?? item.status}
                  </span>
                  <span className="text-sm font-mono font-medium">{formatCLP(item.total)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Checklist */}
      {checklist.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle className="h-4 w-4" /> Checklist operativo
              </CardTitle>
              <span className="text-sm text-muted-foreground">
                {checklist.filter((c: any) => ["completed", "with_observation", "not_applicable"].includes(c.status)).length}/{checklist.length} pasos
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.length > 0 ? (
              items.map((item: any) => {
                const steps = checklistByItem[item.id] ?? [];
                if (steps.length === 0) return null;
                const completedSteps = steps.filter((s: any) => ["completed", "with_observation", "not_applicable"].includes(s.status)).length;
                return (
                  <div key={item.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">{item.description}</p>
                      <span className="text-xs text-muted-foreground">{completedSteps}/{steps.length}</span>
                    </div>
                    <Progress value={steps.length ? (completedSteps / steps.length) * 100 : 0} className="h-1.5" />
                    <div className="space-y-1 pl-2">
                      {steps.map((step: WorkOrderChecklistItem) => (
                        <ChecklistStepRow
                          key={step.id}
                          step={step}
                          disabled={isDone}
                          onUpdate={(status, note) => handleChecklistUpdate(step, status, note)}
                        />
                      ))}
                    </div>
                    <Separator />
                  </div>
                );
              })
            ) : (
              checklist.map((step: WorkOrderChecklistItem) => (
                <ChecklistStepRow
                  key={step.id}
                  step={step}
                  disabled={isDone}
                  onUpdate={(status, note) => handleChecklistUpdate(step, status, note)}
                />
              ))
            )}
            {/* General checklist items (no item association) */}
            {checklistByItem["general"] && checklistByItem["general"].map((step: WorkOrderChecklistItem) => (
              <ChecklistStepRow
                key={step.id}
                step={step}
                disabled={isDone}
                onUpdate={(status, note) => handleChecklistUpdate(step, status, note)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowTimeline(v => !v)}
        className="flex items-center gap-2 text-muted-foreground"
      >
        {showTimeline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Historial de eventos ({(timeline ?? []).length})
      </Button>

      {showTimeline && (timeline ?? []).length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            {(timeline ?? []).map((ev: any) => (
              <div key={ev.id} className="flex gap-3 text-sm">
                <div className="w-1 self-stretch bg-muted rounded-full shrink-0 ml-1" />
                <div>
                  <p className="font-medium">{ev.action.replace(/_/g, " ")}</p>
                  {ev.comment && <p className="text-muted-foreground">{ev.comment}</p>}
                  <p className="text-xs text-muted-foreground">{new Date(ev.createdAt).toLocaleDateString("es-CL")} · {ev.userName ?? "Sistema"}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar orden de trabajo</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleEdit)} className="space-y-4">
              <FormField
                control={form.control}
                name="mechanicId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mecánico</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "none"}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">Sin asignar</SelectItem>
                        {mechanics.map(m => (
                          <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prioridad</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "normal"}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="low">Baja</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="urgent">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="estimatedDeliveryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha estimada de entrega</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
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
                    <FormControl><Textarea rows={2} {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="customerNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas al cliente</FormLabel>
                    <FormControl><Textarea rows={2} {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditDialog(false)}>Cancelar</Button>
                <Button type="submit" disabled={updateWO.isPending}>Guardar</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <AlertDialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar orden de trabajo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción marcará la OT como cancelada. El trabajo no se puede revertir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6">
            <Textarea
              placeholder="Motivo de cancelación (opcional)..."
              value={cancelComment}
              onChange={e => setCancelComment(e.target.value)}
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-destructive hover:bg-destructive/90">
              Sí, cancelar OT
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChecklistStepRow({
  step,
  disabled,
  onUpdate,
}: {
  step: WorkOrderChecklistItem;
  disabled: boolean;
  onUpdate: (status: string, note?: string) => void;
}) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(step.mechanicNote ?? "");

  const isCompleted = ["completed", "with_observation", "not_applicable"].includes(step.status);

  return (
    <div className="py-2 space-y-1">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isCompleted ? (
            <CheckCircle className="h-4 w-4 text-green-600" />
          ) : (
            <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${step.status === "not_applicable" ? "line-through text-muted-foreground" : ""}`}>
            {step.description}
          </p>
          {step.mechanicNote && (
            <p className="text-xs text-muted-foreground mt-0.5 italic">"{step.mechanicNote}"</p>
          )}
        </div>
        {!disabled && (
          <div className="flex gap-1 shrink-0">
            <Select value={step.status} onValueChange={(v) => onUpdate(v, step.mechanicNote ?? undefined)}>
              <SelectTrigger className="h-7 text-xs w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="in_progress">En proceso</SelectItem>
                <SelectItem value="completed">Completado</SelectItem>
                <SelectItem value="with_observation">Con observación</SelectItem>
                <SelectItem value="not_applicable">No aplica</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {!disabled && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setShowNote(v => !v)}
            title="Añadir nota"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      {showNote && !disabled && (
        <div className="pl-7 flex gap-2">
          <Input
            className="h-7 text-xs"
            placeholder="Nota del mecánico..."
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => { onUpdate(step.status, note); setShowNote(false); }}
          >
            Guardar
          </Button>
        </div>
      )}
    </div>
  );
}
