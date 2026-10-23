import { useState } from "react";
import { Link } from "wouter";
import { useGetReportSummary } from "@workspace/api-client-react";
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

function Stat({ icon: Icon, label, value, hint, tone }: { icon: typeof Banknote; label: string; value: string; hint?: string; tone?: "red" | "green" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />{label}</p>
        <p className={cn("text-2xl font-bold mt-1", tone === "red" && "text-red-600", tone === "green" && "text-green-700")}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function MisNumeros() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("mes");
  const [from, to] = PERIODS.find(p => p.value === period)!.range();
  const { data, isLoading, isError } = useGetReportSummary({ from, to });

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

      {isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}</div>}
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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={Banknote} label="Cobrado en el período" value={formatCLP(data.collected.amount)} hint={`${data.collected.count} pago(s)`} />
            <Stat icon={Clock} label="Por cobrar (total)" value={formatCLP(data.receivable.amount)} hint={`${data.receivable.count} trabajo(s) entregado(s) sin pagar`} tone={data.receivable.amount > 0 ? "red" : undefined} />
            <Stat icon={ShoppingCart} label="Compras confirmadas" value={formatCLP(data.purchases.total)} hint={`${data.purchases.count} documento(s), con IVA`} />
            <Stat icon={PackageSearch} label="Valor del stock" value={formatCLP(data.stockValue)} hint="Lo que tienes guardado, a costo" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
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

          {data.receivable.items.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Quién te debe</CardTitle></CardHeader>
              <CardContent className="divide-y">
                {data.receivable.items.map(r => (
                  <Link key={r.workOrderId} href={r.workCaseId ? `/trabajos/${r.workCaseId}` : "/trabajos"}>
                    <div className="py-2 flex items-center gap-3 text-sm cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{r.clientName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.workOrderNumber}{r.deliveredAt ? ` · entregado ${new Date(r.deliveredAt).toLocaleDateString("es-CL")}` : ""}</p>
                      </div>
                      <span className="font-semibold text-red-600">{formatCLP(r.balance)}</span>
                    </div>
                  </Link>
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
