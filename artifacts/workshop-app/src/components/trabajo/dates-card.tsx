import { useEffect, useState } from "react";
import { useEstimateWorkOrderCompletion, useListPaymentMethods, useUpdateWorkOrder, type WorkOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";
import { CalendarDays, Pencil, Wallet, X } from "lucide-react";

// ── Fechas de la OT ─────────────────────────────────────────────────────────
// Ingreso → término estimado → terminada (lista para retiro) → entregada → pagada.
// Son fechas independientes: una bici puede terminarse un día, retirarse otro y pagarse antes o después.

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
// Días de calendario de `a` a `b` (positivo si b es posterior).
export function daysBetween(a: Date, b: Date) { return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS); }
export function formatDay(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : null;
}
function formatDuration(from: string, to: string) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < DAY_MS) return `${Math.max(1, Math.round(ms / (60 * 60 * 1000)))} h`;
  const days = ms / DAY_MS;
  return `${days.toLocaleString("es-CL", { maximumFractionDigits: 1 })} ${days < 1.05 ? "día" : "días"}`;
}
// "yyyy-mm-dd" del input → mediodía local (no cambia de día al pasar a UTC).
function dateInputToIso(value: string) { return new Date(`${value}T12:00:00`).toISOString(); }
function isoToDateInput(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// `action` va al lado de la fecha; `children` debajo.
function DateRow({ label, value, action, children }: { label: string; value: string | null; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className="flex items-center justify-end gap-1">
          <span className={cn("font-medium", !value && "text-muted-foreground font-normal")}>{value ?? "—"}</span>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}

export function WorkOrderDatesCard({ wo, onChanged }: { wo: WorkOrder; onChanged: () => void }) {
  const { toast } = useToast();
  const update = useUpdateWorkOrder();
  const estimate = useEstimateWorkOrderCompletion();
  const [editingEta, setEditingEta] = useState(false);
  const [etaDraft, setEtaDraft] = useState("");

  const isClosed = wo.status === "delivered" || wo.status === "cancelled";
  const eta = wo.estimatedDeliveryDate ? new Date(wo.estimatedDeliveryDate) : null;

  // Atraso o adelanto respecto del término estimado.
  let etaNote: { text: string; tone: "ok" | "late" | "muted" } | null = null;
  if (eta && wo.completedAt) {
    const diff = daysBetween(eta, new Date(wo.completedAt));
    etaNote = diff <= 0
      ? { text: diff === 0 ? "Terminada a tiempo" : `Terminada ${-diff} día(s) antes`, tone: "ok" }
      : { text: `Terminada ${diff} día(s) tarde`, tone: "late" };
  } else if (eta && wo.status !== "cancelled") {
    const left = daysBetween(new Date(), eta);
    etaNote = left < 0 ? { text: `Atrasada ${-left} día(s)`, tone: "late" }
      : { text: left === 0 ? "Vence hoy" : `Faltan ${left} día(s)`, tone: "muted" };
  }

  const [payOpen, setPayOpen] = useState(false);

  const save = (data: { estimatedDeliveryDate?: string | null; paidAt?: string | null; paymentMethodId?: number | null; paidAmount?: number | null }, title: string) => {
    update.mutate({ id: wo.id, data }, {
      onSuccess: () => { toast({ title }); setEditingEta(false); setPayOpen(false); onChanged(); },
      onError: (e: any) => toast({ variant: "destructive", title: "No se pudo guardar", description: e?.data?.error }),
    });
  };

  const recalc = () => {
    estimate.mutate({ id: wo.id }, {
      onSuccess: (r) => {
        toast({ title: "Término estimado calculado", description: formatDay(r.estimatedDeliveryDate) ?? undefined });
        onChanged();
      },
      onError: (e: any) => toast({ variant: "destructive", title: "No se pudo calcular", description: e?.data?.error }),
    });
  };

  const canEditEta = !isClosed && !wo.completedAt;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />Fechas
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm divide-y">
        <DateRow label="Ingreso" value={formatDay(wo.createdAt)} />

        {editingEta ? (
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-muted-foreground">Término estimado</span>
            <div className="flex items-center gap-1.5">
              <Input type="date" value={etaDraft} onChange={e => setEtaDraft(e.target.value)} className="h-8 w-40" data-testid="input-eta" />
              <Button size="sm" className="h-8" disabled={update.isPending}
                onClick={() => save({ estimatedDeliveryDate: etaDraft ? dateInputToIso(etaDraft) : null }, "Término estimado actualizado")}>
                Guardar
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingEta(false)}><X className="h-4 w-4" /></Button>
            </div>
          </div>
        ) : (
          <DateRow
            label="Término estimado"
            value={formatDay(wo.estimatedDeliveryDate)}
            action={canEditEta && (
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Editar fecha" data-testid="button-edit-eta"
                onClick={() => { setEtaDraft(wo.estimatedDeliveryDate ? isoToDateInput(wo.estimatedDeliveryDate) : ""); setEditingEta(true); }}>
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          >
            <div className="flex items-center justify-end gap-2">
              {etaNote && (
                <span className={cn("text-xs", etaNote.tone === "late" ? "text-red-600 font-medium" : etaNote.tone === "ok" ? "text-green-700" : "text-muted-foreground")}>
                  {etaNote.text}
                </span>
              )}
              {canEditEta && (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={estimate.isPending} onClick={recalc} data-testid="button-recalc-eta">
                  {wo.estimatedDeliveryDate ? "Recalcular" : "Calcular según carga"}
                </Button>
              )}
            </div>
          </DateRow>
        )}

        <DateRow label="Terminada" value={formatDay(wo.completedAt)}>
          {wo.completedAt && <p className="text-xs text-muted-foreground">Demoró {formatDuration(wo.createdAt, wo.completedAt)} desde el ingreso</p>}
        </DateRow>

        <DateRow label="Entregada" value={formatDay(wo.deliveredAt)} />

        <DateRow
          label="Pagada"
          value={formatDay(wo.paidAt)}
          action={wo.status !== "cancelled" && !wo.paidAt && (
            <Button variant="outline" size="sm" className="h-7 text-xs ml-1" disabled={update.isPending} data-testid="button-register-payment"
              onClick={() => setPayOpen(true)}>
              <Wallet className="h-3 w-3 mr-1" />Registrar pago
            </Button>
          )}
        >
          {wo.paidAt && (
            <p className="text-xs text-muted-foreground">
              {[wo.paymentMethodName, wo.paidAmount != null ? formatCLP(wo.paidAmount) : null].filter(Boolean).join(" · ")}
              {wo.paidAmount != null && wo.paidAmount < wo.total && <span className="text-amber-700"> · faltan {formatCLP(wo.total - wo.paidAmount)}</span>}
            </p>
          )}
          {wo.paidAt && wo.status !== "cancelled" && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" disabled={update.isPending}
              onClick={() => save({ paidAt: null }, "Pago anulado")}>
              Deshacer
            </Button>
          )}
        </DateRow>
      </CardContent>

      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} total={wo.total} pending={update.isPending}
        onConfirm={(paymentMethodId, paidAmount) => save({ paidAt: new Date().toISOString(), paymentMethodId, paidAmount }, "Pago registrado")} />
    </Card>
  );
}

