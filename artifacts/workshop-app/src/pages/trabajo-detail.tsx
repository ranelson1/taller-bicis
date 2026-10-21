import { useParams, Link } from "wouter";
import {
  useGetWorkCase,
  useGetWorkCaseTimeline,
  useRecalculateWorkCaseStatus,
  useUpdateWorkOrderStatus,
  useCreateQuoteItem,
  useAddWorkCaseComment,
  useAssignMechanicToWorkOrder,
  useListUsers,
  useListServices,
  useListParts,
  getGetWorkCaseQueryKey,
  getGetWorkCaseTimelineQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Briefcase, FileText, Inbox, ClipboardList, User, Bike,
  RefreshCw, ChevronDown, ChevronUp, Clock, CheckCircle2, Circle, XCircle,
  Play, MessageSquarePlus, PlusCircle,
} from "lucide-react";
import { useState } from "react";

const STATUS_LABELS: Record<string, string> = {
  lead: "Lead",
  quoted: "Presupuestado",
  quote_sent: "Presupuesto enviado",
  quote_approved: "Presupuesto aprobado",
  bike_received: "Bici recibida",
  in_inspection: "En inspección",
  ready_for_work_order: "Listo para OT",
  in_work_order: "En OT",
  in_progress: "En trabajo",
  quality_control: "Control calidad",
  ready_for_pickup: "Listo para retiro",
  delivered: "Entregado",
  cancelled: "Cancelado",
  closed: "Cerrado",
};

const STATUS_COLORS: Record<string, string> = {
  lead: "bg-gray-100 text-gray-700 border-gray-200",
  quoted: "bg-blue-50 text-blue-700 border-blue-200",
  quote_sent: "bg-indigo-50 text-indigo-700 border-indigo-200",
  quote_approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  bike_received: "bg-sky-50 text-sky-700 border-sky-200",
  in_inspection: "bg-amber-50 text-amber-700 border-amber-200",
  ready_for_work_order: "bg-teal-50 text-teal-700 border-teal-200",
  in_work_order: "bg-orange-50 text-orange-700 border-orange-200",
  in_progress: "bg-yellow-50 text-yellow-700 border-yellow-200",
  quality_control: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_pickup: "bg-green-50 text-green-700 border-green-200",
  delivered: "bg-gray-50 text-gray-500 border-gray-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
  closed: "bg-gray-100 text-gray-500 border-gray-200",
};

const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador", sent: "Enviado", partially_approved: "Aprobado parcial",
  approved: "Aprobado", rejected: "Rechazado", updated_after_sent: "Actualizado",
  ready_for_work_order: "Listo para OT", converted_to_work_order: "Convertido a OT",
};

const RECEPTION_STATUS_LABELS: Record<string, string> = {
  received: "Recibida", in_inspection: "En inspección", inspection_completed: "Inspección completa",
  waiting_quote_approval: "Esp. aprobación", ready_for_work_order: "Lista para OT", cancelled: "Cancelada",
};

const WORK_ORDER_STATUS_LABELS: Record<string, string> = {
  ready_to_work: "Lista para trabajar", in_progress: "En trabajo",
  quality_control: "Control calidad", ready_for_pickup: "Listo para retiro",
  delivered: "Entregada", cancelled: "Cancelada",
};

// Next quick-action per work-order status (advances the OT through its flow).
const WO_NEXT_ACTION: Record<string, { label: string; next: string }> = {
  ready_to_work: { label: "Iniciar trabajo", next: "in_progress" },
  in_progress: { label: "Enviar a control de calidad", next: "quality_control" },
  quality_control: { label: "Marcar listo para retiro", next: "ready_for_pickup" },
  ready_for_pickup: { label: "Marcar como entregado", next: "delivered" },
};

const COMMENT_TYPES = [
  { value: "recepcion", label: "Recepción" },
  { value: "durante_trabajo", label: "Durante el trabajo" },
  { value: "aprobacion_cliente", label: "Aprobación del cliente" },
  { value: "observacion_tecnica", label: "Observación técnica" },
  { value: "entrega", label: "Entrega" },
  { value: "interno", label: "Interno" },
] as const;

const ADD_ITEM_TYPES = [
  { value: "service", label: "Servicio" },
  { value: "part", label: "Repuesto" },
  { value: "additional_labor", label: "Mano de obra" },
  { value: "other", label: "Otro" },
];

