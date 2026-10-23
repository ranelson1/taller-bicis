import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPublicWorkOrder,
  useDecidePublicWorkOrderItem,
  getGetPublicWorkOrderQueryKey,
  type PublicWorkOrder,
  type PublicWorkOrderItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bike, Camera, Check, CheckCircle2, CircleDashed, Clock, FileText, MessageCircle,
  PackageCheck, Phone, Plus, Wrench, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Vista del cliente (sin login). Se abre desde el link que el taller envía por WhatsApp.

const formatCLP = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : null;
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STEPS = [
  { key: "received", label: "Recibida", statuses: ["ready_to_work"] },
  { key: "working", label: "En reparación", statuses: ["in_progress", "quality_control"] },
  { key: "ready", label: "Lista", statuses: ["ready_for_pickup"] },
  { key: "delivered", label: "Entregada", statuses: ["delivered"] },
];

const STATUS_COPY: Record<string, { title: string; subtitle: string }> = {
  ready_to_work: { title: "Recibida en el taller", subtitle: "Pronto comenzaremos a trabajar en ella." },
  in_progress: { title: "En reparación", subtitle: "Estamos trabajando en tu bicicleta." },
  quality_control: { title: "En control de calidad", subtitle: "Revisando que todo quede perfecto." },
  ready_for_pickup: { title: "Lista para retirar", subtitle: "¡Tu bicicleta está lista!" },
  delivered: { title: "Entregada", subtitle: "Gracias por confiar en nosotros." },
  cancelled: { title: "Orden cancelada", subtitle: "Contáctanos si tienes dudas." },
};

const BIKE_TYPES: Record<string, string> = {
  mtb: "MTB", road: "Ruta", gravel: "Gravel", urban: "Urbana", ebike: "E-bike", kids: "Niños", other: "Otra",
};

const ITEM_TYPES: Record<string, string> = {
  service: "Servicio", part: "Repuesto", additional_labor: "Mano de obra", diagnosis: "Diagnóstico",
  discount: "Descuento", other: "Otro", recommendation: "Recomendación",
};

function Section({ icon: Icon, title, children, className }: {
  icon: React.ElementType; title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-2xl bg-white shadow-sm border border-stone-100 p-4", className)}>
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-stone-800 mb-3">
        <Icon className="h-4 w-4 text-orange-500" /> {title}
      </h2>
      {children}
    </section>
  );
}

function ItemRow({ item, onDecide, busy }: {
  item: PublicWorkOrderItem;
  onDecide?: (item: PublicWorkOrderItem, decision: "approved" | "rejected") => void;
  busy?: boolean;
}) {
  const isDiscount = item.itemType === "discount";
  const rejected = item.approvalStatus === "rejected";
  return (
    <div className={cn("py-3 border-b border-stone-100 last:border-0", rejected && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-semibold text-stone-900 uppercase text-sm leading-snug", rejected && "line-through")}>
            {item.description}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">{ITEM_TYPES[item.itemType] ?? item.itemType}</span>
            {item.quantity !== 1 && <span className="text-stone-500">{item.quantity} × {formatCLP(item.unitPrice)}</span>}
            {item.origin === "additional" && item.approvalStatus === "approved" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-green-700"><Check className="h-3 w-3" />Aprobado</span>
            )}
            {rejected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700"><X className="h-3 w-3" />Rechazado</span>
            )}
            {item.approvalStatus === "pending" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700"><Clock className="h-3 w-3" />Esperando tu aprobación</span>
            )}
          </div>
        </div>
        <span className={cn("font-bold text-stone-900 whitespace-nowrap", isDiscount && "text-green-700")}>
          {isDiscount ? "-" : ""}{formatCLP(item.total)}
        </span>
      </div>
      {item.approvalStatus === "pending" && onDecide && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onDecide(item, "rejected")}
            className="border-stone-300 text-stone-700">
            <X className="h-4 w-4 mr-1" /> Rechazar
          </Button>
          <Button disabled={busy} onClick={() => onDecide(item, "approved")}
            className="bg-green-600 hover:bg-green-700 text-white">
            <Check className="h-4 w-4 mr-1" /> Aprobar
          </Button>
        </div>
      )}
    </div>
  );
}