function PaymentDialog({ open, onOpenChange, total, pending, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; total: number; pending: boolean;
  onConfirm: (paymentMethodId: number | null, paidAmount: number) => void;
}) {
  const { data: methods } = useListPaymentMethods();
  const [methodId, setMethodId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");

  // Un botón por nombre aunque el catálogo tenga métodos repetidos.
  const unique = (methods ?? []).filter((m: any) => m.active !== false)
    .filter((m: any, i: number, arr: any[]) => arr.findIndex(x => x.name.trim().toLowerCase() === m.name.trim().toLowerCase()) === i);

  useEffect(() => { if (open) { setAmount(String(Math.round(total))); setMethodId(null); } }, [open, total]);

  const value = Number(amount);
  const valid = amount !== "" && !isNaN(value) && value >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Método</Label>
            <div className="flex flex-wrap gap-2">
              {unique.map((m: any) => (
                <button key={m.id} type="button" onClick={() => setMethodId(m.id)} data-testid={`payment-method-${m.id}`}
                  className={cn("rounded-full border px-3 py-1.5 text-sm", methodId === m.id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Monto</Label>
            <Input type="number" inputMode="numeric" min="0" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-paid-amount" />
            {valid && value < total && <p className="text-xs text-amber-700">Queda un saldo de {formatCLP(total - value)}.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!valid || pending} onClick={() => onConfirm(methodId, value)} data-testid="button-confirm-payment">Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
