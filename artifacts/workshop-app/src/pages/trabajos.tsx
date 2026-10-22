import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListUsers, useListWorkCases, useListWorkOrders, type WorkOrder } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Briefcase, Clock, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkers } from "@/hooks/use-workers";
import { OPEN_WO_STATUSES, WO_STATUS_COLORS, WO_STATUS_LABELS, formatCLP, hasBalanceDue } from "@/lib/work-status";
import { EtaBadge } from "@/components/trabajo/eta-badge";
import { formatDay } from "@/components/trabajo/dates-card";

// Lista de trabajos: uno por OT, con el mismo estado que se ve en la ficha.

const FILTERS = [
  { value: "open", label: "Abiertos", match: (wo: WorkOrder) => OPEN_WO_STATUSES.includes(wo.status) },
  { value: "ready_to_work", label: "Recibidos", match: (wo: WorkOrder) => wo.status === "ready_to_work" },
  { value: "in_progress", label: "En reparación", match: (wo: WorkOrder) => wo.status === "in_progress" || wo.status === "quality_control" },
  { value: "ready_for_pickup", label: "Para retiro", match: (wo: WorkOrder) => wo.status === "ready_for_pickup" },
  { value: "delivered", label: "Entregados", match: (wo: WorkOrder) => wo.status === "delivered" },
  { value: "cancelled", label: "Cancelados", match: (wo: WorkOrder) => wo.status === "cancelled" },
  { value: "all", label: "Todos", match: () => true },
] as const;