export default function OtPublica() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const queryKey = getGetPublicWorkOrderQueryKey(token);
  const { data: ot, isLoading, isError } = useGetPublicWorkOrder(token, {
    query: { queryKey, refetchInterval: 60_000, refetchOnWindowFocus: true },
  });
  const decide = useDecidePublicWorkOrderItem();
  const [confirmReject, setConfirmReject] = useState<PublicWorkOrderItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendDecision = async (item: PublicWorkOrderItem, decision: "approved" | "rejected") => {
    setError(null);
    try {
      const updated = await decide.mutateAsync({ token, itemId: item.id, data: { decision } });
      queryClient.setQueryData<PublicWorkOrder>(queryKey, updated);
    } catch (e: any) {
      setError(e?.data?.error ?? "No pudimos guardar tu respuesta. Intenta de nuevo.");
      queryClient.invalidateQueries({ queryKey });
    }
  };

  const onDecide = (item: PublicWorkOrderItem, decision: "approved" | "rejected") => {
    if (decision === "rejected") setConfirmReject(item);
    else sendDecision(item, decision);
  };

  const approveAll = async () => {
    for (const item of ot?.items.filter(i => i.approvalStatus === "pending") ?? []) {
      await sendDecision(item, "approved");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 p-4 space-y-4 max-w-md mx-auto">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (isError || !ot) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
        <div>
          <Bike className="h-12 w-12 text-orange-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-stone-900">No encontramos esta orden</h1>
          <p className="text-stone-500 text-sm mt-1">Revisa el link o contacta al taller.</p>
        </div>
      </div>
    );
  }

  const copy = STATUS_COPY[ot.status] ?? STATUS_COPY.ready_to_work;
  const currentStep = STEPS.findIndex(s => s.statuses.includes(ot.status));
  const initialItems = ot.items.filter(i => i.origin !== "additional");
  const additionalItems = ot.items.filter(i => i.origin === "additional");
  const pending = ot.items.filter(i => i.approvalStatus === "pending");
  const isOpen = ot.status !== "delivered" && ot.status !== "cancelled";
  const phoneDigits = ot.workshopPhone?.replace(/\D/g, "");

  return (
    <div className="min-h-screen bg-stone-50 pb-10">
      <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
        {/* Encabezado */}
        <header className="rounded-2xl bg-gradient-to-br from-orange-600 to-orange-500 text-white p-5 shadow-md">
          <div className="flex items-center gap-3">
            {ot.workshopLogoUrl ? (
              <img src={ot.workshopLogoUrl} alt="" className="h-12 w-12 rounded-xl bg-white object-contain p-1" />
            ) : (
              <div className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center"><Wrench className="h-6 w-6" /></div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-white/80">Seguimiento de tu reparación</p>
              <p className="text-xl font-extrabold leading-tight">{ot.workshopName}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="font-semibold truncate">Hola, {ot.clientName}</p>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-mono">{ot.workOrderNumber}</span>
          </div>
        </header>

        {/* Pendientes de aprobación: lo primero que el cliente debe ver */}
        {pending.length > 0 && isOpen && (
          <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
            <h2 className="font-bold text-amber-900 flex items-center gap-2">
              <Clock className="h-5 w-5" /> {pending.length === 1 ? "Un trabajo espera tu aprobación" : `${pending.length} trabajos esperan tu aprobación`}
            </h2>
            <p className="text-sm text-amber-800 mt-1">Revisa el detalle y responde aquí mismo. No continuaremos con estos trabajos sin tu OK.</p>
            <div className="mt-2 rounded-xl bg-white px-3">
              {pending.map(item => <ItemRow key={item.id} item={item} onDecide={onDecide} busy={decide.isPending} />)}
            </div>
            {pending.length > 1 && (
              <Button onClick={approveAll} disabled={decide.isPending} className="w-full mt-3 bg-green-600 hover:bg-green-700 text-white">
                <Check className="h-4 w-4 mr-1" /> Aprobar todo ({formatCLP(pending.reduce((s, i) => s + (i.itemType === "discount" ? -i.total : i.total), 0))})
              </Button>
            )}
            {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
          </section>
        )}

        {/* Estado */}
        <section className="rounded-2xl bg-white shadow-sm border border-stone-100 overflow-hidden">
          <div className={cn("p-4 flex items-center gap-3", ot.status === "ready_for_pickup" ? "bg-green-50" : "bg-orange-50")}>
            <div className={cn("h-11 w-11 rounded-full flex items-center justify-center",
              ot.status === "ready_for_pickup" || ot.status === "delivered" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-600")}>
              {ot.status === "ready_for_pickup" || ot.status === "delivered" ? <CheckCircle2 className="h-6 w-6" /> : <Wrench className="h-6 w-6" />}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-stone-500">Estado de tu bicicleta</p>
              <p className="font-bold text-stone-900 text-lg leading-tight">{copy.title}</p>
              <p className="text-sm text-stone-600">{copy.subtitle}</p>
            </div>
          </div>
          {ot.status !== "cancelled" && (
            <div className="px-4 py-4">
              <ol className="flex items-start">
                {STEPS.map((step, idx) => {
                  const done = idx <= currentStep;
                  return (
                    <li key={step.key} className="flex-1 flex flex-col items-center relative">
                      {idx > 0 && (
                        <span className={cn("absolute top-4 right-1/2 w-full h-0.5 -z-0", idx <= currentStep ? "bg-green-500" : "bg-stone-200")} />
                      )}
                      <span className={cn("relative z-10 h-8 w-8 rounded-full flex items-center justify-center border-2",
                        done ? "bg-green-500 border-green-500 text-white" : "bg-white border-stone-200 text-stone-300")}>
                        {done ? <Check className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
                      </span>
                      <span className={cn("mt-1.5 text-[11px] text-center leading-tight", done ? "text-stone-800 font-semibold" : "text-stone-400")}>{step.label}</span>
                    </li>
                  );
                })}
              </ol>
              {(ot.status === "in_progress" || ot.status === "quality_control") && ot.progressPercentage > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-stone-500 mb-1"><span>Avance</span><span>{Math.round(ot.progressPercentage)}%</span></div>
                  <div className="h-2 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-orange-500 rounded-full" style={{ width: `${ot.progressPercentage}%` }} /></div>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 border-t border-stone-100 text-sm">
            <div className="p-3 border-r border-stone-100">
              <p className="text-[11px] uppercase tracking-wide text-stone-500">Ingreso</p>
              <p className="font-semibold text-stone-900">{formatDate(ot.receivedAt)}</p>
            </div>
            <div className="p-3">
              <p className="text-[11px] uppercase tracking-wide text-stone-500">
                {ot.deliveredAt ? "Entregada" : ot.completedAt ? "Lista desde" : "Lista aprox."}
              </p>
              <p className="font-semibold text-stone-900">
                {formatDate(ot.deliveredAt ?? ot.completedAt)
                  ?? (ot.estimatedDeliveryDate && new Date(ot.estimatedDeliveryDate) >= new Date(new Date().setHours(0, 0, 0, 0))
                    ? formatDate(ot.estimatedDeliveryDate)
                    : "Por confirmar")}
              </p>
            </div>
          </div>
        </section>

        {/* Mensaje del taller: va arriba porque es lo que el taller quiere que lea */}
        {ot.customerNotes && (
          <Section icon={FileText} title="Mensaje del taller">
            <p className="text-sm text-stone-700 whitespace-pre-line">{ot.customerNotes}</p>
          </Section>
        )}

        {/* Bicicleta */}
        {ot.bicycle && (
          <Section icon={Bike} title={`${ot.bicycle.brand} ${ot.bicycle.model}`}>
            {(() => {
              const details = [
                ot.bicycle.type ? (BIKE_TYPES[ot.bicycle.type] ?? ot.bicycle.type) : null,
                ot.bicycle.color, ot.bicycle.rimSize ? `Aro ${ot.bicycle.rimSize}` : null,
                ot.bicycle.year ? String(ot.bicycle.year) : null,
              ].filter(Boolean);
              return details.length > 0 ? <p className="text-sm text-stone-600">{details.join(" · ")}</p> : null;
            })()}
            {ot.reportedProblem && (
              <div className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-sm">
                <p className="text-[11px] uppercase tracking-wide text-stone-500">Problema reportado</p>
                <p className="text-stone-800">{ot.reportedProblem}</p>
              </div>
            )}
          </Section>
        )}

        {/* Trabajos */}
        {initialItems.length > 0 && (
          <Section icon={Wrench} title="Trabajos">
            {initialItems.map(item => <ItemRow key={item.id} item={item} />)}
          </Section>
        )}
        {additionalItems.filter(i => i.approvalStatus !== "pending").length > 0 && (
          <Section icon={Plus} title="Trabajos adicionales">
            {additionalItems.filter(i => i.approvalStatus !== "pending").map(item => <ItemRow key={item.id} item={item} />)}
          </Section>
        )}

        {/* Fotos que el taller compartió */}
        {(ot.photos ?? []).length > 0 && (
          <Section icon={Camera} title="Fotos y videos">
            <div className="grid grid-cols-2 gap-2">
              {ot.photos!.map(p => (
                <figure key={p.id} className="rounded-xl overflow-hidden bg-stone-100">
                  {p.mimeType?.startsWith("video/") ? (
                    <video src={`${p.url}#t=0.1`} controls playsInline preload="metadata" className="w-full aspect-square object-cover bg-black" />
                  ) : (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt={p.note ?? "Foto de tu bicicleta"} loading="lazy" className="w-full aspect-square object-cover" />
                    </a>
                  )}
                  {p.note && <figcaption className="px-2 py-1.5 text-xs text-stone-700">{p.note}</figcaption>}
                </figure>
              ))}
            </div>
          </Section>
        )}

        {/* Totales */}
        <section className="rounded-2xl bg-white shadow-sm border border-stone-100 overflow-hidden">
          <div className="p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-stone-600"><span>Subtotal</span><span>{formatCLP(ot.subtotal)}</span></div>
            {ot.discountTotal > 0 && (
              <div className="flex justify-between text-green-700"><span>Descuentos</span><span>-{formatCLP(ot.discountTotal)}</span></div>
            )}
            <div className="flex justify-between text-stone-500"><span>Neto</span><span>{formatCLP(ot.net)}</span></div>
            <div className="flex justify-between text-stone-500"><span>IVA (19%)</span><span>{formatCLP(ot.tax)}</span></div>
          </div>
          <div className="bg-gradient-to-r from-orange-600 to-orange-500 text-white px-4 py-3 flex justify-between items-center">
            <span className="font-bold tracking-wide">TOTAL</span>
            <span className="text-2xl font-extrabold">{formatCLP(ot.total)}</span>
          </div>
          {ot.paidAt && ot.paidAmount != null && ot.paidAmount < ot.total ? (
            <div className="px-4 py-2 text-sm space-y-0.5">
              <div className="flex justify-between text-stone-600"><span>Abonado el {formatDate(ot.paidAt)}</span><span>{formatCLP(ot.paidAmount)}</span></div>
              <div className="flex justify-between font-semibold text-stone-900"><span>Saldo por pagar</span><span>{formatCLP(ot.total - ot.paidAmount)}</span></div>
            </div>
          ) : ot.paidAt ? (
            <p className="px-4 py-2 text-sm text-green-700 font-medium flex items-center gap-1"><Check className="h-4 w-4" />Pagado el {formatDate(ot.paidAt)}</p>
          ) : ot.status === "ready_for_pickup" ? (
            <p className="px-4 py-2 text-sm text-stone-600">A pagar al retirar.</p>
          ) : null}
          {pending.length > 0 && isOpen && (
            <p className="px-4 py-2 text-xs text-stone-500">No incluye los trabajos que aún esperan tu aprobación.</p>
          )}
        </section>

        {/* Mensaje de retiro */}
        {ot.status === "ready_for_pickup" && (
          <section className="rounded-2xl bg-green-50 border border-green-200 p-4 flex gap-3">
            <PackageCheck className="h-6 w-6 text-green-700 shrink-0" />
            <div>
              <p className="font-bold text-green-900">Lista para retirar</p>
              <p className="text-sm text-green-800">Tu bicicleta está lista. Puedes pasar a retirarla cuando quieras.</p>
              {ot.workshopAddress && (
                <a className="text-sm font-medium text-green-900 underline mt-1 inline-block" target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ot.workshopAddress)}`}>
                  {ot.workshopAddress}
                </a>
              )}
            </div>
          </section>
        )}

        {/* Seguimiento */}
        {ot.timeline.length > 0 && (
          <Section icon={Clock} title="Seguimiento">
            <ol className="relative border-l-2 border-stone-100 ml-2 space-y-4">
              {[...ot.timeline].reverse().map(ev => (
                <li key={ev.id} className="ml-4">
                  <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-orange-400 ring-4 ring-white" />
                  <p className="text-xs text-stone-400">{formatDateTime(ev.createdAt)}</p>
                  <p className="text-sm font-medium text-stone-800">{ev.title}</p>
                  {ev.detail && <p className="text-sm text-stone-600 bg-stone-50 rounded-lg px-2 py-1 mt-1">{ev.detail}</p>}
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* Contacto */}
        <footer className="text-center pt-2 space-y-3">
          {phoneDigits && (
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline"><a href={`tel:+${phoneDigits}`}><Phone className="h-4 w-4 mr-1" />Llamar</a></Button>
              <Button asChild variant="outline">
                <a href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(`Hola, consulto por mi orden ${ot.workOrderNumber}`)}`} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4 mr-1" />WhatsApp
                </a>
              </Button>
            </div>
          )}
          <p className="text-xs text-stone-400 flex items-center justify-center gap-1">
            <Bike className="h-3.5 w-3.5" /> Seguimiento de {ot.workshopName}{ot.workshopPhone ? ` · ${ot.workshopPhone}` : ""}
          </p>
        </footer>
      </div>

      <AlertDialog open={!!confirmReject} onOpenChange={(o) => !o && setConfirmReject(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Rechazar este trabajo?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmReject?.description} ({confirmReject ? formatCLP(confirmReject.total) : ""}). No lo realizaremos ni lo cobraremos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700"
              onClick={() => { if (confirmReject) sendDecision(confirmReject, "rejected"); setConfirmReject(null); }}>
              Sí, rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
