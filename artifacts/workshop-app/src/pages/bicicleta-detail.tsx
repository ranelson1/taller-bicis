import { Link, useParams } from "wouter";
import { useGetBicycleHistory, getGetBicycleHistoryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SetupCard } from "@/components/trabajo/setup-card";
import { WO_STATUS_COLORS, WO_STATUS_LABELS, formatCLP } from "@/lib/work-status";
import { cn } from "@/lib/utils";
import { ArrowLeft, Bike, History, User, Wrench } from "lucide-react";

// Historial de una bicicleta: todo lo que se le ha hecho, cuándo fue el último servicio de cada tipo y sus ajustes.

const TYPE_LABELS: Record<string, string> = { mtb: "MTB", road: "Ruta", gravel: "Gravel", urban: "Urbana", ebike: "E-Bike", kids: "Niños", other: "Otra" };

function ago(days: number) {
  if (days < 1) return "hoy";
  if (days < 30) return `hace ${days} día${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? "" : "es"}`;
  const years = Math.floor(days / 365);
  const rest = Math.floor((days % 365) / 30);
  return `hace ${years} año${years === 1 ? "" : "s"}${rest ? ` y ${rest} mes${rest === 1 ? "" : "es"}` : ""}`;
}

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function BicicletaDetail() {
  const { id } = useParams<{ id: string }>();
  const bikeId = Number(id);
  const { data, isLoading, isError } = useGetBicycleHistory(bikeId, { query: { enabled: !!bikeId, queryKey: getGetBicycleHistoryQueryKey(bikeId) } });

  if (isLoading) return <div className="p-8 max-w-4xl mx-auto"><Skeleton className="h-64" /></div>;
  if (isError || !data) {
    return <div className="p-8 max-w-4xl mx-auto text-muted-foreground">No encontré esa bicicleta. <Link href="/bicicletas" className="text-primary underline">Volver</Link></div>;
  }
  const { bicycle: bike } = data;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5">
      <Link href="/bicicletas" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" />Bicicletas</Link>

      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Bike className="h-7 w-7" />{bike.brand} {bike.model}</h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
          <Badge variant="outline">{TYPE_LABELS[bike.type] ?? bike.type}</Badge>
          {[bike.year, bike.color, bike.rimSize ? `aro ${bike.rimSize}` : null].filter(Boolean).join(" · ")}
          {bike.serialNumber && <span>· N° serie {bike.serialNumber}</span>}
        </p>
        {bike.clientName && (
          <Link href={`/clientes/${bike.clientId}`} className="text-sm text-primary hover:underline inline-flex items-center gap-1 mt-1"><User className="h-3.5 w-3.5" />{bike.clientName}</Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Trabajos entregados</p>
          <p className="text-2xl font-bold">{data.deliveredCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total invertido en el taller</p>
          <p className="text-2xl font-bold">{formatCLP(data.totalSpent)}</p>
        </CardContent></Card>
      </div>

      {/* Último servicio de cada tipo */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2"><Wrench className="h-4 w-4" />Último servicio de cada tipo</CardTitle></CardHeader>
        <CardContent>
          {data.lastServices.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay servicios terminados en esta bici.</p> : (
            <div className="divide-y">
              {data.lastServices.map(s => (
                <div key={`${s.serviceId ?? s.label}`} className="py-2 flex items-center gap-3 text-sm" data-testid={`last-service-${s.serviceId ?? s.label}`}>
                  <span className="flex-1 font-medium">{s.label}{s.count > 1 && <span className="font-normal text-muted-foreground"> · {s.count} veces</span>}</span>
                  <span className="text-xs text-muted-foreground">{day(s.lastOn)}</span>
                  <span className={cn("text-xs font-medium whitespace-nowrap rounded-full px-2 py-0.5",
                    s.daysAgo > 365 ? "bg-red-50 text-red-700" : s.daysAgo > 180 ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-700")}>{ago(s.daysAgo)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SetupCard bicycleId={bike.id} />

      {/* Trabajos */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2"><History className="h-4 w-4" />Trabajos ({data.jobs.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.jobs.length === 0 && <p className="text-sm text-muted-foreground">Sin trabajos todavía.</p>}
          {data.jobs.map(j => (
            <Link key={j.workOrderId} href={j.workCaseId ? `/trabajos/${j.workCaseId}` : "/trabajos"}>
              <div className="rounded-md border p-3 hover:bg-muted/40 cursor-pointer" data-testid={`history-job-${j.workOrderId}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-primary font-medium">{j.workOrderNumber}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", WO_STATUS_COLORS[j.status])}>{WO_STATUS_LABELS[j.status] ?? j.status}</span>
                  <span className="text-xs text-muted-foreground">{day(j.deliveredAt ?? j.receivedAt)}{j.mechanicName ? ` · ${j.mechanicName}` : ""}</span>
                  <span className="ml-auto font-semibold text-sm">{formatCLP(j.total)}</span>
                </div>
                <ul className="mt-1.5 text-sm text-muted-foreground list-disc pl-5">
                  {j.items.map((i, k) => <li key={k}>{i.description}</li>)}
                </ul>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
