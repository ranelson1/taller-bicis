import { Link } from "wouter";
import { useGetDashboardSummary, useGetWorkCasesSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Bike, Wrench, UserCog, FileText, Send, CheckCircle, Clock, Inbox, ClipboardList, Play, AlertCircle, Package, Folder } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const WC_STATUS_LABELS: Record<string, string> = {
  lead: "Leads",
  quote_sent: "Presupuesto enviado",
  quote_approved: "Presupuesto aprobado",
  bike_received: "Bici recibida",
  in_inspection: "En inspección",
  ready_for_work_order: "Listo para OT",
  in_work_order: "Con OT",
  in_progress: "En trabajo",
  quality_control: "Control calidad",
  ready_for_pickup: "Listo para retiro",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: wcSummary } = useGetWorkCasesSummary();

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Resumen general del taller.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Taller stats */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Taller</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard title="Clientes Activos" value={summary?.activeClients ?? 0} icon={Users} />
              <SummaryCard title="Bicicletas" value={summary?.totalBicycles ?? 0} icon={Bike} />
              <SummaryCard title="Servicios Activos" value={summary?.activeServices ?? 0} icon={Wrench} />
              <SummaryCard title="Mecánicos" value={summary?.activeMechanics ?? 0} icon={UserCog} />
            </div>
          </div>

          {/* Recepciones stats */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recepciones</h2>
              <Link href="/recepciones">
                <Button variant="ghost" size="sm" className="text-primary text-xs">Ver todas →</Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                title="Abiertas"
                value={summary?.receptionsReceived ?? 0}
                icon={Inbox}
                color="text-sky-600"
                href="/recepciones"
              />
              <SummaryCard
                title="En inspección"
                value={(summary?.receptionsInInspection ?? 0) + (summary?.receptionsInspectionCompleted ?? 0)}
                icon={Wrench}
                color="text-amber-600"
                href="/recepciones"
                highlight={!!summary?.receptionsInInspection && summary.receptionsInInspection > 0}
              />
              <SummaryCard
                title="Esperando aprobación"
                value={summary?.receptionsEsperandoAprobacion ?? 0}
                icon={Clock}
                color="text-purple-600"
                href="/recepciones"
                highlight={!!summary?.receptionsEsperandoAprobacion && summary.receptionsEsperandoAprobacion > 0}
              />
              <SummaryCard
                title="Listas para OT"
                value={summary?.receptionsListasParaOT ?? 0}
                icon={CheckCircle}
                color="text-emerald-600"
                href="/recepciones"
                highlight={!!summary?.receptionsListasParaOT && summary.receptionsListasParaOT > 0}
              />
            </div>
          </div>

          {/* Presupuestos stats */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Presupuestos</h2>
              <Link href="/presupuestos">
                <Button variant="ghost" size="sm" className="text-primary text-xs">Ver todos →</Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                title="Borradores"
                value={summary?.quotesDraft ?? 0}
                icon={FileText}
                color="text-gray-500"
                href="/presupuestos"
              />
              <SummaryCard
                title="Enviados"
                value={summary?.quotesSent ?? 0}
                icon={Send}
                color="text-blue-600"
                href="/presupuestos"
              />
              <SummaryCard
                title="Aprobados"
                value={summary?.quotesApproved ?? 0}
                icon={CheckCircle}
                color="text-green-600"
                href="/presupuestos"
              />
              <SummaryCard
                title="Pendientes"
                value={summary?.quotesPendingApproval ?? 0}
                icon={Clock}
                color="text-amber-600"
                href="/presupuestos"
                highlight={!!summary?.quotesPendingApproval && summary.quotesPendingApproval > 0}
              />
            </div>
          </div>

          {/* Órdenes de trabajo stats */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Órdenes de Trabajo</h2>
              <Link href="/ordenes">
                <Button variant="ghost" size="sm" className="text-primary text-xs">Ver todas →</Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <SummaryCard
                title="Activas total"
                value={summary?.workOrdersTotalActive ?? 0}
                icon={ClipboardList}
                color="text-slate-600"
                href="/ordenes"
              />
              <SummaryCard
                title="Sin mecánico"
                value={summary?.workOrdersNoMechanic ?? 0}
                icon={AlertCircle}
                color="text-amber-600"
                href="/ordenes"
                highlight={!!summary?.workOrdersNoMechanic && summary.workOrdersNoMechanic > 0}
              />
              <SummaryCard
                title="En trabajo"
                value={summary?.workOrdersInProgress ?? 0}
                icon={Play}
                color="text-amber-600"
                href="/ordenes"
              />
              <SummaryCard
                title="Control calidad"
                value={summary?.workOrdersQualityControl ?? 0}
                icon={CheckCircle}
                color="text-purple-600"
                href="/ordenes"
              />
              <SummaryCard
                title="Lista para retiro"
                value={summary?.workOrdersReadyForPickup ?? 0}
                icon={Package}
                color="text-emerald-600"
                href="/ordenes"
                highlight={!!summary?.workOrdersReadyForPickup && summary.workOrdersReadyForPickup > 0}
              />
              <SummaryCard
                title="Lista para trabajar"
                value={summary?.workOrdersReadyToWork ?? 0}
                icon={Wrench}
                color="text-sky-600"
                href="/ordenes"
              />
            </div>
          </div>

          {/* Trabajos (work cases) stats */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Trabajos (TR)</h2>
              <Link href="/trabajos">
                <Button variant="ghost" size="sm" className="text-primary text-xs">Ver todos →</Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                title="Total activos"
                value={wcSummary?.total ?? 0}
                icon={Folder}
                color="text-violet-600"
                href="/trabajos"
              />
              {(["lead","quote_sent","bike_received","in_work_order","ready_for_pickup","delivered"] as const).map(key => {
                const item = (wcSummary?.byStatus ?? []).find(s => s.status === key);
                return (
                  <SummaryCard
                    key={key}
                    title={WC_STATUS_LABELS[key] ?? key}
                    value={item?.count ?? 0}
                    icon={Folder}
                    color="text-violet-500"
                    href="/trabajos"
                  />
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PlaceholderCard title="Próximos Turnos" description="Agenda de hoy y mañana" />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  title, value, icon: Icon, color, href, highlight,
}: {
  title: string;
  value: number;
  icon: any;
  color?: string;
  href?: string;
  highlight?: boolean;
}) {
  const content = (
    <Card className={`transition-shadow ${href ? "hover:shadow-md cursor-pointer" : ""} ${highlight ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color ?? "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${color ?? "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-dashed border-2 bg-muted/30">
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg text-foreground">{title}</CardTitle>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
            Próximamente
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="h-24 flex items-center justify-center">
        <p className="text-sm text-muted-foreground/60 italic">Disponible en la próxima versión</p>
      </CardContent>
    </Card>
  );
}
