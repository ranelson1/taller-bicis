import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAssignMechanicToWorkOrder, useGetMe, useListWorkOrders, useUpdateWorkOrderStatus, getListWorkOrdersQueryKey, type WorkOrder,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { WO_NEXT_ACTION, WO_STATUS_COLORS, WO_STATUS_LABELS } from "@/lib/work-status";
import { cn } from "@/lib/utils";
import { EtaBadge } from "@/components/trabajo/eta-badge";
import { ChevronRight, HandMetal, Loader2 } from "lucide-react";

// Mis trabajos: lo que me toca hacer, con botones grandes para avanzar (pensado para el celular, con las manos sucias).

const workHref = (wo: WorkOrder) => (wo.workCaseId ? `/trabajos/${wo.workCaseId}` : "/trabajos");

function JobCard({ wo, action }: { wo: WorkOrder; action: React.ReactNode }) {
  const pct = Math.min(100, Math.round(wo.progressPercentage ?? 0));
  return (
    <Card data-testid={`my-job-${wo.id}`}>
      <CardContent className="p-4 space-y-3">
        <Link href={workHref(wo)}>
          <div className="flex items-start gap-3 cursor-pointer">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm text-primary font-medium">{wo.workOrderNumber}</span>
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", WO_STATUS_COLORS[wo.status])}>{WO_STATUS_LABELS[wo.status]}</span>
                <EtaBadge wo={wo} />
              </div>
              <p className="text-lg font-semibold mt-1 truncate">{wo.clientName}</p>
              <p className="text-sm text-muted-foreground truncate">{wo.bicycleName}</p>
              {pct > 0 && wo.status !== "ready_for_pickup" && (
                <div className="flex items-center gap-2 mt-2 max-w-48">
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                  <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
                </div>
              )}
              {(wo.pendingApprovalCount ?? 0) > 0 && <p className="text-xs text-amber-800 mt-1">{wo.pendingApprovalCount} adicional(es) esperando al cliente</p>}
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
          </div>
        </Link>
        {action}
      </CardContent>
    </Card>
  );
}

function Section({ title, hint, count, children }: { title: string; hint?: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title} <span className="font-normal">({count})</span></h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

export default function MisTrabajos() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const { data: orders, isLoading } = useListWorkOrders();
  const updateStatus = useUpdateWorkOrderStatus();
  const assign = useAssignMechanicToWorkOrder();
  const refresh = () => qc.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });

  const all = orders ?? [];
  const mine = all.filter(wo => wo.mechanicId === me?.id);
  const toStart = mine.filter(wo => wo.status === "ready_to_work");
  const inProgress = mine.filter(wo => wo.status === "in_progress" || wo.status === "quality_control");
  const toDeliver = mine.filter(wo => wo.status === "ready_for_pickup");
  const free = all.filter(wo => !wo.mechanicId && ["ready_to_work", "in_progress", "quality_control"].includes(wo.status));
  const nothing = toStart.length + inProgress.length + toDeliver.length + free.length === 0;

  const advance = (wo: WorkOrder) => {
    const next = WO_NEXT_ACTION[wo.status]?.next;
    if (!next) return;
    updateStatus.mutate({ id: wo.id, data: { status: next as any } }, {
      onSuccess: () => { refresh(); toast({ title: WO_STATUS_LABELS[next], description: `${wo.workOrderNumber} · ${wo.clientName ?? ""}` }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo cambiar el estado" }),
    });
  };
  const take = (wo: WorkOrder) => {
    if (!me) return;
    assign.mutate({ id: wo.id, data: { mechanicId: me.id } }, {
      onSuccess: () => { refresh(); toast({ title: "Trabajo tomado", description: wo.workOrderNumber }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo tomar el trabajo" }),
    });
  };

  const advanceButton = (wo: WorkOrder) => (
    <Button className="w-full h-12 text-base" onClick={() => advance(wo)} disabled={updateStatus.isPending} data-testid={`advance-${wo.id}`}>
      {updateStatus.isPending && updateStatus.variables?.id === wo.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
      {WO_NEXT_ACTION[wo.status]?.label}
    </Button>
  );

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Mis trabajos</h1>
        <p className="text-muted-foreground">Lo que te toca hoy.</p>
      </div>

      {isLoading ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-32" />)}</div> : nothing ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No tienes trabajos pendientes. Cuando llegue una bici aparecerá aquí.</CardContent></Card>
      ) : (
        <>
          <Section title="En curso" count={inProgress.length}>
            {inProgress.map(wo => <JobCard key={wo.id} wo={wo} action={advanceButton(wo)} />)}
          </Section>
          <Section title="Por empezar" count={toStart.length}>
            {toStart.map(wo => <JobCard key={wo.id} wo={wo} action={advanceButton(wo)} />)}
          </Section>
          <Section title="Listos para retiro" hint="Se entregan desde el trabajo, donde se registra el pago." count={toDeliver.length}>
            {toDeliver.map(wo => (
              <JobCard key={wo.id} wo={wo} action={
                <Button asChild variant="outline" className="w-full h-12 text-base"><Link href={workHref(wo)}>Abrir para entregar</Link></Button>
              } />
            ))}
          </Section>
          <Section title="Sin asignar" hint="Nadie los tiene todavía." count={free.length}>
            {free.map(wo => (
              <JobCard key={wo.id} wo={wo} action={
                <Button variant="secondary" className="w-full h-12 text-base" onClick={() => take(wo)} disabled={assign.isPending} data-testid={`take-${wo.id}`}>
                  <HandMetal className="h-4 w-4 mr-2" />Tomar este trabajo
                </Button>
              } />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
