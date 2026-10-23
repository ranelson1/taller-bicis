import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetReception,
  useUpdateReception,
  useStartReceptionInspection,
  useCompleteReceptionInspection,
  useMarkReceptionReadyForWorkOrder,
  useCancelReception,
  useCreateQuoteFromReception,
  useListReceptionFindings,
  useCreateReceptionFinding,
  useUpdateReceptionFinding,
  useDeleteReceptionFinding,
  useCreateQuoteItemFromFinding,
  useGetReceptionTimeline,
  useListWorkOrders,
  useCreateWorkOrderFromReception,
  getGetReceptionQueryKey,
  getListReceptionFindingsQueryKey,
  type InspectionFinding,
  type ReceptionWithDetails,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Wrench, FileText, Plus, Pencil, Trash2, ChevronDown, ChevronUp,
  CheckCircle, ClipboardList, User, Bike, Clock, Inbox, AlertTriangle,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  received: "Recibida",
  in_inspection: "En inspección",
  inspection_completed: "Inspección completa",
  waiting_quote_approval: "Esperando aprobación",
  ready_for_work_order: "Lista para OT",
  cancelled: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  received: "bg-blue-50 text-blue-700 border-blue-200",
  in_inspection: "bg-amber-50 text-amber-700 border-amber-200",
  inspection_completed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  waiting_quote_approval: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_work_order: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-gray-50 text-gray-500 border-gray-200",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700 border-gray-200",
  medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

const AREAS = [
  "Frenos", "Transmisión", "Suspensión delantera", "Suspensión trasera",
  "Ruedas y neumáticos", "Cuadro", "Manubrio y potencia", "Sillín y tija",
  "Pedalier", "Cadena", "Electrónica", "Otro",
];

const findingSchema = z.object({
  area: z.string().min(1, "Selecciona un área"),
  severity: z.enum(["low", "medium", "high", "critical"]),
  finding: z.string().min(1, "Describe el hallazgo"),
  recommendation: z.string().optional(),
  shouldCreateQuoteItem: z.boolean().optional(),
  quoteItemDescription: z.string().optional(),
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  estimatedLaborHours: z.string().optional(),
  internalNotes: z.string().optional(),
});
type FindingForm = z.infer<typeof findingSchema>;


