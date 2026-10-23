import { useState } from "react";
import { Link } from "wouter";
import { useGetReportSummary, useGetWorkshopSettings } from "@workspace/api-client-react";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { QuickPayButton } from "@/components/trabajo/quick-pay";
import { paymentReminder } from "@/lib/whatsapp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";
import { Banknote, Clock, PackageSearch, ShoppingCart, TrendingUp } from "lucide-react";

// Mis números: cuánto facturó, cuánto cobró, cuánto gastó y cuánto le quedó de verdad (solo admin).

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => new Date();

const PERIODS = [
  { value: "mes", label: "Este mes", range: () => { const n = today(); return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(n)]; } },
  { value: "anterior", label: "Mes pasado", range: () => { const n = today(); return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { value: "90", label: "Últimos 90 días", range: () => { const n = today(); const f = new Date(n); f.setDate(f.getDate() - 89); return [ymd(f), ymd(n)]; } },
  { value: "anio", label: "Este año", range: () => { const n = today(); return [ymd(new Date(n.getFullYear(), 0, 1)), ymd(n)]; } },
] as const;

function Stat({ icon: Icon, label, value, hint, tone, href }: { icon: typeof Banknote; label: string; value: string; hint?: string; tone?: "red" | "green"; href?: string }) {
  const card = (
    <Card className={cn(href && "cursor-pointer transition-colors hover:bg-muted/40")}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />{label}</p>
        <p className={cn("text-2xl font-bold mt-1", tone === "red" && "text-red-600", tone === "green" && "text-green-700")}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
        {href && <p className="text-xs text-primary mt-1">Ver detalle →</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

export default function MisNumeros() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("mes");
  const [from, to] = PERIODS.find(p => p.value === period)!.range();
  const { data, isLoading, isError } = useGetReportSummary({ from, to });
  const { data: settings } = useGetWorkshopSettings();

  const j = data?.jobs;
  const hourCost = data?.laborCostPerHour ?? null;
  const perHourOk = j?.earnedPerHour != null && hourCost != null ? j.earnedPerHour >= hourCost : null;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><TrendingUp className="h-7 w-7" />Mis números</h1>
        <div className="ml-auto inline-flex rounded-lg border bg-muted p-1 gap-1 flex-wrap">
          {PERIODS.map(p => (
            <button key={p.value} type="button" onClick={() => setPeriod(p.value)} data-testid={`period-${p.value}`}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                period === p.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>{p.label}</button>
          ))}
        </div>
      </div>

      {isLoading && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}</div>}
      {isError && <Card><CardContent className="py-8 text-center text-muted-foreground">No se pudieron cargar los números. Solo el administrador puede verlos.</CardContent></Card>}

      {data && j && (
        <>
          {/* Lo que te quedó */}
          <Card className="border-2">
            <CardContent className="p-5 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Te quedó en {j.count} trabajo(s) entregado(s)</p>
                  <p className={cn("text-4xl font-bold", j.margin < 0 ? "text-red-600" : "text-green-700")} data-testid="net-margin">{formatCLP(j.margin)}</p>
                </div>
                {j.marginPct != null && <p className="text-lg font-semibold">{Math.round(j.marginPct)} % de margen</p>}
              </div>
              <div className="text-sm space-y-1.5 border-t pt-3">
                <div className="flex justify-between"><span className="text-muted-foreground">{data.recoversVat ? "Facturado (sin IVA)" : "Facturado"}</span><span>{formatCLP(j.revenue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Repuestos e insumos</span><span>− {formatCLP(j.materialsCost)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tu tiempo ({j.laborHours} h{hourCost != null ? ` × ${formatCLP(hourCost)}` : ""})</span><span>{hourCost != null ? `− ${formatCLP(j.laborCost)}` : "—"}</span></div>
              </div>
              {hourCost == null && <p className="text-xs text-amber-700">Configura el costo de tu hora en Configuración para descontar tu tiempo y ver el margen real.</p>}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Banknote} label="Cobrado en el período" value={formatCLP(data.collected.amount)} hint={`${data.collected.count} pago(s)`} />
            <Stat icon={Clock} label="Por cobrar (total)" value={formatCLP(data.receivable.amount)} hint={`${data.receivable.count} trabajo(s) entregado(s) sin pagar`} tone={data.receivable.amount > 0 ? "red" : undefined} href="/trabajos?filtro=unpaid" />
            <Stat icon={ShoppingCart} label="Compras confirmadas" value={formatCLP(data.purchases.total)} hint={`${data.purchases.count} documento(s), con IVA`} href="/inventario?tab=compras" />
            <Stat icon={PackageSearch} label="Valor del stock" value={formatCLP(data.stockValue)} hint="Lo que tienes guardado, a costo" href="/inventario" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">¿Te rinde la hora?</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                {j.earnedPerHour == null ? <p className="text-muted-foreground">Aún no hay trabajos entregados con horas estimadas en este período.</p> : (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Cada hora trabajada deja</span><strong>{formatCLP(j.earnedPerHour)}</strong></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Cada hora te cuesta</span><strong>{hourCost != null ? formatCLP(hourCost) : "—"}</strong></div>
                    {perHourOk != null && (
                      <p className={cn("rounded-md p-2.5 text-xs", perHourOk ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>
                        {perHourOk ? "Estás cubriendo el costo de tu hora." : "Estás cobrando menos de lo que te cuesta tu hora: revisa los precios de los servicios."}
                      </p>
                    )}
                    {j.avgTicket != null && <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Ticket promedio</span><span>{formatCLP(j.avgTicket)}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">En reparación ahora</span><span>{data.inProgress.count} · {formatCLP(data.inProgress.value)}</span></div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Trabajos con menos margen</CardTitle></CardHeader>
              <CardContent className="divide-y">
                {data.lowestMargins.length === 0 ? <p className="text-sm text-muted-foreground">Sin trabajos entregados en el período.</p> : data.lowestMargins.map(m => (
                  <Link key={m.workOrderId} href={m.workCaseId ? `/trabajos/${m.workCaseId}` : "/trabajos"}>
                    <div className="py-2 flex items-center gap-3 text-sm cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{m.workOrderNumber} · {m.clientName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.bicycleName ?? ""} · cobrado {formatCLP(m.total)}</p>
                      </div>
                      <div className={cn("text-right font-semibold", m.margin < 0 ? "text-red-600" : "")}>
                        {formatCLP(m.margin)}{m.marginPct != null && <span className="block text-xs font-normal text-muted-foreground">{Math.round(m.marginPct)} %</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Servicios más usados</CardTitle></CardHeader>
              <CardContent className="divide-y">
                {data.topServices.length === 0 ? <p className="text-sm text-muted-foreground">Sin servicios del catálogo en trabajos entregados.</p> : data.topServices.map(sv => (
                  <div key={sv.serviceId} className="py-2 flex items-center gap-3 text-sm" data-testid={`top-service-${sv.serviceId}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{sv.name}</p>
                      <p className="text-xs text-muted-foreground">{sv.uses} vez/veces · {formatCLP(sv.revenue)}</p>
                    </div>
                    <div className={cn("text-right font-semibold", sv.margin < 0 ? "text-red-600" : "")}>
                      {formatCLP(sv.margin)}{sv.marginPct != null && <span className="block text-xs font-normal text-muted-foreground">{Math.round(sv.marginPct)} %</span>}
                    </div>
                  </div>
                ))}
                {data.topServices.length > 0 && <p className="text-xs text-muted-foreground pt-2">Margen estimado: cobrado menos tu hora y los insumos de la receta.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Por mecánico</CardTitle></CardHeader>
              <CardContent className="divide-y">
                {data.byMechanic.length === 0 ? <p className="text-sm text-muted-foreground">Sin trabajos entregados en el período.</p> : data.byMechanic.map(m => (
                  <div key={m.mechanicId ?? "none"} className="py-2 text-sm" data-testid={`mechanic-${m.mechanicId ?? "none"}`}>
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{m.name} <span className="font-normal text-muted-foreground">· {m.jobs} trabajo(s)</span></span>
                      <span className={cn("font-semibold", m.margin < 0 ? "text-red-600" : "")}>{formatCLP(m.margin)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Facturó {formatCLP(m.revenue)} · repuestos {formatCLP(m.materialsCost)} · mano de obra {formatCLP(m.laborCost)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {data.receivable.items.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Quién te debe</CardTitle></CardHeader>
              <CardContent className="divide-y">
                {data.receivable.items.map(r => (
                  <div key={r.workOrderId} className="py-2 flex items-center gap-3 text-sm -mx-2 px-2 rounded hover:bg-muted/40">
                    <Link href={r.workCaseId ? `/trabajos/${r.workCaseId}` : "/trabajos"} className="min-w-0 flex-1 cursor-pointer">
                      <p className="font-medium truncate">{r.clientName ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{r.workOrderNumber}{r.deliveredAt ? ` · entregado ${new Date(r.deliveredAt).toLocaleDateString("es-CL")}` : ""}</p>
                    </Link>
                    <span className="font-semibold text-red-600">{formatCLP(r.balance)}</span>
                    <QuickPayButton workOrderId={r.workOrderId} total={r.total ?? r.balance} />
                    <WhatsAppButton phone={r.clientPhone} label="Cobrar" className="h-7"
                      text={paymentReminder(r.clientName, settings?.name, formatCLP(r.balance), r.workOrderNumber, settings?.paymentInfo)} />
                  </div>
                ))}
                {data.receivable.count > data.receivable.items.length && <p className="text-xs text-muted-foreground pt-2">Y {data.receivable.count - data.receivable.items.length} más.</p>}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