// Journey steps for visual progress
const JOURNEY_STEPS = [
  { key: "lead", label: "Lead" },
  { key: "quote_sent", label: "Presupuesto" },
  { key: "bike_received", label: "Recepción" },
  { key: "in_progress", label: "Trabajo" },
  { key: "quality_control", label: "QC" },
  { key: "ready_for_pickup", label: "Retiro" },
  { key: "delivered", label: "Entrega" },
];

const STATUS_ORDER = [
  "lead", "quoted", "quote_sent", "quote_approved",
  "bike_received", "in_inspection", "ready_for_work_order",
  "in_work_order", "in_progress", "quality_control",
  "ready_for_pickup", "delivered", "closed",
];

function getStepState(stepKey: string, currentStatus: string, isCancelled: boolean): "completed" | "current" | "pending" | "cancelled" {
  if (isCancelled) return "cancelled";
  const stepIdx = JOURNEY_STEPS.findIndex(s => s.key === stepKey);
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  const stepStatusIdx = STATUS_ORDER.indexOf(stepKey);
  if (stepStatusIdx < currentIdx) return "completed";
  if (stepKey === currentStatus || (stepIdx !== -1 && STATUS_ORDER.indexOf(JOURNEY_STEPS[stepIdx]?.key ?? "") === currentIdx)) return "current";
  return "pending";
}

