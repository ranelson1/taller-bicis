import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetQuote,
  useUpdateQuote,
  useSendQuote,
  useApproveQuote,
  useRejectQuote,
  useMarkQuoteReadyForWorkOrder,
  useCreateQuoteItem,
  useUpdateQuoteItem,
  useDeleteQuoteItem,
  useApproveQuoteItem,
  useRejectQuoteItem,
  useGetQuoteTimeline,
  useListQuoteVersions,
  useListServices,
  useListParts,
  useListReceptions,
  useListWorkOrders,
  useCreateWorkOrderFromQuote,
  useListUsers,
  getGetQuoteQueryKey,
  type QuoteItem,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useWorkers } from "@/hooks/use-workers";
import {
  ArrowLeft, Send, CheckCircle, XCircle, Wrench, Plus, Pencil, Trash2,
  ThumbsUp, ThumbsDown, Clock, User, ChevronDown, ChevronUp, Copy, History, Bike, ExternalLink, ClipboardList,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  partially_approved: "Aprobado parcial",
  approved: "Aprobado",
  rejected: "Rechazado",
  updated_after_sent: "Actualizado",
  ready_for_work_order: "Listo para OT",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  sent: "bg-blue-50 text-blue-700 border-blue-200",
  partially_approved: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  updated_after_sent: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_work_order: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  service: "Servicio",
  part: "Repuesto",
  additional_labor: "M.O. adicional",
  diagnosis: "Diagnóstico",
  recommendation: "Recomendación",
  discount: "Descuento",
  other: "Otro",
};

const ORIGIN_LABELS: Record<string, string> = {
  customer_request: "Solicitud cliente",
  mechanic_recommendation: "Recomendación mecánico",
  visual_inspection: "Inspección visual",
  during_work: "Durante el trabajo",
  warranty_correction: "Garantía",
  manual: "Manual",
};

const ITEM_TYPES = Object.entries(ITEM_TYPE_LABELS);
const ORIGINS = Object.entries(ORIGIN_LABELS);