const workHref = (wo: WorkOrder) => (wo.workCaseId ? `/trabajos/${wo.workCaseId}` : "/trabajos");

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap", WO_STATUS_COLORS[status])}>
      {WO_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function Trabajos() {
  const [, navigate] = useLocation();
  const { data: workOrders, isLoading } = useListWorkOrders();
  const { data: workCases } = useListWorkCases();
  const { data: users } = useListUsers();
  const { workers: mechanics, solo } = useWorkers();

  const [filter, setFilter] = useState<string>("open");
  const [search, setSearch] = useState("");
  const [mechanicId, setMechanicId] = useState("all");

  const all = workOrders ?? [];
  const q = search.toLowerCase().trim();
  const qDigits = q.replace(/\D/g, "");
  const matchesSearch = (wo: WorkOrder) => !q
    || wo.workOrderNumber.toLowerCase().includes(q)
    || (wo.clientName ?? "").toLowerCase().includes(q)
    || (wo.bicycleName ?? "").toLowerCase().includes(q)
    || (qDigits.length >= 3 && (wo.clientPhone ?? "").replace(/\D/g, "").includes(qDigits));
  const matchesMechanic = (wo: WorkOrder) => mechanicId === "all"
    || (mechanicId === "none" ? !wo.mechanicId : wo.mechanicId === Number(mechanicId));

  const base = all.filter(wo => matchesSearch(wo) && matchesMechanic(wo));
  const active = FILTERS.find(f => f.value === filter) ?? FILTERS[0];
  const visible = base.filter(active.match);
  const countFor = (f: typeof FILTERS[number]) => base.filter(f.match).length;

  // Trabajos antiguos que nunca llegaron a OT (presupuesto o recepción sueltos).
  const withoutOt = (workCases ?? []).filter(wc => (wc.workOrderCount ?? 0) === 0 && wc.active !== false
    && !["cancelled", "closed", "delivered"].includes(wc.status ?? ""));

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2"><Briefcase className="h-7 w-7" />Trabajos</h1>
        <Link href="/trabajos/nuevo">
          <Button className="h-10" data-testid="button-new-work"><Plus className="h-4 w-4 mr-1" />Nuevo</Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-10" placeholder="Buscar por OT, cliente, teléfono o bicicleta" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
        </div>
        {!solo && (
          <Select value={mechanicId} onValueChange={setMechanicId}>
            <SelectTrigger className="sm:w-48 h-10" data-testid="select-mechanic-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los mecánicos</SelectItem>
              <SelectItem value="none">Sin mecánico</SelectItem>
              {mechanics.map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap [scrollbar-width:none]">
        {FILTERS.map(f => (
          <button key={f.value} type="button" onClick={() => setFilter(f.value)} data-testid={`chip-${f.value}`}
            className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
              filter === f.value ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted")}>
            {f.label} <span className={cn("ml-1 text-xs", filter === f.value ? "opacity-80" : "text-muted-foreground")}>{countFor(f)}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {q || mechanicId !== "all" ? "Ningún trabajo coincide con la búsqueda." : `No hay trabajos ${active.label.toLowerCase()}.`}
        </CardContent></Card>
      ) : (
        <>
          {/* Escritorio */}
          <div className="hidden md:block rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OT</TableHead>
                  <TableHead>Cliente / bicicleta</TableHead>
                  <TableHead>Estado</TableHead>
                  {!solo && <TableHead>Mecánico</TableHead>}
                  <TableHead>Término</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(wo => (
                  <TableRow key={wo.id} className="cursor-pointer" data-testid={`row-wo-${wo.id}`}
                    onClick={() => navigate(workHref(wo))}>
                    <TableCell className="font-mono text-primary font-medium">{wo.workOrderNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium">{wo.clientName}</div>
                      <div className="text-xs text-muted-foreground">{wo.bicycleName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusPill status={wo.status} />
                        {(wo.pendingApprovalCount ?? 0) > 0 && OPEN_WO_STATUSES.includes(wo.status) && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-800"><Clock className="h-3 w-3" />{wo.pendingApprovalCount} por aprobar</span>
                        )}
                      </div>
                    </TableCell>
                    {!solo && (
                      <TableCell className={cn("text-sm", !wo.mechanicName && OPEN_WO_STATUSES.includes(wo.status) ? "text-amber-700" : "text-muted-foreground")}>
                        {wo.mechanicName ?? (OPEN_WO_STATUSES.includes(wo.status) ? "Sin asignar" : "—")}
                      </TableCell>
                    )}
                    <TableCell className="text-sm">
                      <div className="flex flex-col gap-0.5 items-start">
                        <span className="text-muted-foreground">{formatDay(wo.completedAt ?? wo.estimatedDeliveryDate) ?? "—"}</span>
                        <EtaBadge wo={wo} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {formatCLP(wo.total)}
                      {wo.status === "delivered" && hasBalanceDue(wo) && <div className="text-[11px] text-sky-700 font-normal">{wo.paidAt ? "con saldo" : "sin pagar"}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Móvil */}
          <div className="md:hidden space-y-2">
            {visible.map(wo => (
              <Link key={wo.id} href={workHref(wo)}>
                <Card className="cursor-pointer active:bg-muted/50" data-testid={`card-wo-${wo.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-primary font-medium">{wo.workOrderNumber}</span>
                      <StatusPill status={wo.status} />
                    </div>
                    <p className="font-medium mt-1">{wo.clientName}</p>
                    <p className="text-sm text-muted-foreground">{wo.bicycleName}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-xs">
                      <span className={cn(!wo.mechanicName && OPEN_WO_STATUSES.includes(wo.status) ? "text-amber-700" : "text-muted-foreground")}>
                        {solo ? "" : wo.mechanicName ?? (OPEN_WO_STATUSES.includes(wo.status) ? "Sin mecánico" : "")}
                      </span>
                      <div className="flex items-center gap-2">
                        {(wo.pendingApprovalCount ?? 0) > 0 && OPEN_WO_STATUSES.includes(wo.status) && <span className="text-amber-800">{wo.pendingApprovalCount} por aprobar</span>}
                        <EtaBadge wo={wo} />
                        <span className="font-semibold text-sm">{formatCLP(wo.total)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {withoutOt.length > 0 && (filter === "open" || filter === "all") && !q && (
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium">Trabajos antiguos sin orden de trabajo ({withoutOt.length})</p>
            <p className="text-xs text-muted-foreground">Quedaron como presupuesto o recepción antes de la OT única. Ábrelos para continuarlos o cancelarlos.</p>
            <div className="divide-y">
              {withoutOt.map(wc => (
                <Link key={wc.id} href={`/trabajos/${wc.id}`}>
                  <div className="flex justify-between gap-2 py-2 text-sm cursor-pointer hover:bg-muted/40 px-1 -mx-1 rounded">
                    <span><span className="font-mono text-muted-foreground mr-2">{wc.workCaseNumber}</span>{wc.clientName} · {wc.bicycleName ?? "sin bicicleta"}</span>
                    <span className="text-muted-foreground">{formatCLP(wc.totalEstimatedAmount)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
