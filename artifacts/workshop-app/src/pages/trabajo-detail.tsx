import { useParams, Link } from "wouter";
import {
  useGetWorkCase,
  useGetWorkCaseTimeline,
  useGetWorkOrder,
  useUpdateWorkOrderStatus,
  useCancelWorkOrderItem,
  useSetWorkOrderItemWarranty,
  useAddWorkOrderItem,
  useDecideWorkOrderItem,
  useShareWorkOrder,
  useAddWorkCaseComment,
  useAssignMechanicToWorkOrder,
  useListUsers,
  useGetMe,
  useGetWorkshopSettings,
  useSetWorkOrderQuoteApproval,
  useListServices,
  useListParts,
  getGetWorkCaseQueryKey,
  getGetWorkCaseTimelineQueryKey,
  getGetWorkOrderQueryKey,
  type WorkOrderItem,
  type WorkOrderShare,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useWorkers } from "@/hooks/use-workers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Briefcase, User, Bike, ChevronDown, ChevronUp, Clock, CheckCircle2, Circle, XCircle,
  Play, MessageSquarePlus, PlusCircle, Send, Copy, ExternalLink, MessageCircle, Check, X,
  ClipboardCheck, Eye, FileText, FileDown, CalendarDays, Pencil, Wallet, AlertTriangle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

import { WO_STATUS_LABELS, WO_STATUS_COLORS, WO_STEPS, WO_NEXT_ACTION, balanceDue, formatCLP } from "@/lib/work-status";
import { WorkOrderDatesCard } from "@/components/trabajo/dates-card";
import { ChecklistCard } from "@/components/trabajo/checklist-card";
import { WorkOrderMenu } from "@/components/trabajo/work-order-menu";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { paymentReminder } from "@/lib/whatsapp";
import { PhotosCard } from "@/components/trabajo/photos-card";
import { EconomicsCard } from "@/components/inventory/economics-card";
import { SetupCard } from "@/components/trabajo/setup-card";
import { whatsappLink } from "@/lib/whatsapp";

// Ficha del taller: un trabajo = una OT que se va actualizando.
// Presupuesto y recepción siguen existiendo por dentro, pero no se muestran como documentos aparte.

const COMMENT_TYPES = [
  { value: "durante_trabajo", label: "Durante el trabajo" },
  { value: "observacion_tecnica", label: "Observación técnica" },
  { value: "recepcion", label: "Recepción" },
  { value: "aprobacion_cliente", label: "Aprobación del cliente" },
  { value: "entrega", label: "Entrega" },
  { value: "interno", label: "Interno" },
] as const;

const ADD_ITEM_TYPES = [
  { value: "service", label: "Servicio" },
  { value: "part", label: "Repuesto" },
  { value: "additional_labor", label: "Mano de obra" },
  { value: "discount", label: "Descuento" },
  { value: "other", label: "Otro" },
];

const ITEM_TYPE_LABELS: Record<string, string> = {
  service: "Servicio", part: "Repuesto", additional_labor: "Mano de obra", diagnosis: "Diagnóstico",
  discount: "Descuento", other: "Otro", recommendation: "Recomendación",
};

const EVENT_LABELS: Record<string, string> = {
  work_case_created: "Trabajo creado",
  work_order_created: "OT creada",
  status_changed: "Cambio de estado",
  mechanic_assigned: "Mecánico asignado",
  additional_item_added: "Adicional agregado",
  item_decision: "Aprobación de ítem",
  item_completed: "Ítem completado",
  item_cancelled: "Ítem quitado",
  work_order_cancelled: "Trabajo cancelado",
  item_started: "Ítem iniciado",
  work_case_status_changed: "Estado del trabajo",
  comment_recepcion: "Comentario · Recepción",
  comment_durante_trabajo: "Comentario · Durante el trabajo",
  comment_aprobacion_cliente: "Comentario · Aprobación cliente",
  comment_observacion_tecnica: "Comentario · Observación técnica",
  comment_entrega: "Comentario · Entrega",
  comment_interno: "Comentario · Interno",
  payment_registered: "Pago registrado",
  payment_removed: "Pago anulado",
  estimate_recalculated: "Término estimado recalculado",
  photo_added: "Foto agregada",
  photo_deleted: "Foto eliminada",
};

// Eventos de plomería interna (presupuesto/recepción ocultos) que no aportan al taller.
const HIDDEN_EVENTS = new Set([
  "quote_created", "reception_created", "work_case_status_changed",
  "quote_linked_to_work_case", "reception_linked_to_work_case", "work_order_linked_to_work_case",
]);