function formatCLP(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(num);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const itemSchema = z.object({
  itemType: z.string().min(1),
  origin: z.string().min(1),
  description: z.string().min(1, "La descripción es requerida"),
  quantity: z.string().min(1).refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Debe ser un número positivo"),
  unitPrice: z.string().min(1).refine(v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, "Debe ser un número"),
  estimatedLaborHours: z.string().optional(),
});
type ItemForm = z.infer<typeof itemSchema>;

const editQuoteSchema = z.object({
  initialRequirement: z.string().optional(),
  customerNotes: z.string().optional(),
  internalNotes: z.string().optional(),
});
type EditQuoteForm = z.infer<typeof editQuoteSchema>;

export default function PresupuestoDetail() {
  const { id } = useParams<{ id: string }>();
  const quoteId = parseInt(id ?? "0");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: quote, isLoading } = useGetQuote(quoteId);
  const { data: timeline } = useGetQuoteTimeline(quoteId);
  const { data: versions } = useListQuoteVersions(quoteId);
  const { data: services } = useListServices({});
  const { data: parts } = useListParts({});
  const { data: linkedReceptions } = useListReceptions({ quoteId: quoteId });
  const linkedReception = linkedReceptions?.[0] ?? null;
  const { data: linkedWorkOrders } = useListWorkOrders({ clientId: undefined } as any);
  const linkedWorkOrder = (linkedWorkOrders ?? []).find((wo: any) => wo.quoteId === quoteId) ?? null;

  const { data: users } = useListUsers();
  const { workers: mechanics, solo } = useWorkers();

  const [showTimeline, setShowTimeline] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<QuoteItem | null>(null);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [deleteItemTarget, setDeleteItemTarget] = useState<QuoteItem | null>(null);
  const [catalogServiceId, setCatalogServiceId] = useState<string>("");
  const [catalogPartId, setCatalogPartId] = useState<string>("");
  const [editQuoteDialog, setEditQuoteDialog] = useState(false);
  const [woMechanicDialog, setWoMechanicDialog] = useState(false);
  const [woMechanicId, setWoMechanicId] = useState<string>("none");

  const updateQuote = useUpdateQuote();
  const sendQuote = useSendQuote();
  const approveQuote = useApproveQuote();
  const rejectQuote = useRejectQuote();
  const readyForWO = useMarkQuoteReadyForWorkOrder();
  const createWorkOrder = useCreateWorkOrderFromQuote();
  const createItem = useCreateQuoteItem();
  const updateItem = useUpdateQuoteItem();
  const deleteItem = useDeleteQuoteItem();
  const approveItem = useApproveQuoteItem();
  const rejectItem = useRejectQuoteItem();

  const form = useForm<ItemForm>({
    resolver: zodResolver(itemSchema),
    defaultValues: { itemType: "service", origin: "customer_request", description: "", quantity: "1", unitPrice: "0", estimatedLaborHours: "" },
  });

  const editQuoteForm = useForm<EditQuoteForm>({
    resolver: zodResolver(editQuoteSchema),
    defaultValues: { initialRequirement: "", customerNotes: "", internalNotes: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetQuoteQueryKey(quoteId) });

  const handleSend = () => {
    sendQuote.mutate({ id: quoteId }, {
      onSuccess: () => { toast({ title: "Presupuesto enviado al cliente" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al enviar" }),
    });
  };

  const handleApprove = () => {
    approveQuote.mutate({ id: quoteId }, {
      onSuccess: () => { toast({ title: "Presupuesto aprobado" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al aprobar" }),
    });
  };

  const handleReject = () => {
    rejectQuote.mutate({ id: quoteId, data: { comment: rejectComment || undefined } }, {
      onSuccess: () => { toast({ title: "Presupuesto rechazado" }); setRejectDialog(false); setRejectComment(""); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al rechazar" }),
    });
  };

  const handleReadyForWO = () => {
    readyForWO.mutate({ id: quoteId }, {
      onSuccess: () => { toast({ title: "Marcado como listo para orden de trabajo" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const openEditQuote = () => {
    if (!quote) return;
    editQuoteForm.reset({
      initialRequirement: quote.initialRequirement ?? "",
      customerNotes: quote.customerNotes ?? "",
      internalNotes: quote.internalNotes ?? "",
    });
    setEditQuoteDialog(true);
  };

  const handleEditQuote = (values: EditQuoteForm) => {
    updateQuote.mutate({ id: quoteId, data: values }, {
      onSuccess: (updated: any) => {
        const wasSent = quote?.status === "sent";
        toast({
          title: "Presupuesto actualizado",
          description: wasSent ? "El estado cambió a «Actualizado» — puedes reenviarlo al cliente." : undefined,
        });
        setEditQuoteDialog(false);
        invalidate();
      },
      onError: () => toast({ variant: "destructive", title: "Error al guardar cambios" }),
    });
  };

  const handleCopyWhatsApp = () => {
    if (!quote) return;
    const activeItems = (quote.items ?? []).filter((i) => i.active && i.approvalStatus !== "rejected");
    const lines = [
      `*Presupuesto ${quote.quoteNumber}*`,
      `Cliente: ${quote.clientName ?? "—"}`,
      quote.bicycleName ? `Bicicleta: ${quote.bicycleName}` : "",
      "",
      "*Ítems:*",
      ...activeItems.map((i) => `• ${i.description} — ${formatCLP(i.total)}`),
      "",
      `*Total: ${formatCLP(quote.total)}*`,
      "",
      "Taller de Bicicletas",
    ].filter((l) => l !== undefined);
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      toast({ title: "Texto copiado al portapapeles" });
    });
  };

  const openAddItem = () => {
    setEditingItem(null);
    setCatalogServiceId("");
    setCatalogPartId("");
    form.reset({ itemType: "service", origin: "customer_request", description: "", quantity: "1", unitPrice: "0", estimatedLaborHours: "" });
    setItemDialog(true);
  };

  const openEditItem = (item: QuoteItem) => {
    setEditingItem(item);
    form.reset({
      itemType: item.itemType,
      origin: item.origin,
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
      estimatedLaborHours: item.estimatedLaborHours ? String(item.estimatedLaborHours) : "",
    });
    setItemDialog(true);
  };

  const onSubmitItem = (values: ItemForm) => {
    const payload = {
      itemType: values.itemType as QuoteItem["itemType"],
      origin: values.origin as QuoteItem["origin"],
      description: values.description,
      quantity: parseFloat(values.quantity),
      unitPrice: parseFloat(values.unitPrice),
      estimatedLaborHours: values.estimatedLaborHours ? parseFloat(values.estimatedLaborHours) : null,
    };

    if (editingItem) {
      updateItem.mutate({ id: quoteId, itemId: editingItem.id, data: payload }, {
        onSuccess: () => { toast({ title: "Ítem actualizado" }); setItemDialog(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createItem.mutate({ id: quoteId, data: { ...payload, sortOrder: (quote?.items?.length ?? 0) + 1 } }, {
        onSuccess: () => { toast({ title: "Ítem agregado" }); setItemDialog(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al agregar" }),
      });
    }
  };

  const handleDeleteItem = () => {
    if (!deleteItemTarget) return;
    deleteItem.mutate({ id: quoteId, itemId: deleteItemTarget.id }, {
      onSuccess: () => { toast({ title: "Ítem eliminado" }); setDeleteItemTarget(null); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al eliminar" }),
    });
  };

  const handleApproveItem = (item: QuoteItem) => {
    approveItem.mutate({ id: quoteId, itemId: item.id }, {
      onSuccess: () => { toast({ title: "Ítem aprobado" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const handleRejectItem = (item: QuoteItem) => {
    rejectItem.mutate({ id: quoteId, itemId: item.id }, {
      onSuccess: () => { toast({ title: "Ítem rechazado" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const canEdit = quote && ["draft", "sent", "updated_after_sent"].includes(quote.status);
  const canEditQuoteFields = quote && ["draft", "sent", "updated_after_sent", "partially_approved"].includes(quote.status);
  const canSend = quote && ["draft", "updated_after_sent"].includes(quote.status);
  const canApprove = quote && ["sent", "partially_approved"].includes(quote.status);
  const canReject = quote && ["sent", "partially_approved", "approved"].includes(quote.status);
  const canReadyForWO = quote && ["approved", "partially_approved"].includes(quote.status);
  const canConvertToWO = quote && ["approved", "partially_approved", "ready_for_work_order"].includes(quote.status) && !linkedWorkOrder;

  const handleConvertToWO = () => {
    setWoMechanicId("none");
    setWoMechanicDialog(true);
  };

  const handleConfirmConvertToWO = () => {
    const mechanicId = woMechanicId !== "none" ? parseInt(woMechanicId) : undefined;
    createWorkOrder.mutate({ quoteId, data: { mechanicId: mechanicId ?? null } as any }, {
      onSuccess: (wo: any) => {
        setWoMechanicDialog(false);
        toast({ title: `Orden de trabajo ${(wo as any).workOrderNumber} creada exitosamente` });
        navigate(`/ordenes/${wo.id}`);
      },
      onError: () => toast({ variant: "destructive", title: "Error al crear la orden de trabajo" }),
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <p className="text-muted-foreground">Presupuesto no encontrado.</p>
        <Link href="/presupuestos"><Button variant="ghost" className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Volver</Button></Link>
      </div>
    );
  }

  const items = quote.items ?? [];
  const pendingItems = items.filter(i => i.approvalStatus === "pending" && i.active);
  const approvedItems = items.filter(i => i.approvalStatus === "approved" && i.active);
  const rejectedItems = items.filter(i => i.approvalStatus === "rejected" && i.active);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/presupuestos">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold font-mono text-primary">{quote.quoteNumber}</h1>
            <StatusBadge status={quote.status} />
            {quote.workCaseId && quote.workCaseNumber && (
              <Link href={`/trabajos/${quote.workCaseId}`}>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer font-mono">
                  Trabajo: {quote.workCaseNumber}
                </span>
              </Link>
            )}
          </div>
          <p className="text-muted-foreground mt-1 truncate">{quote.clientName ?? "—"}{quote.bicycleName ? ` · ${quote.bicycleName}` : ""}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {canSend && (
          <Button onClick={handleSend} disabled={sendQuote.isPending} className="flex items-center gap-2" data-testid="button-send-quote">
            <Send className="h-4 w-4" /> Enviar al cliente
          </Button>
        )}
        {canApprove && (
          <Button onClick={handleApprove} disabled={approveQuote.isPending} variant="default" className="bg-green-600 hover:bg-green-700 flex items-center gap-2" data-testid="button-approve-quote">
            <CheckCircle className="h-4 w-4" /> Aprobar
          </Button>
        )}
        {canReject && (
          <Button onClick={() => setRejectDialog(true)} variant="outline" className="border-destructive text-destructive hover:bg-destructive/10 flex items-center gap-2" data-testid="button-reject-quote">
            <XCircle className="h-4 w-4" /> Rechazar
          </Button>
        )}
        {canReadyForWO && (
          <Button onClick={handleReadyForWO} disabled={readyForWO.isPending} variant="outline" className="flex items-center gap-2" data-testid="button-ready-for-wo">
            <Wrench className="h-4 w-4" /> Listo para OT
          </Button>
        )}
        {canConvertToWO && (
          <Button onClick={handleConvertToWO} disabled={createWorkOrder.isPending} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700" data-testid="button-convert-to-wo">
            <ClipboardList className="h-4 w-4" /> Convertir en OT
          </Button>
        )}
        {linkedWorkOrder && (
          <Link href={`/ordenes/${linkedWorkOrder.id}`}>
            <Button variant="outline" className="flex items-center gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50">
              <ClipboardList className="h-4 w-4" /> Ver OT {(linkedWorkOrder as any).workOrderNumber}
            </Button>
          </Link>
        )}
        {canApprove && (
          <Button
            variant="outline"
            className="flex items-center gap-2 border-amber-400 text-amber-700 hover:bg-amber-50"
            data-testid="button-partial-approve"
            onClick={() => {
              const el = document.getElementById("items-section");
              el?.scrollIntoView({ behavior: "smooth" });
              toast({ title: "Aprobación parcial", description: "Aprueba o rechaza cada ítem individualmente para registrar aprobación parcial." });
            }}
          >
            <ThumbsUp className="h-4 w-4" /> Aprobar parcialmente
          </Button>
        )}
        {canEditQuoteFields && (
          <Button onClick={openEditQuote} variant="outline" className="flex items-center gap-2" data-testid="button-edit-quote">
            <Pencil className="h-4 w-4" /> Editar presupuesto
            {quote?.status === "sent" && <span className="text-xs ml-1 opacity-70">(crea v{(quote.currentVersion ?? 1) + 1})</span>}
          </Button>
        )}
        {quote && ["draft", "sent", "partially_approved"].includes(quote.status) && (
          <Button onClick={handleCopyWhatsApp} variant="outline" className="flex items-center gap-2" data-testid="button-copy-whatsapp">
            <Copy className="h-4 w-4" /> Copiar para WhatsApp
          </Button>
        )}
      </div>

      {/* Info card */}
      <Card>
        <CardHeader><CardTitle className="text-base">Información del presupuesto</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div><p className="text-muted-foreground mb-0.5">Cliente</p><p className="font-medium">{quote.clientName ?? "—"}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Bicicleta</p><p className="font-medium">{quote.bicycleName ?? "—"}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Canal</p><p className="font-medium capitalize">{quote.originChannel}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Versión</p><p className="font-medium">v{quote.currentVersion}</p></div>
          <div><p className="text-muted-foreground mb-0.5">Horas estimadas</p><p className="font-medium">{quote.estimatedLaborHours ?? "—"} h</p></div>
          <div><p className="text-muted-foreground mb-0.5">Creado</p><p className="font-medium">{new Date(quote.createdAt).toLocaleDateString("es-CL")}</p></div>
          {quote.initialRequirement && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Requerimiento</p>
              <p className="font-medium">{quote.initialRequirement}</p>
            </div>
          )}
          {quote.customerNotes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Notas cliente</p>
              <p className="font-medium">{quote.customerNotes}</p>
            </div>
          )}
          {quote.internalNotes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-muted-foreground mb-0.5">Notas internas</p>
              <p className="font-medium">{quote.internalNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recepción e inspección */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bike className="h-4 w-4" /> Recepción e inspección
          </CardTitle>
          {!linkedReception && (
            <Link href={`/recepciones/nueva?quoteId=${quoteId}`}>
              <button className="text-sm text-primary flex items-center gap-1 hover:underline">
                <Plus className="h-3.5 w-3.5" /> Registrar recepción
              </button>
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {linkedReception ? (
            <Link href={`/recepciones/${linkedReception.id}`}>
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="font-mono font-bold text-primary text-sm">{linkedReception.receptionNumber}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Recibida el {new Date(linkedReception.receivedAt).toLocaleDateString("es-CL")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                    linkedReception.status === "received" ? "bg-blue-50 text-blue-700 border-blue-200" :
                    linkedReception.status === "in_inspection" ? "bg-amber-50 text-amber-700 border-amber-200" :
                    linkedReception.status === "inspection_completed" ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                    linkedReception.status === "waiting_quote_approval" ? "bg-purple-50 text-purple-700 border-purple-200" :
                    linkedReception.status === "ready_for_work_order" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    "bg-gray-50 text-gray-600 border-gray-200"
                  }`}>
                    {{
                      received: "Recibida",
                      in_inspection: "En inspección",
                      inspection_completed: "Inspección completa",
                      waiting_quote_approval: "Esperando aprobación",
                      ready_for_work_order: "Lista para OT",
                      cancelled: "Cancelada",
                    }[linkedReception.status] ?? linkedReception.status}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-3">
              No hay recepción física asociada a este presupuesto.{" "}
              <Link href={`/recepciones/nueva?quoteId=${quoteId}`}>
                <span className="text-primary hover:underline cursor-pointer">Registrar ahora</span>
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card id="items-section">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Ítems del presupuesto</CardTitle>
          {canEdit && (
            <Button size="sm" onClick={openAddItem} className="flex items-center gap-1" data-testid="button-add-item">
              <Plus className="h-4 w-4" /> Agregar ítem
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {items.filter(i => i.active).length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-6">No hay ítems. {canEdit && "Agrega uno con el botón de arriba."}</p>
          )}

          {items.filter(i => i.active).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => (
            <div
              key={item.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border ${item.approvalStatus === "approved" ? "bg-green-50/50 border-green-200" : item.approvalStatus === "rejected" ? "bg-red-50/50 border-red-200 opacity-70" : "bg-muted/30"}`}
              data-testid={`item-${item.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}</Badge>
                  {item.origin === "visual_inspection" && <Badge className="bg-indigo-50 text-indigo-700 text-xs border border-indigo-200">Inspección visual</Badge>}
                  {item.approvalStatus === "approved" && <Badge className="bg-green-100 text-green-700 text-xs border-green-200">Aprobado</Badge>}
                  {item.approvalStatus === "rejected" && <Badge className="bg-red-100 text-red-700 text-xs border-red-200">Rechazado</Badge>}
                </div>
                <p className="font-medium mt-1 truncate">{item.description}</p>
                <p className="text-sm text-muted-foreground">
                  {item.quantity} × {formatCLP(item.unitPrice)}
                  {item.estimatedLaborHours && ` · ${item.estimatedLaborHours}h`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-right min-w-[80px]">{formatCLP(item.total)}</span>
                <div className="flex gap-1">
                  {canApprove && item.approvalStatus === "pending" && (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => handleApproveItem(item)} className="text-green-600" title="Aprobar ítem">
                        <ThumbsUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleRejectItem(item)} className="text-destructive" title="Rechazar ítem">
                        <ThumbsDown className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {canEdit && (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => openEditItem(item)} title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteItemTarget(item)} title="Eliminar">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Totals */}
          {items.filter(i => i.active).length > 0 && (
            <>
              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span><span>{formatCLP(quote.subtotal)}</span>
                </div>
                {parseFloat(String(quote.discountTotal ?? "0")) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Descuentos</span><span>-{formatCLP(quote.discountTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t">
                  <span>Total</span><span>{formatCLP(quote.total)}</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      {timeline && timeline.length > 0 && (
        <Card>
          <CardHeader>
            <button
              className="flex items-center justify-between w-full text-left"
              onClick={() => setShowTimeline(!showTimeline)}
            >
              <CardTitle className="text-base">Historial de actividad</CardTitle>
              {showTimeline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CardHeader>
          {showTimeline && (
            <CardContent>
              <div className="space-y-3">
                {timeline.map((event) => (
                  <div key={event.id} className="flex gap-3 text-sm">
                    <div className="mt-0.5 shrink-0">
                      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{event.action.replace(/_/g, " ")}</p>
                      {event.comment && <p className="text-muted-foreground">{event.comment}</p>}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {event.userName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{event.userName}</span>}
                        <span>{new Date(event.createdAt).toLocaleString("es-CL")}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Version history */}
      {versions && versions.length > 0 && (
        <Card>
          <CardHeader>
            <button
              className="flex items-center justify-between w-full text-left"
              onClick={() => setShowVersions(!showVersions)}
            >
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" /> Historial de versiones
              </CardTitle>
              {showVersions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CardHeader>
          {showVersions && (
            <CardContent>
              <div className="space-y-4">
                {versions.map((v: any) => (
                  <div key={v.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">Versión {v.versionNumber}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{v.status}</span>
                        {v.sentAt && <span>· Enviado {new Date(v.sentAt).toLocaleDateString("es-CL")}</span>}
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>Subtotal: {formatCLP(v.subtotal)}</span>
                      {parseFloat(v.discountTotal ?? "0") > 0 && <span>Descuentos: -{formatCLP(v.discountTotal)}</span>}
                      <span className="font-medium text-foreground">Total: {formatCLP(v.total)}</span>
                    </div>
                    {Array.isArray(v.itemsSnapshot) && v.itemsSnapshot.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-0.5 pl-2 border-l-2 border-muted">
                        {(v.itemsSnapshot as any[]).map((item: any, idx: number) => (
                          <li key={idx}>• {item.description} — {formatCLP(item.unitPrice)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Item dialog */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Editar ítem" : "Agregar ítem"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitItem)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="itemType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={(v) => {
                        field.onChange(v);
                        setCatalogServiceId("");
                        setCatalogPartId("");
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{ITEM_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="origin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Origen</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{ORIGINS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Catalog selector for services */}
              {form.watch("itemType") === "service" && !editingItem && (services ?? []).length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1.5">Seleccionar del catálogo <span className="text-muted-foreground font-normal">(opcional)</span></p>
                  <Select value={catalogServiceId} onValueChange={(v) => {
                    setCatalogServiceId(v);
                    const svc = (services ?? []).find((s: any) => String(s.id) === v);
                    if (svc) {
                      form.setValue("description", svc.name);
                      form.setValue("unitPrice", String(svc.basePrice ?? 0));
                      if (svc.estimatedHours) {
                        form.setValue("estimatedLaborHours", String(svc.estimatedHours));
                      }
                    }
                  }}>
                    <SelectTrigger data-testid="select-catalog-service"><SelectValue placeholder="Elegir servicio del catálogo..." /></SelectTrigger>
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

              {/* Catalog selector for parts */}
              {form.watch("itemType") === "part" && !editingItem && (parts ?? []).length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1.5">Seleccionar del catálogo <span className="text-muted-foreground font-normal">(opcional)</span></p>
                  <Select value={catalogPartId} onValueChange={(v) => {
                    setCatalogPartId(v);
                    const part = (parts ?? []).find((p: any) => String(p.id) === v);
                    if (part) {
                      form.setValue("description", (part as any).name);
                      form.setValue("unitPrice", String((part as any).suggestedPrice ?? 0));
                    }
                  }}>
                    <SelectTrigger data-testid="select-catalog-part"><SelectValue placeholder="Elegir repuesto del catálogo..." /></SelectTrigger>
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

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción *</FormLabel>
                  <FormControl><Input placeholder="Descripción del ítem..." {...field} data-testid="input-item-description" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="quantity" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cantidad *</FormLabel>
                    <FormControl><Input type="number" step="0.5" min="0.5" {...field} data-testid="input-item-quantity" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="unitPrice" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio unitario *</FormLabel>
                    <FormControl><Input type="number" step="100" min="0" {...field} data-testid="input-item-price" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="estimatedLaborHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Horas de trabajo estimadas</FormLabel>
                  <FormControl><Input type="number" step="0.25" min="0" placeholder="0.5" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setItemDialog(false)}>Cancelar</Button>
                <Button type="submit" disabled={createItem.isPending || updateItem.isPending} data-testid="button-submit-item">
                  {editingItem ? "Guardar cambios" : "Agregar ítem"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectDialog} onOpenChange={setRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar presupuesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">¿Estás seguro de que deseas rechazar este presupuesto?</p>
            <Textarea
              placeholder="Motivo del rechazo (opcional)..."
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejectQuote.isPending}>
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit quote dialog */}
      <Dialog open={editQuoteDialog} onOpenChange={setEditQuoteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Editar presupuesto
              {quote?.status === "sent" && (
                <p className="text-sm font-normal text-muted-foreground mt-1">
                  Al guardar, el presupuesto pasará a estado «Actualizado» y podrás reenviarlo al cliente.
                </p>
              )}
            </DialogTitle>
          </DialogHeader>
          <Form {...editQuoteForm}>
            <form onSubmit={editQuoteForm.handleSubmit(handleEditQuote)} className="space-y-4">
              <FormField control={editQuoteForm.control} name="initialRequirement" render={({ field }) => (
                <FormItem>
                  <FormLabel>Requerimiento inicial</FormLabel>
                  <FormControl>
                    <Textarea placeholder="¿Qué necesita el cliente?" rows={3} {...field} data-testid="input-edit-requirement" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editQuoteForm.control} name="customerNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas para el cliente</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Notas visibles para el cliente..." rows={2} {...field} data-testid="input-edit-customer-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editQuoteForm.control} name="internalNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas internas</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Notas solo para el taller..." rows={2} {...field} data-testid="input-edit-internal-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditQuoteDialog(false)}>Cancelar</Button>
                <Button type="submit" disabled={updateQuote.isPending} data-testid="button-save-edit-quote">
                  {updateQuote.isPending ? "Guardando..." : "Guardar cambios"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Mechanic selection dialog for WO creation */}
      <Dialog open={woMechanicDialog} onOpenChange={setWoMechanicDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convertir en Orden de Trabajo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Selecciona el mecánico que trabajará esta orden. Puedes asignarlo más tarde si aún no está definido.</p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mecánico (opcional)</label>
              <Select value={woMechanicId} onValueChange={setWoMechanicId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {mechanics.map((m: any) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWoMechanicDialog(false)}>Cancelar</Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700"
              onClick={handleConfirmConvertToWO}
              disabled={createWorkOrder.isPending}
            >
              {createWorkOrder.isPending ? "Creando..." : "Crear OT"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete item alert */}
      <AlertDialog open={!!deleteItemTarget} onOpenChange={(o) => !o && setDeleteItemTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar ítem?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{deleteItemTarget?.description}</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteItem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