export default function RecepcionDetail() {
  const { id } = useParams<{ id: string }>();
  const receptionId = parseInt(id ?? "0");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: reception, isLoading } = useGetReception(receptionId);
  const { data: findings } = useListReceptionFindings(receptionId);
  const { data: timeline } = useGetReceptionTimeline(receptionId);

  const [showTimeline, setShowTimeline] = useState(false);
  const [findingDialog, setFindingDialog] = useState(false);
  const [editingFinding, setEditingFinding] = useState<InspectionFinding | null>(null);
  const [deleteFindingTarget, setDeleteFindingTarget] = useState<InspectionFinding | null>(null);
  const [editDialog, setEditDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);

  const startInspection = useStartReceptionInspection();
  const completeInspection = useCompleteReceptionInspection();
  const markReady = useMarkReceptionReadyForWorkOrder();
  const cancelReceptionMut = useCancelReception();
  const createQuote = useCreateQuoteFromReception();
  const createFinding = useCreateReceptionFinding();
  const updateFinding = useUpdateReceptionFinding();
  const deleteFinding = useDeleteReceptionFinding();
  const createQuoteItem = useCreateQuoteItemFromFinding();
  const updateReception = useUpdateReception();
  const createWorkOrder = useCreateWorkOrderFromReception();
  const { data: linkedWorkOrders } = useListWorkOrders({} as any);
  const linkedWorkOrder = (linkedWorkOrders ?? []).find((wo: any) => wo.receptionId === receptionId) ?? null;

  const form = useForm<FindingForm>({
    resolver: zodResolver(findingSchema),
    defaultValues: { area: "", severity: "medium", finding: "", recommendation: "", shouldCreateQuoteItem: false, quoteItemDescription: "", quantity: "1", unitPrice: "0", estimatedLaborHours: "", internalNotes: "" },
  });

  const watchShouldCreate = form.watch("shouldCreateQuoteItem");

  const editForm = useForm({ defaultValues: { customerReportedProblem: "", initialVisualCondition: "", accessoriesReceivedText: "", internalNotes: "", customerNotes: "" } });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetReceptionQueryKey(receptionId) });
    qc.invalidateQueries({ queryKey: getListReceptionFindingsQueryKey(receptionId) });
  };

  const handleStartInspection = () => {
    startInspection.mutate({ id: receptionId }, {
      onSuccess: () => { toast({ title: "Inspección iniciada" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const handleCompleteInspection = () => {
    completeInspection.mutate({ id: receptionId }, {
      onSuccess: () => { toast({ title: "Inspección completada" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const handleMarkReady = () => {
    markReady.mutate({ id: receptionId }, {
      onSuccess: () => { toast({ title: "Marcada como lista para OT" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const handleCreateQuote = () => {
    createQuote.mutate({ id: receptionId }, {
      onSuccess: (data: any) => {
        toast({ title: "Presupuesto creado", description: `Se creó el presupuesto ${data.quoteNumber}` });
        invalidate();
      },
      onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e?.response?.data?.error }),
    });
  };

  const handleCreateWorkOrder = () => {
    createWorkOrder.mutate({ receptionId }, {
      onSuccess: (wo: any) => {
        toast({ title: `Orden de trabajo ${(wo as any).workOrderNumber} creada exitosamente` });
        navigate(`/ordenes/${wo.id}`);
      },
      onError: () => toast({ variant: "destructive", title: "Error al crear la orden de trabajo" }),
    });
  };

  const openAddFinding = () => {
    setEditingFinding(null);
    form.reset({ area: "", severity: "medium", finding: "", recommendation: "", shouldCreateQuoteItem: false, quoteItemDescription: "", quantity: "1", unitPrice: "0", estimatedLaborHours: "", internalNotes: "" });
    setFindingDialog(true);
  };

  const openEditFinding = (f: InspectionFinding) => {
    setEditingFinding(f);
    form.reset({
      area: f.area,
      severity: f.severity,
      finding: f.finding,
      recommendation: f.recommendation ?? "",
      shouldCreateQuoteItem: f.shouldCreateQuoteItem,
      quoteItemDescription: f.quoteItemDescription ?? "",
      quantity: f.quantity != null ? String(f.quantity) : "1",
      unitPrice: f.unitPrice != null ? String(f.unitPrice) : "0",
      estimatedLaborHours: f.estimatedLaborHours != null ? String(f.estimatedLaborHours) : "",
      internalNotes: f.internalNotes ?? "",
    });
    setFindingDialog(true);
  };

  const onSubmitFinding = (values: FindingForm) => {
    const payload = {
      area: values.area,
      severity: values.severity,
      finding: values.finding,
      recommendation: values.recommendation || null,
      shouldCreateQuoteItem: values.shouldCreateQuoteItem ?? false,
      quoteItemDescription: values.quoteItemDescription || null,
      quantity: values.quantity ? parseFloat(values.quantity) : null,
      unitPrice: values.unitPrice ? parseFloat(values.unitPrice) : null,
      estimatedLaborHours: values.estimatedLaborHours ? parseFloat(values.estimatedLaborHours) : null,
      internalNotes: values.internalNotes || null,
    };

    if (editingFinding) {
      updateFinding.mutate({ id: receptionId, findingId: editingFinding.id, data: payload }, {
        onSuccess: () => { toast({ title: "Hallazgo actualizado" }); setFindingDialog(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error" }),
      });
    } else {
      createFinding.mutate({ id: receptionId, data: payload }, {
        onSuccess: () => { toast({ title: "Hallazgo registrado" }); setFindingDialog(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error" }),
      });
    }
  };

  const handleDeleteFinding = () => {
    if (!deleteFindingTarget) return;
    deleteFinding.mutate({ id: receptionId, findingId: deleteFindingTarget.id }, {
      onSuccess: () => { toast({ title: "Hallazgo eliminado" }); setDeleteFindingTarget(null); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const handleCreateQuoteItem = (f: InspectionFinding) => {
    if (!reception?.quoteId) {
      toast({ variant: "destructive", title: "La recepción no tiene presupuesto", description: "Crea un presupuesto primero." });
      return;
    }
    createQuoteItem.mutate({ id: receptionId, findingId: f.id }, {
      onSuccess: () => { toast({ title: "Ítem agregado al presupuesto" }); invalidate(); },
      onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e?.response?.data?.error }),
    });
  };

  const openEdit = () => {
    if (!reception) return;
    editForm.reset({
      customerReportedProblem: reception.customerReportedProblem ?? "",
      initialVisualCondition: reception.initialVisualCondition ?? "",
      accessoriesReceivedText: Array.isArray(reception.accessoriesReceived) ? (reception.accessoriesReceived as string[]).join(", ") : "",
      internalNotes: reception.internalNotes ?? "",
      customerNotes: reception.customerNotes ?? "",
    });
    setEditDialog(true);
  };

  const handleEditSubmit = editForm.handleSubmit((values) => {
    const accessories = (values as any).accessoriesReceivedText
      ? (values as any).accessoriesReceivedText.split(",").map((s: string) => s.trim()).filter(Boolean)
      : null;
    updateReception.mutate({
      id: receptionId,
      data: {
        customerReportedProblem: (values as any).customerReportedProblem || null,
        initialVisualCondition: (values as any).initialVisualCondition || null,
        accessoriesReceived: accessories,
        internalNotes: (values as any).internalNotes || null,
        customerNotes: (values as any).customerNotes || null,
      },
    }, {
      onSuccess: () => { toast({ title: "Recepción actualizada" }); setEditDialog(false); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  });

  const handleCancel = () => {
    cancelReceptionMut.mutate({ id: receptionId }, {
      onSuccess: () => { toast({ title: "Recepción cancelada" }); setCancelDialog(false); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al cancelar" }),
    });
  };

  const canStartInspection = reception?.status === "received";
  const canCompleteInspection = reception?.status === "in_inspection";
  const canCreateQuote = !reception?.quoteId && ["in_inspection", "inspection_completed"].includes(reception?.status ?? "");
  const canAddFindings = ["in_inspection", "inspection_completed"].includes(reception?.status ?? "");
  const canMarkReady = ["inspection_completed", "waiting_quote_approval"].includes(reception?.status ?? "");
  const canCancel = reception?.status !== "cancelled" && reception?.status !== "ready_for_work_order";
  const canCreateWorkOrder = reception?.status === "ready_for_work_order" && !linkedWorkOrder;

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!reception) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <p className="text-muted-foreground">Recepción no encontrada.</p>
        <Link href="/recepciones"><Button variant="ghost" className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Volver</Button></Link>
      </div>
    );
  }

  const activeFigs = (findings ?? []).filter(f => f.active !== false);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/recepciones">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold font-mono text-primary">{reception.receptionNumber}</h1>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[reception.status] ?? "bg-gray-100 text-gray-700"}`}>
              {STATUS_LABELS[reception.status] ?? reception.status}
            </span>
            {reception.workCaseId && reception.workCaseNumber && (
              <Link href={`/trabajos/${reception.workCaseId}`}>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer font-mono">
                  Trabajo: {reception.workCaseNumber}
                </span>
              </Link>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            {reception.clientName ?? "—"}{reception.bicycleName ? ` · ${reception.bicycleName}` : ""}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {canStartInspection && (
          <Button onClick={handleStartInspection} disabled={startInspection.isPending} className="flex items-center gap-2" data-testid="btn-start-inspection">
            <Wrench className="h-4 w-4" /> Iniciar inspección
          </Button>
        )}
        {canCompleteInspection && (
          <Button onClick={handleCompleteInspection} disabled={completeInspection.isPending} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700" data-testid="btn-complete-inspection">
            <CheckCircle className="h-4 w-4" /> Completar inspección
          </Button>
        )}
        {canCreateQuote && (
          <Button onClick={handleCreateQuote} disabled={createQuote.isPending} variant="outline" className="flex items-center gap-2" data-testid="btn-create-quote">
            <FileText className="h-4 w-4" /> Crear presupuesto
          </Button>
        )}
        {reception.quoteId && (
          <Link href={`/presupuestos/${reception.quoteId}`}>
            <Button variant="outline" className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Ver presupuesto {reception.quoteNumber}
            </Button>
          </Link>
        )}
        {canMarkReady && (
          <Button onClick={handleMarkReady} disabled={markReady.isPending} variant="outline" className="flex items-center gap-2" data-testid="btn-mark-ready">
            <ClipboardList className="h-4 w-4" /> Lista para OT
          </Button>
        )}
        {canCreateWorkOrder && (
          <Button onClick={handleCreateWorkOrder} disabled={createWorkOrder.isPending} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700" data-testid="btn-create-work-order">
            <ClipboardList className="h-4 w-4" /> Crear OT
          </Button>
        )}
        {linkedWorkOrder && (
          <Link href={`/ordenes/${linkedWorkOrder.id}`}>
            <Button variant="outline" className="flex items-center gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50">
              <ClipboardList className="h-4 w-4" /> Ver OT {(linkedWorkOrder as any).workOrderNumber}
            </Button>
          </Link>
        )}
        <Button variant="ghost" size="sm" onClick={openEdit} className="flex items-center gap-2 ml-auto">
          <Pencil className="h-4 w-4" /> Editar
        </Button>
        {canCancel && (
          <Button variant="ghost" size="sm" onClick={() => setCancelDialog(true)} className="flex items-center gap-2 text-destructive hover:text-destructive">
            <AlertTriangle className="h-4 w-4" /> Cancelar recepción
          </Button>
        )}
      </div>

      {/* Info card */}
      <Card>
        <CardHeader><CardTitle className="text-base">Información de la recepción</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div><p className="text-muted-foreground mb-0.5">Cliente</p><p className="font-medium">{reception.clientName ?? "—"}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Bicicleta</p><p className="font-medium">{reception.bicycleName ?? "—"}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Fecha ingreso</p><p className="font-medium">{new Date(reception.receivedAt).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p></div>
          {reception.receivedByName && (
            <div><p className="text-muted-foreground mb-0.5">Recibido por</p><p className="font-medium">{reception.receivedByName}</p></div>
          )}
          {reception.quoteNumber && (
            <div><p className="text-muted-foreground mb-0.5">Presupuesto</p>
              <Link href={`/presupuestos/${reception.quoteId}`}>
                <span className="font-medium text-primary underline">{reception.quoteNumber}</span>
              </Link>
            </div>
          )}
          {Array.isArray(reception.accessoriesReceived) && (reception.accessoriesReceived as string[]).length > 0 && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Accesorios recibidos</p>
              <div className="flex flex-wrap gap-1">
                {(reception.accessoriesReceived as string[]).map((a, i) => (
                  <span key={i} className="px-2 py-0.5 bg-muted rounded text-xs font-medium">{a}</span>
                ))}
              </div>
            </div>
          )}
          {reception.customerReportedProblem && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Problema reportado</p>
              <p className="font-medium">{reception.customerReportedProblem}</p>
            </div>
          )}
          {reception.initialVisualCondition && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Condición visual inicial</p>
              <p className="font-medium">{reception.initialVisualCondition}</p>
            </div>
          )}
          {reception.customerNotes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Notas del cliente</p>
              <p className="font-medium">{reception.customerNotes}</p>
            </div>
          )}
          {reception.internalNotes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Notas internas</p>
              <p className="font-medium">{reception.internalNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Findings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Hallazgos de inspección visual</CardTitle>
            {activeFigs.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">{activeFigs.length} hallazgo{activeFigs.length !== 1 ? "s" : ""}</p>
            )}
          </div>
          {canAddFindings && (
            <Button size="sm" onClick={openAddFinding} className="flex items-center gap-1" data-testid="btn-add-finding">
              <Plus className="h-4 w-4" /> Agregar hallazgo
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {activeFigs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">
                {canAddFindings ? "No hay hallazgos registrados. Agrega uno con el botón de arriba." : "No se registraron hallazgos en la inspección."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeFigs.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  canEdit={canAddFindings}
                  canCreateItem={!!reception.quoteId && !f.createdQuoteItemId}
                  quoteId={reception.quoteId ?? null}
                  onEdit={() => openEditFinding(f)}
                  onDelete={() => setDeleteFindingTarget(f)}
                  onCreateItem={() => handleCreateQuoteItem(f)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline toggle */}
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

      {/* Finding Dialog */}
      <Dialog open={findingDialog} onOpenChange={setFindingDialog}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingFinding ? "Editar hallazgo" : "Nuevo hallazgo"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitFinding)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="area"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Área *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="severity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Severidad *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="low">Baja</SelectItem>
                          <SelectItem value="medium">Media</SelectItem>
                          <SelectItem value="high">Alta</SelectItem>
                          <SelectItem value="critical">Crítica</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="finding"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hallazgo *</FormLabel>
                    <FormControl><Textarea placeholder="Describe el hallazgo detalladamente..." rows={3} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="recommendation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recomendación</FormLabel>
                    <FormControl><Textarea placeholder="Acción recomendada..." rows={2} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {reception.quoteId && (
                <FormField
                  control={form.control}
                  name="shouldCreateQuoteItem"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="should-create"
                          checked={field.value}
                          onChange={e => field.onChange(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <FormLabel htmlFor="should-create" className="cursor-pointer font-normal">
                          Marcar para agregar al presupuesto {reception.quoteNumber}
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              )}

              {watchShouldCreate && (
                <div className="space-y-3 p-3 bg-muted/40 rounded-lg">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Datos del ítem de presupuesto</p>
                  <FormField
                    control={form.control}
                    name="quoteItemDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descripción del ítem</FormLabel>
                        <FormControl><Input placeholder="Descripción para el presupuesto..." {...field} /></FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <FormField control={form.control} name="quantity" render={({ field }) => (
                      <FormItem><FormLabel>Cant.</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="unitPrice" render={({ field }) => (
                      <FormItem><FormLabel>Precio unit.</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="estimatedLaborHours" render={({ field }) => (
                      <FormItem><FormLabel>Horas M.O.</FormLabel><FormControl><Input type="number" step="0.25" placeholder="0" {...field} /></FormControl></FormItem>
                    )} />
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="internalNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas internas</FormLabel>
                    <FormControl><Input placeholder="Notas para el equipo..." {...field} /></FormControl>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setFindingDialog(false)}>Cancelar</Button>
                <Button type="submit" disabled={createFinding.isPending || updateFinding.isPending}>
                  {editingFinding ? "Guardar cambios" : "Registrar hallazgo"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete finding dialog */}
      <AlertDialog open={!!deleteFindingTarget} onOpenChange={v => { if (!v) setDeleteFindingTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar hallazgo?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminará el hallazgo "{deleteFindingTarget?.finding?.substring(0, 60)}..."</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFinding} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel reception dialog */}
      <AlertDialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar recepción?</AlertDialogTitle>
            <AlertDialogDescription>
              La recepción {reception?.receptionNumber} quedará marcada como cancelada. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={cancelReceptionMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar cancelación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit reception dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar recepción</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Problema reportado</label>
              <Textarea rows={3} {...editForm.register("customerReportedProblem")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Condición visual inicial</label>
              <Textarea rows={3} {...editForm.register("initialVisualCondition")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Accesorios recibidos (separados por coma)</label>
              <Input {...editForm.register("accessoriesReceivedText")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notas del cliente</label>
              <Textarea rows={2} {...editForm.register("customerNotes")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notas internas</label>
              <Textarea rows={2} {...editForm.register("internalNotes")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={updateReception.isPending}>Guardar cambios</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FindingCard({
  finding: f, canEdit, canCreateItem, quoteId, onEdit, onDelete, onCreateItem,
}: {
  finding: InspectionFinding;
  canEdit: boolean;
  canCreateItem: boolean;
  quoteId: number | null;
  onEdit: () => void;
  onDelete: () => void;
  onCreateItem: () => void;
}) {
  const alreadyLinked = !!f.createdQuoteItemId;
  return (
    <div className={`p-3 rounded-lg border ${f.severity === "critical" ? "bg-red-50/50 border-red-200" : f.severity === "high" ? "bg-orange-50/50 border-orange-200" : "bg-muted/20"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SEVERITY_COLORS[f.severity] ?? ""}`}>
              {SEVERITY_LABELS[f.severity] ?? f.severity}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">{f.area}</span>
            {alreadyLinked && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                En presupuesto
              </span>
            )}
          </div>
          <p className="text-sm font-medium">{f.finding}</p>
          {f.recommendation && (
            <p className="text-sm text-muted-foreground mt-0.5">↳ {f.recommendation}</p>
          )}
          {f.quoteItemDescription && !alreadyLinked && f.shouldCreateQuoteItem && (
            <p className="text-xs text-muted-foreground mt-1">Ítem propuesto: {f.quoteItemDescription} — {f.unitPrice ? formatCLP(Number(f.unitPrice)) : "—"}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canCreateItem && f.shouldCreateQuoteItem && quoteId && !alreadyLinked && (
            <Button size="sm" variant="outline" onClick={onCreateItem} className="text-xs h-7 px-2 border-green-300 text-green-700 hover:bg-green-50" title="Agregar al presupuesto">
              <Plus className="h-3 w-3 mr-1" />Agregar a ppto.
            </Button>
          )}
          {canEdit && (
            <>
              <Button size="icon" variant="ghost" onClick={onEdit} className="h-7 w-7"><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" onClick={onDelete} className="h-7 w-7"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCLP(value: number): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}