function eventDetail(e: any): string | null {
  if (e.action === "status_changed" && e.newStatus) {
    return `${WO_STATUS_LABELS[e.previousStatus] ?? e.previousStatus ?? ""} → ${WO_STATUS_LABELS[e.newStatus] ?? e.newStatus}`;
  }
  if (e.action === "quote_approved") return e.comment ?? "Cotización aprobada";
  if (e.action === "item_decision") {
    const who = e.previousStatus === "client" ? "El cliente" : "El taller";
    return `${who} ${e.newStatus === "approved" ? "aprobó" : "rechazó"}: ${e.comment ?? ""}`;
  }
  return e.comment ?? null;
}

function ApprovalBadge({ item }: { item: WorkOrderItem }) {
  if (item.approvalStatus === "pending") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[11px]"><Clock className="h-3 w-3" />Esperando cliente</span>;
  }
  if (item.approvalStatus === "rejected") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[11px]"><X className="h-3 w-3" />Rechazado</span>;
  }
  if (item.origin === "additional") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 text-[11px]"><Check className="h-3 w-3" />Aprobado{item.approvalDecidedBy === "client" ? " por cliente" : ""}</span>;
  }
  return null;
}

export default function TrabajoDetail() {
  const { id } = useParams<{ id: string }>();
  const workCaseId = parseInt(id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: workCase, isLoading } = useGetWorkCase(workCaseId);
  const { data: rawTimeline } = useGetWorkCaseTimeline(workCaseId);
  const timeline = (rawTimeline ?? []).filter((e: any) => !HIDDEN_EVENTS.has(e.action));

  // La OT vigente del trabajo (la última no cancelada; si todas lo están, la última).
  const linkedWOs = workCase?.linkedWorkOrders ?? [];
  const activeWoRef = [...linkedWOs].reverse().find(wo => wo.status !== "cancelled") ?? linkedWOs[linkedWOs.length - 1];
  const woId = activeWoRef?.id ?? 0;
  const { data: wo } = useGetWorkOrder(woId, { query: { enabled: !!woId, queryKey: getGetWorkOrderQueryKey(woId) } });

  const updateStatus = useUpdateWorkOrderStatus();
  const addItem = useAddWorkOrderItem();
  const decideItem = useDecideWorkOrderItem();
  const share = useShareWorkOrder();
  const addComment = useAddWorkCaseComment();
  const assignMechanic = useAssignMechanicToWorkOrder();
  const { data: users } = useListUsers();
  const { data: me } = useGetMe();
  const { data: settings } = useGetWorkshopSettings();
  const quoteApproval = useSetWorkOrderQuoteApproval();
  const { data: services } = useListServices();
  const { data: parts } = useListParts();
  const { workers: mechanics, solo } = useWorkers();

  const [showTimeline, setShowTimeline] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [commentDialog, setCommentDialog] = useState(false);
  const [mechanicDialog, setMechanicDialog] = useState(false);
  const [mechanicDialogAutoAdvance, setMechanicDialogAutoAdvance] = useState(false);
  const [selectedMechanicId, setSelectedMechanicId] = useState("");
  const [shareData, setShareData] = useState<WorkOrderShare | null>(null);
  // Si el aviso se abrió solo (trabajo recién creado, bici lista), el título explica por qué.
  const [notifyTitle, setNotifyTitle] = useState<string | null>(null);
  const emptyItem = { itemType: "part", description: "", quantity: "1", unitPrice: "", alreadyApproved: false, customerProvided: false };
  const [itemDraft, setItemDraft] = useState(emptyItem);
  const [itemCatalogId, setItemCatalogId] = useState("");
  const [itemErr, setItemErr] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState({ commentType: "durante_trabajo", comment: "", visibleToClient: false });
  const [commentErr, setCommentErr] = useState<string | null>(null);
  const [removeItem, setRemoveItem] = useState<WorkOrderItem | null>(null);
  const cancelItem = useCancelWorkOrderItem();
  const warrantyItem = useSetWorkOrderItemWarranty();
  // Cambió la cotización (ítem agregado, quitado o pasado por garantía): se ofrece avisar al cliente.
  const [quoteChanged, setQuoteChanged] = useState(false);

  const confirmRemoveItem = () => {
    if (!woId || !removeItem) return;
    cancelItem.mutate({ id: woId, itemId: removeItem.id }, {
      onSuccess: () => { toast({ title: "Ítem quitado", description: removeItem.description }); setRemoveItem(null); setQuoteChanged(true); invalidate(); },
      onError: (e) => toast({ variant: "destructive", title: apiError(e, "No se pudo quitar el ítem") }),
    });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetWorkCaseQueryKey(workCaseId) });
    qc.invalidateQueries({ queryKey: getGetWorkCaseTimelineQueryKey(workCaseId) });
    if (woId) qc.invalidateQueries({ queryKey: getGetWorkOrderQueryKey(woId) });
  };
  const apiError = (e: any, fallback: string) => e?.data?.error ?? fallback;

  const advanceTo = (next: string) => {
    if (!woId) return;
    updateStatus.mutate({ id: woId, data: { status: next as any } }, {
      onSuccess: () => {
        invalidate();
        toast({ title: "Estado actualizado", description: WO_STATUS_LABELS[next] });
        if (next === "ready_for_pickup") openShare("¡Bici lista! Avisa a tu cliente");
      },
      onError: (e) => toast({ variant: "destructive", title: apiError(e, "Error al actualizar el estado") }),
    });
  };

  const handleAdvance = () => {
    const action = wo ? WO_NEXT_ACTION[wo.status] : undefined;
    if (!action) return;
    // Sin mecánico: la API lo asigna sola si quien inicia hace trabajos o si hay uno solo.
    // Solo hay que elegir cuando hay varios y quien inicia no repara.
    const meWorks = mechanics.some((m: any) => m.id === me?.id);
    if (action.next === "in_progress" && !wo?.mechanicId && !solo && !meWorks) {
      setSelectedMechanicId("");
      setMechanicDialogAutoAdvance(true);
      setMechanicDialog(true);
      return;
    }
    advanceTo(action.next);
  };

  const handleMechanicConfirm = () => {
    if (!selectedMechanicId || !woId) return;
    const shouldAdvance = mechanicDialogAutoAdvance;
    assignMechanic.mutate({ id: woId, data: { mechanicId: parseInt(selectedMechanicId) } }, {
      onSuccess: () => {
        setMechanicDialog(false);
        toast({ title: "Mecánico asignado" });
        if (shouldAdvance) advanceTo("in_progress"); else invalidate();
      },
      onError: () => toast({ variant: "destructive", title: "Error al asignar el mecánico" }),
    });
  };

  const handleAddItem = () => {
    setItemErr(null);
    if (!woId) return;
    if (!itemDraft.description.trim()) { setItemErr("Ingresa una descripción"); return; }
    const qty = parseFloat(itemDraft.quantity);
    const price = parseFloat(itemDraft.unitPrice);
    if (isNaN(qty) || qty <= 0) { setItemErr("Cantidad inválida"); return; }
    if (isNaN(price) || price < 0) { setItemErr("Precio inválido"); return; }
    const catalogId = itemCatalogId ? parseInt(itemCatalogId) : null;
    // Si el repuesto lo trae el cliente, no se cobra ni se descuenta del stock.
    const fromClient = itemDraft.customerProvided && itemDraft.itemType === "part";
    addItem.mutate({
      id: woId,
      data: {
        itemType: itemDraft.itemType as any,
        description: fromClient ? `${itemDraft.description.trim()} · lo trae el cliente` : itemDraft.description.trim(),
        quantity: qty,
        unitPrice: fromClient ? 0 : price,
        serviceId: itemDraft.itemType === "service" ? catalogId : null,
        partId: itemDraft.itemType === "part" && !fromClient ? catalogId : null,
        alreadyApproved: itemDraft.alreadyApproved,
      },
    }, {
      onSuccess: () => {
        toast({
          title: "Adicional agregado",
          description: itemDraft.alreadyApproved ? "Quedó aprobado y suma al total." : "Quedó esperando la aprobación del cliente.",
        });
        setItemDialog(false);
        setItemDraft(emptyItem);
        setItemCatalogId("");
        setQuoteChanged(true);
        invalidate();
      },
      onError: (e) => setItemErr(apiError(e, "Error al agregar el adicional")),
    });
  };

  const handleDecide = (item: WorkOrderItem, decision: "approved" | "rejected") => {
    if (!woId) return;
    decideItem.mutate({ id: woId, itemId: item.id, data: { decision } }, {
      onSuccess: () => { invalidate(); toast({ title: decision === "approved" ? "Marcado como aprobado" : "Marcado como rechazado" }); },
      onError: (e) => toast({ variant: "destructive", title: apiError(e, "No se pudo guardar") }),
    });
  };

  const openShare = (title: string | null, message?: string) => {
    if (!woId) return;
    share.mutate({ id: woId }, {
      onSuccess: (data) => { setNotifyTitle(title); setShareData(message ? { ...data, message } : data); },
      onError: () => toast({ variant: "destructive", title: "No se pudo generar el link" }),
    });
  };
  const handleShare = () => openShare(null);
  const notifyQuoteChange = () => {
    const first = (wo?.clientName ?? "").split(" ")[0];
    setQuoteChanged(false);
    openShare("Cotización actualizada: avisa a tu cliente",
      `Hola${first ? ` ${first}` : ""}, actualizamos la cotización de tu bicicleta (orden ${wo?.workOrderNumber}). El total ahora es ${formatCLP(wo?.total)}. Revísala y apruébala aquí:`);
  };
  const handleWarranty = (item: WorkOrderItem) => {
    if (!woId) return;
    warrantyItem.mutate({ id: woId, itemId: item.id }, {
      onSuccess: () => { toast({ title: "Pasado por garantía", description: "Queda sin cobro para el cliente." }); setQuoteChanged(true); invalidate(); },
      onError: (e) => toast({ variant: "destructive", title: apiError(e, "No se pudo pasar por garantía") }),
    });
  };

  // Al llegar desde "Crear trabajo" (?avisar=1) se ofrece avisar al cliente una sola vez.
  const noticeDone = useRef(false);
  useEffect(() => {
    if (noticeDone.current || !woId || !wo) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("avisar") !== "1") return;
    noticeDone.current = true;
    url.searchParams.delete("avisar");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    openShare("Trabajo creado: avisa a tu cliente");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId, wo]);

  const publicUrl = shareData ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${shareData.path}` : "";
  // Sin teléfono válido, wa.me sin número deja elegir el contacto en WhatsApp.
  const whatsappUrl = shareData
    ? whatsappLink(shareData.clientPhone, `${shareData.message}\n${publicUrl}`)
      ?? `https://wa.me/?text=${encodeURIComponent(`${shareData.message}\n${publicUrl}`)}`
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast({ title: "Link copiado" });
    } catch {
      toast({ variant: "destructive", title: "No se pudo copiar", description: publicUrl });
    }
  };

  const handleAddComment = () => {
    setCommentErr(null);
    if (!commentDraft.comment.trim()) { setCommentErr("Escribe un comentario"); return; }
    addComment.mutate({
      id: workCaseId,
      data: {
        commentType: commentDraft.commentType as any,
        comment: commentDraft.comment.trim(),
        visibleToClient: commentDraft.visibleToClient,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Comentario agregado", description: commentDraft.visibleToClient ? "El cliente lo verá en su seguimiento." : undefined });
        setCommentDialog(false);
        setCommentDraft({ commentType: "durante_trabajo", comment: "", visibleToClient: false });
        invalidate();
      },
      onError: () => toast({ variant: "destructive", title: "Error al agregar el comentario" }),
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4">
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

  const items = (wo?.items ?? []).filter(i => i.status !== "cancelled");
  const pendingItems = items.filter(i => i.approvalStatus === "pending");
  const pendingAmount = pendingItems.reduce((s, i) => s + (i.itemType === "discount" ? -i.total : i.total), 0);
  const woStatus = wo?.status ?? "";
  const isClosed = woStatus === "delivered" || woStatus === "cancelled";
  const stepIdx = WO_STEPS.indexOf(woStatus);
  const nextAction = WO_NEXT_ACTION[woStatus];
  const checklist = wo?.checklist ?? [];
  // Saludo prellenado al abrir el chat; el taller lo puede editar antes de enviar.
  const chatGreeting = wo
    ? `Hola ${(workCase.clientName ?? "").split(" ")[0]}, te escribo del taller por tu ${workCase.bicycleName ?? "bicicleta"} (${wo.workOrderNumber}).`
    : undefined;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4 pb-24 md:pb-8">
      {/* Encabezado */}
      <div className="flex items-start gap-2">
        <Link href="/trabajos">
          <Button variant="ghost" size="icon" className="-ml-2"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold font-mono text-primary">{wo?.workOrderNumber ?? workCase.workCaseNumber}</h1>
            {wo && (
              <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium border", WO_STATUS_COLORS[woStatus])}>
                {WO_STATUS_LABELS[woStatus] ?? woStatus}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">{workCase.clientName ?? "—"} · {workCase.bicycleName ?? "Sin bicicleta"}</p>
        </div>
        {wo && (
          <div className="flex items-center gap-1">
            <WhatsAppButton phone={wo.clientPhone} text={chatGreeting} />
            <WorkOrderMenu wo={wo} onChanged={invalidate} />
          </div>
        )}
      </div>

      {!wo ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground space-y-3">
            <p>Este trabajo todavía no tiene una orden de trabajo.</p>
            {(workCase.linkedQuotes ?? []).map(q => (
              <Link key={q.id} href={`/presupuestos/${q.id}`}>
                <Button variant="outline" size="sm" className="mr-2"><FileText className="h-4 w-4 mr-1" />Ver presupuesto {q.quoteNumber}</Button>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Entregada y sin cobrar del todo */}
          {balanceDue(wo) > 0 && (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm text-red-800 flex flex-wrap items-center gap-x-3 gap-y-2" role="alert" data-testid="alert-unpaid">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
              <span className="flex-1 min-w-48">
                <strong>Pendiente de cobro: {formatCLP(balanceDue(wo))}</strong>
                <span className="block text-xs text-red-700">{wo.paidAt ? "El cliente abonó, pero falta saldo." : "Entregada sin pago registrado."} Registra el pago en la tarjeta de fechas.</span>
              </span>
              <WhatsAppButton phone={wo.clientPhone} label="Recordar pago"
                text={paymentReminder(wo.clientName, settings?.name, formatCLP(balanceDue(wo)), wo.workOrderNumber, settings?.paymentInfo)} />
            </div>
          )}

          {quoteChanged && !isClosed && (
            <div className="rounded-lg border-2 border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="quote-changed">
              <span className="flex-1 min-w-48">Cambió la cotización (total {formatCLP(wo.total)}). ¿Le avisamos a tu cliente?</span>
              <Button size="sm" onClick={notifyQuoteChange} data-testid="button-notify-quote">Avisar por WhatsApp</Button>
              <Button size="sm" variant="ghost" onClick={() => setQuoteChanged(false)}>Ahora no</Button>
            </div>
          )}

          {/* Aprobación de la cotización (opcional: solo se registra) */}
          {woStatus !== "cancelled" && (
            <div className={cn("rounded-lg border p-2.5 text-sm flex flex-wrap items-center gap-2", wo.quoteApprovedAt ? "border-green-200 bg-green-50 text-green-800" : "bg-muted/40 text-muted-foreground")} data-testid="quote-approval">
              {wo.quoteApprovedAt ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Clock className="h-4 w-4 shrink-0" />}
              <span className="flex-1 min-w-40">
                {wo.quoteApprovedAt
                  ? `Cotización aprobada ${wo.quoteApprovedBy === "client" ? "por el cliente desde su link" : "(registrada por el taller)"} el ${new Date(wo.quoteApprovedAt).toLocaleDateString("es-CL", { day: "numeric", month: "short" })}`
                  : "El cliente aún no ha aprobado la cotización (opcional)."}
              </span>
              {!isClosed && (
                <Button variant="outline" size="sm" className="h-7" disabled={quoteApproval.isPending}
                  onClick={() => quoteApproval.mutate({ id: wo.id, data: { approved: !wo.quoteApprovedAt } }, {
                    onSuccess: () => invalidate(),
                    onError: () => toast({ variant: "destructive", title: "No se pudo guardar" }),
                  })}>
                  {wo.quoteApprovedAt ? "Quitar" : "Marcar como aprobada"}
                </Button>
              )}
            </div>
          )}

          {/* Acciones principales */}
          {woStatus === "cancelled" ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center gap-2">
              <XCircle className="h-4 w-4 shrink-0" /> Este trabajo está cancelado.
            </div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-2 gap-2">
                {nextAction ? (
                  <Button onClick={handleAdvance} disabled={updateStatus.isPending} className="h-11" data-testid="button-advance">
                    <Play className="h-4 w-4 mr-2" /> {nextAction.label}
                  </Button>
                ) : (
                  <div className="h-11 flex items-center justify-center gap-2 text-sm text-green-700 border border-green-200 bg-green-50 rounded-md">
                    <CheckCircle2 className="h-4 w-4" /> Bicicleta entregada
                  </div>
                )}
                <Button variant="outline" onClick={handleShare} disabled={share.isPending} className="h-11" data-testid="button-share">
                  <Send className="h-4 w-4 mr-2" /> Enviar al cliente
                </Button>
              </div>
              {/* Móvil: la acción principal queda fija abajo, sobre la navegación. */}
              <div className="md:hidden fixed left-0 right-0 bottom-16 z-40 border-t bg-background/95 backdrop-blur px-4 py-2.5 flex gap-2">
                {nextAction ? (
                  <Button onClick={handleAdvance} disabled={updateStatus.isPending} className="h-11 flex-1" data-testid="button-advance-mobile">
                    <Play className="h-4 w-4 mr-2" /> {nextAction.label}
                  </Button>
                ) : (
                  <div className="h-11 flex-1 flex items-center justify-center gap-2 text-sm text-green-700 border border-green-200 bg-green-50 rounded-md">
                    <CheckCircle2 className="h-4 w-4" /> Entregada
                  </div>
                )}
                <Button variant="outline" onClick={handleShare} disabled={share.isPending} className="h-11 w-11 p-0" aria-label="Enviar al cliente" data-testid="button-share-mobile">
                  <Send className="h-5 w-5" />
                </Button>
              </div>
            </>
          )}

          {/* Recorrido */}
          {woStatus !== "cancelled" && (
            <Card>
              <CardContent className="pt-5 pb-4">
                <ol className="flex items-start">
                  {WO_STEPS.map((st, i) => {
                    const done = i < stepIdx || woStatus === "delivered";
                    const current = i === stepIdx && woStatus !== "delivered";
                    return (
                      <li key={st} className="flex-1 flex flex-col items-center relative min-w-0">
                        {i > 0 && <span className={cn("absolute top-3.5 right-1/2 w-full h-0.5", i <= stepIdx ? "bg-green-400" : "bg-gray-200")} />}
                        <span className={cn("relative z-10 w-7 h-7 rounded-full flex items-center justify-center border-2",
                          done ? "border-green-500 bg-green-500 text-white" :
                          current ? "border-primary bg-primary text-primary-foreground" : "border-gray-200 bg-white text-gray-300")}>
                          {done ? <CheckCircle2 className="h-4 w-4" /> : current ? <span className="text-xs font-bold">{i + 1}</span> : <Circle className="h-3 w-3" />}
                        </span>
                        <span className={cn("text-[10px] mt-1 text-center leading-tight px-0.5",
                          current ? "text-primary font-semibold" : done ? "text-green-700" : "text-muted-foreground")}>
                          {WO_STATUS_LABELS[st]}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}

          <WorkOrderDatesCard wo={wo} onChanged={invalidate} />

          {/* Pendientes del cliente */}
          {pendingItems.length > 0 && !isClosed && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
              <Clock className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">{pendingItems.length} adicional(es) esperando al cliente · {formatCLP(pendingAmount)}</p>
                <p className="text-xs">Envíale el link para que apruebe desde su celular, o regístralo tú si te respondió por otro medio.</p>
              </div>
            </div>
          )}

          {/* Trabajos */}
          <Card>
            <CardHeader className="pb-1 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Trabajos</CardTitle>
              {!isClosed && (
                <Button variant="ghost" size="sm" className="text-primary -mr-2" onClick={() => { setItemErr(null); setItemDialog(true); }} data-testid="button-open-add-item">
                  <PlusCircle className="h-4 w-4 mr-1" /> Adicional
                </Button>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Sin ítems.</p>
              ) : (
                <ul className="divide-y">
                  {items.map(item => (
                    <li key={item.id} className={cn("py-3", item.approvalStatus === "rejected" && "opacity-60")}>
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <p className={cn("font-medium text-sm", item.approvalStatus === "rejected" && "line-through")}>{item.description}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[11px] text-muted-foreground">{ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}{item.quantity !== 1 ? ` · ${item.quantity} × ${formatCLP(item.unitPrice)}` : ""}</span>
                            <ApprovalBadge item={item} />
                            {item.status === "completed" && <span className="text-[11px] text-green-700 inline-flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3" />Hecho</span>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className={cn("font-semibold text-sm whitespace-nowrap", item.itemType === "discount" && "text-green-700")}>
                            {item.itemType === "discount" ? "-" : ""}{formatCLP(item.total)}
                          </span>
                          {!isClosed && item.status !== "completed" && (
                            <div className="flex gap-3 mt-0.5">
                              {item.total > 0 && item.itemType !== "discount" && (
                                <button type="button" className="text-[11px] text-muted-foreground hover:text-primary" disabled={warrantyItem.isPending} onClick={() => handleWarranty(item)} data-testid={`button-warranty-item-${item.id}`}>
                                  Garantía
                                </button>
                              )}
                              <button type="button" className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => setRemoveItem(item)} data-testid={`button-remove-item-${item.id}`}>
                                Quitar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {item.approvalStatus === "pending" && !isClosed && (
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={decideItem.isPending} onClick={() => handleDecide(item, "approved")}>
                            <Check className="h-3 w-3 mr-1" />Cliente aprobó
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={decideItem.isPending} onClick={() => handleDecide(item, "rejected")}>
                            <X className="h-3 w-3 mr-1" />Rechazó
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t pt-3 mt-1 flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">Total aprobado</span>
                <span className="text-xl font-bold">{formatCLP(wo.total)}</span>
              </div>
              {pendingItems.length > 0 && (
                <p className="text-xs text-muted-foreground text-right">+ {formatCLP(pendingAmount)} si aprueba lo pendiente</p>
              )}
            </CardContent>
          </Card>

          {checklist.length > 0 && (
            <ChecklistCard workOrderId={wo.id} checklist={checklist} items={items} disabled={isClosed} onChanged={invalidate} />
          )}

          <PhotosCard workOrderId={wo.id} readOnly={woStatus === "cancelled"} />

          <SetupCard bicycleId={wo.bicycleId} readOnly={woStatus === "cancelled"} />

          {(me?.role === "admin" || me?.role === "superadmin") && <EconomicsCard workOrderId={wo.id} closed={isClosed} />}

          {/* Cliente y bicicleta */}
          <Card>
            <CardContent className="pt-5 space-y-2.5 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <Link href={`/clientes/${workCase.clientId}`}><span className="font-medium hover:underline text-primary cursor-pointer">{workCase.clientName ?? "—"}</span></Link>
                <span className="text-muted-foreground text-xs">{wo.clientPhone ?? "sin teléfono"}</span>
                <WhatsAppButton phone={wo.clientPhone} text={chatGreeting} label="Chat" className="ml-auto h-7" />
              </div>
              {workCase.bicycleName && (
                <div className="flex items-center gap-2"><Bike className="h-4 w-4 text-muted-foreground shrink-0" /><Link href={`/bicicletas/${wo.bicycleId}`} className="hover:underline text-primary" data-testid="link-bike-history">{workCase.bicycleName}</Link><span className="text-xs text-muted-foreground">· ver historial</span></div>
              )}
              {!solo && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Mecánico: {wo.mechanicName ?? "sin asignar"}</span>
                  {!isClosed && (
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs ml-auto" data-testid="button-assign-mechanic"
                      onClick={() => { setSelectedMechanicId(wo.mechanicId ? String(wo.mechanicId) : ""); setMechanicDialogAutoAdvance(false); setMechanicDialog(true); }}>
                      {wo.mechanicId ? "Cambiar" : "Asignar"}
                    </Button>
                  )}
                </div>
              )}
              {workCase.initialRequirement && (
                <div className="p-2 bg-muted rounded-md"><span className="text-xs text-muted-foreground block">Problema reportado</span>{workCase.initialRequirement}</div>
              )}
              {wo.internalNotes && (
                <div className="p-2 bg-muted rounded-md"><span className="text-xs text-muted-foreground block">Nota interna</span>{wo.internalNotes}</div>
              )}
              {wo.customerNotes && (
                <div className="p-2 bg-muted rounded-md"><span className="text-xs text-muted-foreground block flex items-center gap-1"><Eye className="h-3 w-3" />Mensaje para el cliente</span>{wo.customerNotes}</div>
              )}
            </CardContent>
          </Card>

          <Button variant="outline" className="w-full" onClick={() => { setCommentErr(null); setCommentDialog(true); }} data-testid="button-open-add-comment">
            <MessageSquarePlus className="h-4 w-4 mr-2" /> Agregar comentario
          </Button>
        </>
      )}

      {/* Historial */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowTimeline(v => !v)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4" />Historial ({(timeline ?? []).length})</CardTitle>
            {showTimeline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showTimeline && (
          <CardContent>
            {(timeline ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>
            ) : (
              <div className="space-y-3">
                {(timeline ?? []).map((e: any) => (
                  <div key={e.id} className="flex gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div>
                      <p className="font-medium flex items-center gap-1.5">
                        {EVENT_LABELS[e.action] ?? e.action}
                        {e.visibleToClient && <Eye className="h-3 w-3 text-muted-foreground" aria-label="Visible para el cliente" />}
                      </p>
                      {eventDetail(e) && <p className="text-muted-foreground text-xs mt-0.5">{eventDetail(e)}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {e.userName ?? (e.action === "item_decision" && e.previousStatus === "client" ? "Cliente" : "Sistema")} · {new Date(e.createdAt).toLocaleString("es-CL")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Enviar al cliente */}
      <Dialog open={!!shareData} onOpenChange={(o) => { if (!o) { setShareData(null); setNotifyTitle(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{notifyTitle ?? "Enviar al cliente"}</DialogTitle>
            <DialogDescription>El cliente ve el estado, los trabajos y aprueba los adicionales desde este link, sin crear cuenta.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-line break-words">{shareData?.message}{"\n"}<span className="text-primary">{publicUrl}</span></div>
            {!shareData?.clientPhone && <p className="text-xs text-muted-foreground">El cliente no tiene teléfono registrado: WhatsApp te pedirá elegir el contacto.</p>}
          </div>
          <div className="grid gap-2">
            <Button asChild className="bg-green-600 hover:bg-green-700 text-white">
              <a href={whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4 mr-2" />Enviar por WhatsApp</a>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={copyLink}><Copy className="h-4 w-4 mr-2" />Copiar link</Button>
              <Button variant="outline" asChild><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Ver como cliente</a></Button>
              <Button variant="outline" asChild className="col-span-2"><a href={`/api/work-orders/${woId}/pdf`} target="_blank" rel="noreferrer" data-testid="share-download-pdf"><FileDown className="h-4 w-4 mr-2" />Ver comprobante en PDF</a></Button>
            </div>
            {notifyTitle && <Button variant="ghost" onClick={() => { setShareData(null); setNotifyTitle(null); }}>Ahora no</Button>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Agregar adicional */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar adicional</DialogTitle>
            <DialogDescription>Queda esperando la aprobación del cliente y no suma al total hasta que la apruebe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}{s.basePrice ? ` — ${formatCLP(s.basePrice)}` : ""}</SelectItem>
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
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.suggestedPrice ? ` — ${formatCLP(p.suggestedPrice)}` : ""}</SelectItem>
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
                <Input type="number" inputMode="numeric" min="0" placeholder="0" value={itemDraft.unitPrice} onChange={(e) => setItemDraft((d) => ({ ...d, unitPrice: e.target.value }))} data-testid="input-additem-price" />
              </div>
            </div>
            {itemDraft.itemType === "part" && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={itemDraft.customerProvided} onCheckedChange={(v) => setItemDraft((d) => ({ ...d, customerProvided: v === true }))} data-testid="checkbox-customer-provided" />
                Lo trae el cliente (sin cobro ni stock)
              </label>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={itemDraft.alreadyApproved} onCheckedChange={(v) => setItemDraft((d) => ({ ...d, alreadyApproved: v === true }))} data-testid="checkbox-already-approved" />
              El cliente ya lo aprobó (en persona, por teléfono o WhatsApp)
            </label>
            {itemErr && <p className="text-sm text-destructive">{itemErr}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(false)}>Cancelar</Button>
            <Button onClick={handleAddItem} disabled={addItem.isPending} data-testid="button-submit-additem">
              {addItem.isPending ? "Agregando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quitar ítem */}
      <AlertDialog open={!!removeItem} onOpenChange={(o) => !o && setRemoveItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar “{removeItem?.description}”?</AlertDialogTitle>
            <AlertDialogDescription>Deja de sumar al total y sus pasos del checklist quedan como “no aplica”.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveItem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Quitar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Asignar mecánico */}
      <Dialog open={mechanicDialog} onOpenChange={setMechanicDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Asignar mecánico</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Mecánico</Label>
            {mechanics.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay mecánicos activos registrados.</p>
            ) : (
              <Select value={selectedMechanicId} onValueChange={setSelectedMechanicId}>
                <SelectTrigger data-testid="select-mechanic-dialog"><SelectValue placeholder="Seleccionar mecánico..." /></SelectTrigger>
                <SelectContent>
                  {mechanics.map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMechanicDialog(false)}>Cancelar</Button>
            <Button onClick={handleMechanicConfirm} disabled={!selectedMechanicId || assignMechanic.isPending} data-testid="button-confirm-mechanic">
              {assignMechanic.isPending ? "Asignando..." : mechanicDialogAutoAdvance ? "Asignar e iniciar" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agregar comentario */}
      <Dialog open={commentDialog} onOpenChange={setCommentDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agregar comentario</DialogTitle></DialogHeader>
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
            <label className="flex items-center justify-between gap-3 text-sm cursor-pointer rounded-md border p-3">
              <span>
                <span className="font-medium block">Visible para el cliente</span>
                <span className="text-xs text-muted-foreground">Aparece en su seguimiento</span>
              </span>
              <Switch checked={commentDraft.visibleToClient} onCheckedChange={(v) => setCommentDraft((d) => ({ ...d, visibleToClient: v }))} data-testid="switch-comment-visible" />
            </label>
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
