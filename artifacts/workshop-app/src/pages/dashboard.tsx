import { useState } from "react";
import { Link } from "wouter";
import { useGetMe, useGetWorkshopSettings, useListInventory, useListUsers, useListWorkOrders, type WorkOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { paymentReminder } from "@/lib/whatsapp";
import { OnboardingCard } from "@/components/onboarding-card";
import { AlertTriangle, CircleDollarSign, Clock, PackageCheck, Plus, ShoppingCart, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkers } from "@/hooks/use-workers";
import { WO_STATUS_LABELS, formatCLP, hasBalanceDue, balanceDue } from "@/lib/work-status";
import { daysBetween } from "@/components/trabajo/dates-card";
import { EtaBadge, daysToEta } from "@/components/trabajo/eta-badge";

// Inicio: qué hay que hacer hoy en el taller.
// Alertas accionables arriba, trabajos abiertos por estado y la carga de cada mecánico.

const BOARD = ["ready_to_work", "in_progress", "quality_control", "ready_for_pickup"] as const;
const MIN_JOB_HOURS = 1; // igual que la estimación del backend
const UNPAID_WINDOW_DAYS = 30;

const workHref = (wo: WorkOrder) => (wo.workCaseId ? `/trabajos/${wo.workCaseId}` : "/trabajos");
const remainingHours = (wo: WorkOrder) =>
  Math.max(wo.estimatedLaborHours || 0, MIN_JOB_HOURS) * (1 - Math.min(Math.max(wo.progressPercentage || 0, 0), 100) / 100);

function WorkRow({ wo, extra }: { wo: WorkOrder; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2 px-1 -mx-1 rounded-md hover:bg-muted/50">
      <Link href={workHref(wo)} className="min-w-0 flex-1 cursor-pointer">
        <p className="text-sm font-medium truncate">
          <span className="font-mono text-primary mr-1.5">{wo.workOrderNumber}</span>{wo.clientName}
        </p>
        <p className="text-xs text-muted-foreground truncate">{wo.bicycleName}{wo.mechanicName ? ` · ${wo.mechanicName}` : ""}</p>
      </Link>
      {extra}
    </div>
  );
}

function AlertCard({ title, icon: Icon, tone, items, render }: {
  title: string; icon: typeof Clock; tone: "red" | "amber" | "green" | "sky";
  items: WorkOrder[]; render: (wo: WorkOrder) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  const tones = {
    red: "border-red-200 [&_h3]:text-red-700",
    amber: "border-amber-200 [&_h3]:text-amber-800",
    green: "border-green-200 [&_h3]:text-green-700",
    sky: "border-sky-200 [&_h3]:text-sky-700",
  };
  return (
    <Card className={cn("border-2", tones[tone])}>
      <CardHeader className="pb-1">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Icon className="h-4 w-4" />{title} <span className="ml-auto text-xs font-normal text-muted-foreground">{items.length}</span></h3>
      </CardHeader>
      <CardContent className="pt-0 divide-y">
        {items.slice(0, 5).map(wo => <WorkRow key={wo.id} wo={wo} extra={render(wo)} />)}
        {items.length > 5 && <Link href="/trabajos"><p className="text-xs text-primary pt-2 cursor-pointer">Ver {items.length - 5} más →</p></Link>}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: me } = useGetMe();
  const { data: workOrders, isLoading } = useListWorkOrders();
  const { data: stock } = useListInventory();
  const toBuy = (stock ?? []).filter(i => i.needsReorder);
  const { data: users } = useListUsers();
  const { data: settings } = useGetWorkshopSettings();
  const { workers: mechanics, solo } = useWorkers();
  const isMechanic = me?.role === "mechanic";
  const [onlyMineChoice, setOnlyMineChoice] = useState<boolean | null>(null);
  // Quien hace trabajos puede alternar entre lo suyo y todo el taller. El mecánico parte viendo lo suyo; el admin, todo.
  const canScope = !!me?.doesJobs && !solo;
  const onlyMine = onlyMineChoice ?? isMechanic;

  const all = workOrders ?? [];
  const scoped = canScope && onlyMine ? all.filter(wo => wo.mechanicId === me?.id) : all;
  const open = scoped.filter(wo => (BOARD as readonly string[]).includes(wo.status));
  const today = new Date();

  const late = open.filter(wo => (daysToEta(wo) ?? 0) < 0).sort((a, b) => (daysToEta(a) ?? 0) - (daysToEta(b) ?? 0));
  const waitingClient = open.filter(wo => (wo.pendingApprovalCount ?? 0) > 0 && wo.status !== "ready_for_pickup");
  const notPickedUp = scoped.filter(wo => wo.status === "ready_for_pickup")
    .sort((a, b) => new Date(a.completedAt ?? a.updatedAt).getTime() - new Date(b.completedAt ?? b.updatedAt).getTime());
  const unpaid = scoped.filter(wo => wo.status === "delivered" && hasBalanceDue(wo) && wo.deliveredAt
    && daysBetween(new Date(wo.deliveredAt), today) <= UNPAID_WINDOW_DAYS);

  // Carga: horas que faltan por mecánico vs su capacidad diaria.
  // Capacidad diaria = horas netas del taller (horario − colación) en la parte que trabaja cada mecánico.
  const shopWeekly = settings?.weeklyNetHours ?? 40;
  const openDays = settings?.schedule.length || 5;
  const load = mechanics.map((m: any) => {
    const mine = all.filter(wo => wo.mechanicId === m.id && ["ready_to_work", "in_progress", "quality_control"].includes(wo.status));
    const hours = mine.reduce((s, wo) => s + remainingHours(wo), 0);
    const daily = Math.min(m.weeklyHours || shopWeekly, shopWeekly) / openDays;
    return { id: m.id, name: m.name, count: mine.length, hours, daily, days: daily ? hours / daily : null };
  });
  const unassigned = all.filter(wo => !wo.mechanicId && ["ready_to_work", "in_progress", "quality_control"].includes(wo.status));

  const hasAlerts = late.length + waitingClient.length + notPickedUp.length + unpaid.length > 0;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Hola{me?.name ? `, ${me.name.split(" ")[0]}` : ""}</h1>
          <p className="text-muted-foreground first-letter:uppercase">{today.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div className="flex items-center gap-3">
          {canScope && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={onlyMine} onCheckedChange={setOnlyMineChoice} data-testid="switch-only-mine" />Solo mis trabajos
            </label>
          )}
          <Link href="/trabajos/nuevo">
            <Button className="h-11" data-testid="button-new-work"><Plus className="h-4 w-4 mr-1" />Nuevo trabajo</Button>
          </Link>
        </div>
      </div>

      {(me?.role === "admin" || me?.role === "superadmin") && <OnboardingCard />}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40" />)}</div>
      ) : (
        <>
          {toBuy.length > 0 && (
            <Link href="/inventario?tab=comprar">
              <Card className="border-2 border-amber-200 cursor-pointer hover:bg-muted/40" data-testid="alert-to-buy">
                <CardContent className="py-3 flex items-center gap-3 text-sm">
                  <ShoppingCart className="h-4 w-4 text-amber-700" />
                  <span><strong>{toBuy.length}</strong> artículo(s) por comprar: {toBuy.slice(0, 3).map(i => i.name).join(", ")}{toBuy.length > 3 ? "…" : ""}</span>
                  <span className="ml-auto text-primary">Ver lista →</span>
                </CardContent>
              </Card>
            </Link>
          )}

          {/* Alertas */}
          {hasAlerts ? (
            <div className="grid gap-4 md:grid-cols-2">
              <AlertCard title="Atrasados" icon={AlertTriangle} tone="red" items={late} render={wo => <EtaBadge wo={wo} />} />
              <AlertCard title="Esperando al cliente" icon={Clock} tone="amber" items={waitingClient}
                render={wo => <span className="text-xs text-amber-800 whitespace-nowrap">{wo.pendingApprovalCount} por aprobar</span>} />
              <AlertCard title="Listas, sin retirar" icon={PackageCheck} tone="green" items={notPickedUp}
                render={wo => {
                  const d = daysBetween(new Date(wo.completedAt ?? wo.updatedAt), today);
                  return <span className={cn("text-xs whitespace-nowrap", d >= 3 ? "text-red-700 font-medium" : "text-muted-foreground")}>{d === 0 ? "desde hoy" : `hace ${d} d`}</span>;
                }} />
              <AlertCard title="Entregadas sin pagar" icon={CircleDollarSign} tone="sky" items={unpaid}
                render={wo => {
                  const owed = balanceDue(wo);
                  return (
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-medium whitespace-nowrap">{formatCLP(owed)}</span>
                      <WhatsAppButton phone={wo.clientPhone} text={paymentReminder(wo.clientName, settings?.name, formatCLP(owed), wo.workOrderNumber)} label="Cobrar" className="h-7" />
                    </span>
                  );
                }} />
            </div>
          ) : (
            <Card><CardContent className="py-6 text-sm text-muted-foreground text-center">Nada urgente: no hay trabajos atrasados, esperando al cliente ni por cobrar.</CardContent></Card>
          )}

          {/* Tablero por estado */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">En el taller ({open.length})</h2>
              <Link href="/trabajos"><span className="text-xs text-primary cursor-pointer">Ver todos →</span></Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {BOARD.map(st => {
                const col = open.filter(wo => wo.status === st);
                return (
                  <Card key={st} className="bg-muted/30">
                    <CardHeader className="pb-1 pt-4">
                      <CardTitle className="text-sm flex items-center justify-between">{WO_STATUS_LABELS[st]}<span className="text-muted-foreground font-normal">{col.length}</span></CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pb-4">
                      {col.length === 0 && <p className="text-xs text-muted-foreground py-2">—</p>}
                      {col.map(wo => (
                        <Link key={wo.id} href={workHref(wo)}>
                          <div className="rounded-md border bg-card p-2.5 hover:border-primary cursor-pointer" data-testid={`board-card-${wo.id}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-primary">{wo.workOrderNumber}</span>
                              <EtaBadge wo={wo} />
                            </div>
                            <p className="text-sm font-medium truncate mt-0.5">{wo.clientName}</p>
                            <p className="text-xs text-muted-foreground truncate">{wo.bicycleName}</p>
                            {!solo && <p className={cn("text-xs mt-1", wo.mechanicName ? "text-muted-foreground" : "text-amber-700")}>{wo.mechanicName ?? "Sin mecánico"}</p>}
                          </div>
                        </Link>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Carga por mecánico */}
          {!isMechanic && mechanics.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2"><Users className="h-4 w-4" />{solo ? "Tu carga" : "Carga del taller"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {load.map(m => (
                  <div key={m.id}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted-foreground">
                        {m.count} trabajo(s) · {m.hours.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h
                        {m.days !== null ? ` · ≈ ${m.days.toLocaleString("es-CL", { maximumFractionDigits: 1 })} día(s)` : ""}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted mt-1 overflow-hidden">
                      {/* La barra llena = una semana de trabajo en cola. */}
                      <div className={cn("h-full", (m.days ?? 0) > openDays ? "bg-red-500" : (m.days ?? 0) > 2 ? "bg-amber-500" : "bg-green-500")}
                        style={{ width: `${Math.min(100, ((m.days ?? 0) / openDays) * 100)}%` }} />
                    </div>
                  </div>
                ))}
                {unassigned.length > 0 && !solo && (
                  <p className="text-sm text-amber-700">{unassigned.length} trabajo(s) sin mecánico asignado.</p>
                )}
                <p className="text-xs text-muted-foreground">Horas que faltan según lo estimado por servicio. La barra completa equivale a una semana de cola.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