function formatCLP(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

export default function TrabajoDetail() {
  const { id } = useParams<{ id: string }>();
  const workCaseId = parseInt(id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: workCase, isLoading } = useGetWorkCase(workCaseId);
  const { data: timeline } = useGetWorkCaseTimeline(workCaseId);
  const recalcMutation = useRecalculateWorkCaseStatus();
  const updateStatus = useUpdateWorkOrderStatus();
  const createItem = useCreateQuoteItem();
  const addComment = useAddWorkCaseComment();
  const assignMechanic = useAssignMechanicToWorkOrder();
  const { data: users } = useListUsers();
  const { data: services } = useListServices();
  const { data: parts } = useListParts();
  const mechanics = (users ?? []).filter((u: any) => u.role === "mechanic" && u.active !== false);

  const [showTimeline, setShowTimeline] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [commentDialog, setCommentDialog] = useState(false);
  const [mechanicDialog, setMechanicDialog] = useState(false);
  const [mechanicDialogWoId, setMechanicDialogWoId] = useState<number | null>(null);
  const [mechanicDialogAutoAdvance, setMechanicDialogAutoAdvance] = useState(false);
  const [selectedMechanicId, setSelectedMechanicId] = useState("");
  const [itemDraft, setItemDraft] = useState({ itemType: "part", description: "", quantity: "1", unitPrice: "0" });
  const [itemCatalogId, setItemCatalogId] = useState("");
  const [itemErr, setItemErr] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState({ commentType: "durante_trabajo", comment: "" });
  const [commentErr, setCommentErr] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetWorkCaseQueryKey(workCaseId) });
    qc.invalidateQueries({ queryKey: getGetWorkCaseTimelineQueryKey(workCaseId) });
  };

  const handleRecalc = () => {
    recalcMutation.mutate({ id: workCaseId }, {
      onSuccess: () => {
        toast({ title: "Estado recalculado" });
        invalidate();
      },
      onError: () => toast({ variant: "destructive", title: "Error al recalcular" }),
    });
  };

  const primaryQuote = (workCase?.linkedQuotes ?? [])[0];

  const openMechanicDialog = (woId: number, autoAdvance: boolean) => {
    setSelectedMechanicId("");
    setMechanicDialogWoId(woId);
    setMechanicDialogAutoAdvance(autoAdvance);
    setMechanicDialog(true);
  };

  const closeMechanicDialog = () => {
    setMechanicDialog(false);
    setMechanicDialogWoId(null);
    setMechanicDialogAutoAdvance(false);
    setSelectedMechanicId("");
  };

  const handleMechanicConfirm = () => {
    if (!selectedMechanicId || mechanicDialogWoId === null) return;
    const woId = mechanicDialogWoId;
    const shouldAdvance = mechanicDialogAutoAdvance;
    assignMechanic.mutate(
      { id: woId, data: { mechanicId: parseInt(selectedMechanicId) } },
      {
        onSuccess: () => {
          closeMechanicDialog();
          invalidate();
          toast({ title: "Mecánico asignado" });
          if (shouldAdvance) {
            updateStatus.mutate(
              { id: woId, data: { status: "in_progress" as any } },
              {
                onSuccess: () => {
                  recalcMutation.mutate({ id: workCaseId }, {
                    onSuccess: () => invalidate(),
                    onError: () => invalidate(),
                  });
                  toast({ title: "Estado actualizado", description: WORK_ORDER_STATUS_LABELS["in_progress"] });
                },
                onError: () => toast({ variant: "destructive", title: "Error al actualizar el estado" }),
              }
            );
          }
        },
        onError: () => toast({ variant: "destructive", title: "Error al asignar el mecánico" }),
      }
    );
  };

  const handleAdvanceWorkOrder = (woId: number, currentStatus: string) => {
    const action = WO_NEXT_ACTION[currentStatus];
    if (!action) return;
    if (action.next === "in_progress" && !workCase?.assignedMechanicId) {
      openMechanicDialog(woId, true);
      return;
    }
    updateStatus.mutate({ id: woId, data: { status: action.next as any } }, {
      onSuccess: () => {
        recalcMutation.mutate({ id: workCaseId }, {
          onSuccess: () => invalidate(),
          onError: () => invalidate(),
        });
        toast({ title: "Estado actualizado", description: WORK_ORDER_STATUS_LABELS[action.next] });
      },
      onError: () => toast({ variant: "destructive", title: "Error al actualizar el estado" }),
    });
  };

  const handleAddItem = () => {
    setItemErr(null);
    if (!primaryQuote) { setItemErr("No hay un presupuesto vinculado."); return; }
    if (!itemDraft.description.trim()) { setItemErr("Ingresa una descripción"); return; }
    const qty = parseFloat(itemDraft.quantity);
    const price = parseFloat(itemDraft.unitPrice);
    if (isNaN(qty) || qty <= 0) { setItemErr("Cantidad inválida"); return; }
    if (isNaN(price) || price < 0) { setItemErr("Precio inválido"); return; }
    createItem.mutate({
      id: primaryQuote.id!,
      data: {
        itemType: itemDraft.itemType as any,
        origin: "during_work",
        description: itemDraft.description.trim(),
        quantity: qty,
        unitPrice: price,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Adicional agregado", description: "Agregado al presupuesto y a la OT activa." });
        setItemDialog(false);
        setItemDraft({ itemType: "part", description: "", quantity: "1", unitPrice: "0" });
        setItemCatalogId("");
        invalidate();
      },
      onError: () => toast({ variant: "destructive", title: "Error al agregar el adicional" }),
    });
  };

  const handleAddComment = () => {
    setCommentErr(null);
    if (!commentDraft.comment.trim()) { setCommentErr("Escribe un comentario"); return; }
    addComment.mutate({
      id: workCaseId,
      data: { commentType: commentDraft.commentType as any, comment: commentDraft.comment.trim() },
    }, {
      onSuccess: () => {
        toast({ title: "Comentario agregado" });
        setCommentDialog(false);
        setCommentDraft({ commentType: "durante_trabajo", comment: "" });
        invalidate();
      },
      onError: () => toast({ variant: "destructive", title: "Error al agregar el comentario" }),
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  if (!workCase) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Briefcase className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p>Trabajo no encontrado.</p>
        <Link href="/trabajos"><Button variant="outline" className="mt-4">Volver</Button></Link>
      </div>
    );
  }

  const wcStatus = workCase.status ?? "lead";
  const isCancelled = wcStatus === "cancelled" || wcStatus === "closed";
  const currentStatusIdx = STATUS_ORDER.indexOf(wcStatus);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Link href="/trabajos">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold font-mono text-primary">{workCase.workCaseNumber}</h1>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[wcStatus] ?? ""}`}>
              {STATUS_LABELS[wcStatus] ?? wcStatus}
            </span>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">{workCase.clientName ?? "—"}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRecalc}
          disabled={recalcMutation.isPending}
          className="flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${recalcMutation.isPending ? "animate-spin" : ""}`} />
          Recalcular
        </Button>
      </div>

      {/* Journey timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recorrido del trabajo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {JOURNEY_STEPS.map((step, i) => {
              const stateIdx = STATUS_ORDER.indexOf(step.key);
              let state: "completed" | "current" | "pending" | "cancelled";
              if (isCancelled) state = i <= 0 ? "completed" : "cancelled";
              else if (stateIdx < currentStatusIdx) state = "completed";
              else if (stateIdx === currentStatusIdx || (i < JOURNEY_STEPS.length - 1 && STATUS_ORDER.indexOf(JOURNEY_STEPS[i + 1]?.key ?? "") > currentStatusIdx && stateIdx <= currentStatusIdx)) state = "current";
              else state = "pending";

              // simplified: completed if statusOrder index of step <= current
              const simpleCompleted = STATUS_ORDER.indexOf(step.key) < currentStatusIdx;
              const simpleCurrent = STATUS_ORDER.indexOf(step.key) === currentStatusIdx ||
                (i > 0 && STATUS_ORDER.indexOf(JOURNEY_STEPS[i - 1]?.key ?? "") < currentStatusIdx && stateIdx > currentStatusIdx);

              const isCompleted = simpleCompleted && !isCancelled;
              const isCurrent = !isCancelled && !simpleCompleted && stateIdx <= currentStatusIdx + 1 &&
                (i === JOURNEY_STEPS.findIndex(s => STATUS_ORDER.indexOf(s.key) >= currentStatusIdx));

              return (
                <div key={step.key} className="flex items-center flex-1 min-w-0">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                      isCancelled && i > 0 ? "border-red-200 bg-red-50 text-red-400" :
                      isCompleted ? "border-green-500 bg-green-500 text-white" :
                      isCurrent ? "border-primary bg-primary text-primary-foreground" :
                      "border-gray-200 bg-white text-gray-400"
                    }`}>
                      {isCancelled && i > 0 ? <XCircle className="h-4 w-4" /> :
                       isCompleted ? <CheckCircle2 className="h-4 w-4" /> :
                       isCurrent ? i + 1 :
                       <Circle className="h-3 w-3" />}
                    </div>
                    <span className={`text-[10px] mt-1 text-center whitespace-nowrap font-medium ${
                      isCurrent ? "text-primary" : isCompleted ? "text-green-600" : "text-muted-foreground"
                    }`}>{step.label}</span>
                  </div>
                  {i < JOURNEY_STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 ${isCompleted ? "bg-green-400" : "bg-gray-200"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Client & bike */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cliente y bicicleta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <Link href={`/clientes/${workCase.clientId}`}>
                <span className="font-medium hover:underline text-primary cursor-pointer">{workCase.clientName ?? "—"}</span>
              </Link>
            </div>
            {workCase.bicycleName && (
              <div className="flex items-center gap-2">
                <Bike className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{workCase.bicycleName}</span>
              </div>
            )}
            {workCase.mechanicName ? (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground text-sm">Mecánico: {workCase.mechanicName}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs text-muted-foreground ml-auto"
                  onClick={() => {
                    const activeWo = (workCase.linkedWorkOrders ?? []).find(
                      (wo) => !["delivered", "cancelled"].includes(wo.status ?? "")
                    ) ?? (workCase.linkedWorkOrders ?? [])[0];
                    if (!activeWo?.id) return;
                    setSelectedMechanicId(workCase.assignedMechanicId ? String(workCase.assignedMechanicId) : "");
                    openMechanicDialog(activeWo.id, false);
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-sm text-primary font-medium"
                  onClick={() => {
                    const activeWo = (workCase.linkedWorkOrders ?? []).find(
                      (wo) => !["delivered", "cancelled"].includes(wo.status ?? "")
                    ) ?? (workCase.linkedWorkOrders ?? [])[0];
                    if (!activeWo?.id) return;
                    openMechanicDialog(activeWo.id, false);
                  }}
                  data-testid="button-assign-mechanic"
                >
                  Asignar mecánico
                </Button>
              </div>
            )}
            {workCase.originChannel && (
              <div className="text-sm text-muted-foreground">Canal: {workCase.originChannel}</div>
            )}
            {workCase.initialRequirement && (
              <div className="text-sm mt-2 p-2 bg-muted rounded-md">{workCase.initialRequirement}</div>
            )}
          </CardContent>
        </Card>

        {/* Amounts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Montos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-sm">Monto estimado</span>
              <span className="font-bold text-lg">{formatCLP(workCase.totalEstimatedAmount)}</span>
            </div>
            {workCase.totalEstimatedLaborHours !== null && workCase.totalEstimatedLaborHours !== undefined && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">Horas M.O.</span>
                <span className="font-medium">{Number(workCase.totalEstimatedLaborHours).toFixed(1)}h</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Creado</span>
              <span>{new Date(workCase.createdAt ?? "").toLocaleDateString("es-CL")}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Actualizado</span>
              <span>{new Date(workCase.updatedAt ?? "").toLocaleDateString("es-CL")}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Linked documents */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Quotes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              Presupuestos ({workCase.linkedQuotes?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(workCase.linkedQuotes ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin presupuestos vinculados</p>
            ) : (
              (workCase.linkedQuotes ?? []).map((q) => (
                <Link key={q.id} href={`/presupuestos/${q.id}`}>
                  <div className="p-2 rounded-md hover:bg-muted cursor-pointer space-y-0.5">
                    <div className="flex justify-between items-center">
                      <p className="font-mono text-sm font-bold text-primary">{q.quoteNumber}</p>
                      <span className="text-sm font-medium">
                        {q.total ? new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(q.total)) : "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{QUOTE_STATUS_LABELS[q.status ?? ""] ?? q.status}</p>
                    {(q as any).customerNotes && <p className="text-xs text-muted-foreground line-clamp-2">Cliente: {(q as any).customerNotes}</p>}
                    {(q as any).internalNotes && <p className="text-xs text-muted-foreground line-clamp-2">Interno: {(q as any).internalNotes}</p>}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Receptions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Inbox className="h-4 w-4 text-sky-600" />
              Recepciones ({workCase.linkedReceptions?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(workCase.linkedReceptions ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin recepciones vinculadas</p>
            ) : (
              (workCase.linkedReceptions ?? []).map((r) => (
                <Link key={r.id} href={`/recepciones/${r.id}`}>
                  <div className="p-2 rounded-md hover:bg-muted cursor-pointer space-y-0.5">
                    <div className="flex justify-between items-center">
                      <p className="font-mono text-sm font-bold text-primary">{r.receptionNumber}</p>
                      <span className="text-xs text-muted-foreground">{new Date(r.createdAt ?? "").toLocaleDateString("es-CL")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{RECEPTION_STATUS_LABELS[r.status ?? ""] ?? r.status}</p>
                    {(r as any).customerNotes && <p className="text-xs text-muted-foreground line-clamp-2">Cliente: {(r as any).customerNotes}</p>}
                    {(r as any).internalNotes && <p className="text-xs text-muted-foreground line-clamp-2">Interno: {(r as any).internalNotes}</p>}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Work orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-orange-600" />
              Órdenes de trabajo ({workCase.linkedWorkOrders?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(workCase.linkedWorkOrders ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin OTs vinculadas</p>
            ) : (
              (workCase.linkedWorkOrders ?? []).map((wo) => {
                const nextAction = WO_NEXT_ACTION[wo.status ?? ""];
                return (
                  <div key={wo.id} className="p-2 rounded-md border space-y-2">
                    <Link href={`/ordenes/${wo.id}`}>
                      <div className="cursor-pointer space-y-0.5 hover:bg-muted rounded-md p-1 -m-1">
                        <div className="flex justify-between items-center">
                          <p className="font-mono text-sm font-bold text-primary">{wo.workOrderNumber}</p>
                          <span className="text-sm font-medium">
                            {wo.total ? new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(wo.total)) : "—"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{WORK_ORDER_STATUS_LABELS[wo.status ?? ""] ?? wo.status}</p>
                        {(wo as any).customerNotes && <p className="text-xs text-muted-foreground line-clamp-2">Cliente: {(wo as any).customerNotes}</p>}
                        {(wo as any).internalNotes && <p className="text-xs text-muted-foreground line-clamp-2">Interno: {(wo as any).internalNotes}</p>}
                      </div>
                    </Link>
                    {nextAction && wo.id !== undefined && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full flex items-center gap-1.5"
                        disabled={updateStatus.isPending}
                        onClick={() => handleAdvanceWorkOrder(wo.id!, wo.status ?? "")}
                        data-testid={`button-advance-wo-${wo.id}`}
                      >
                        <Play className="h-3.5 w-3.5" />
                        {nextAction.label}
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Acciones rápidas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            className="flex-1 flex items-center gap-2"
            onClick={() => { setItemErr(null); setItemDialog(true); }}
            disabled={!primaryQuote}
            data-testid="button-open-add-item"
          >
            <PlusCircle className="h-4 w-4" />
            Agregar adicional
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex items-center gap-2"
            onClick={() => { setCommentErr(null); setCommentDialog(true); }}
            data-testid="button-open-add-comment"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Agregar comentario
          </Button>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowTimeline(v => !v)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Historial de eventos ({(timeline ?? []).length})
            </CardTitle>
            {showTimeline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showTimeline && (
          <CardContent>
            {(timeline ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>
            ) : (
              <div className="space-y-3">
                {(timeline ?? []).map((e: any, i: number) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      {i < (timeline ?? []).length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                    </div>
                    <div className="pb-3">
                      <p className="font-medium">{e.action}</p>
                      {e.comment && <p className="text-muted-foreground text-xs mt-0.5">{e.comment}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {e.userName ?? "Sistema"} · {new Date(e.createdAt).toLocaleString("es-CL")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Add item dialog */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar adicional</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Se agrega al presupuesto {primaryQuote?.quoteNumber ?? ""} y a la OT activa como ítem pendiente.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={itemDraft.itemType} onValueChange={(val) => { setItemDraft((d) => ({ ...d, itemType: val })); setItemCatalogId(""); }}>
                <SelectTrigger data-testid="select-additem-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADD_ITEM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {itemDraft.itemType === "service" && (services ?? []).length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Elegir del catálogo (opcional)</Label>
                <Select value={itemCatalogId} onValueChange={(v) => {
                  setItemCatalogId(v);
                  const svc = (services ?? []).find((s: any) => String(s.id) === v);
                  if (svc) setItemDraft((d) => ({ ...d, description: (svc as any).name, unitPrice: String((svc as any).basePrice ?? 0) }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Elegir servicio del catálogo..." /></SelectTrigger>
                  <SelectContent>
                    {(services ?? []).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}{s.basePrice ? ` — ${formatCLP(s.basePrice)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {itemDraft.itemType === "part" && (parts ?? []).length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Elegir del catálogo (opcional)</Label>
                <Select value={itemCatalogId} onValueChange={(v) => {
                  setItemCatalogId(v);
                  const part = (parts ?? []).find((p: any) => String(p.id) === v);
                  if (part) setItemDraft((d) => ({ ...d, description: (part as any).name, unitPrice: String((part as any).suggestedPrice ?? 0) }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Elegir repuesto del catálogo..." /></SelectTrigger>
                  <SelectContent>
                    {(parts ?? []).map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}{p.suggestedPrice ? ` — ${formatCLP(p.suggestedPrice)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Descripción</Label>
              <Input value={itemDraft.description} onChange={(e) => setItemDraft((d) => ({ ...d, description: e.target.value }))} data-testid="input-additem-description" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Cantidad</Label>
                <Input type="number" inputMode="decimal" min="0" value={itemDraft.quantity} onChange={(e) => setItemDraft((d) => ({ ...d, quantity: e.target.value }))} data-testid="input-additem-quantity" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Precio unit.</Label>
                <Input type="number" inputMode="numeric" min="0" value={itemDraft.unitPrice} onChange={(e) => setItemDraft((d) => ({ ...d, unitPrice: e.target.value }))} data-testid="input-additem-price" />
              </div>
            </div>
            {itemErr && <p className="text-sm text-destructive">{itemErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(false)}>Cancelar</Button>
            <Button onClick={handleAddItem} disabled={createItem.isPending} data-testid="button-submit-additem">
              {createItem.isPending ? "Agregando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign mechanic dialog */}
      <Dialog open={mechanicDialog} onOpenChange={(open) => { if (!open) closeMechanicDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar mecánico</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Mecánico</Label>
              {mechanics.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay mecánicos activos registrados.</p>
              ) : (
                <Select value={selectedMechanicId} onValueChange={setSelectedMechanicId}>
                  <SelectTrigger data-testid="select-mechanic-dialog">
                    <SelectValue placeholder="Seleccionar mecánico..." />
                  </SelectTrigger>
                  <SelectContent>
                    {mechanics.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeMechanicDialog}>Cancelar</Button>
            <Button
              onClick={handleMechanicConfirm}
              disabled={!selectedMechanicId || assignMechanic.isPending}
              data-testid="button-confirm-mechanic"
            >
              {assignMechanic.isPending ? "Asignando..." : mechanicDialogAutoAdvance ? "Asignar e iniciar" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add comment dialog */}
      <Dialog open={commentDialog} onOpenChange={setCommentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar comentario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Tipo de comentario</Label>
              <Select value={commentDraft.commentType} onValueChange={(val) => setCommentDraft((d) => ({ ...d, commentType: val }))}>
                <SelectTrigger data-testid="select-comment-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Comentario</Label>
              <Textarea rows={3} value={commentDraft.comment} onChange={(e) => setCommentDraft((d) => ({ ...d, comment: e.target.value }))} data-testid="textarea-comment" />
            </div>
            {commentErr && <p className="text-sm text-destructive">{commentErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommentDialog(false)}>Cancelar</Button>
            <Button onClick={handleAddComment} disabled={addComment.isPending} data-testid="button-submit-comment">
              {addComment.isPending ? "Agregando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
