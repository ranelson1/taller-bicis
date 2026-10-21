import { useState } from "react";
import { Link } from "wouter";
import { useListWorkOrders, useListUsers, useListClients } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Search, Filter, UserCog, Bike, ChevronRight, AlertCircle } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  ready_to_work: "Lista para trabajar",
  in_progress: "En trabajo",
  quality_control: "Control de calidad",
  ready_for_pickup: "Lista para retiro",
  delivered: "Entregada",
  cancelled: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  ready_to_work: "bg-sky-50 text-sky-700 border-sky-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  quality_control: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_pickup: "bg-emerald-50 text-emerald-700 border-emerald-200",
  delivered: "bg-gray-50 text-gray-600 border-gray-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-gray-500",
  normal: "text-blue-600",
  high: "text-amber-600",
  urgent: "text-red-600",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function Ordenes() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [mechanicFilter, setMechanicFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: workOrders, isLoading } = useListWorkOrders({
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    mechanicId: mechanicFilter !== "all" ? parseInt(mechanicFilter) : undefined,
    clientId: clientFilter !== "all" ? parseInt(clientFilter) : undefined,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const { data: users } = useListUsers();
  const mechanics = (users ?? []).filter(u => u.role === "mechanic" && u.active);

  const { data: clients } = useListClients({});

  const filtered = workOrders ?? [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Órdenes de Trabajo</h1>
          <p className="text-muted-foreground mt-1">Gestión del trabajo activo en el taller.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, cliente o bicicleta..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="ready_to_work">Lista para trabajar</SelectItem>
            <SelectItem value="in_progress">En trabajo</SelectItem>
            <SelectItem value="quality_control">Control de calidad</SelectItem>
            <SelectItem value="ready_for_pickup">Lista para retiro</SelectItem>
            <SelectItem value="delivered">Entregada</SelectItem>
            <SelectItem value="cancelled">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Mecánico" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los mecánicos</SelectItem>
            {mechanics.map(m => (
              <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los clientes</SelectItem>
            {(clients ?? []).map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="w-[150px]"
          placeholder="Desde"
          title="Fecha desde"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="w-[150px]"
          placeholder="Hasta"
          title="Fecha hasta"
        />
        {(search || statusFilter !== "all" || mechanicFilter !== "all" || clientFilter !== "all" || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("all"); setMechanicFilter("all"); setClientFilter("all"); setDateFrom(""); setDateTo(""); }}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ClipboardList className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No hay órdenes de trabajo</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {search || statusFilter !== "all" || mechanicFilter !== "all"
              ? "Prueba con otros filtros"
              : "Crea una OT desde un presupuesto aprobado"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Número</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cliente / Bicicleta</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Mecánico</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Prioridad</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fecha</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(wo => (
                    <tr key={wo.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <Link href={`/ordenes/${wo.id}`}>
                            <span className="font-mono font-bold text-primary hover:underline">{wo.workOrderNumber}</span>
                          </Link>
                          {(wo as any).workCaseId && (wo as any).workCaseNumber && (
                            <Link href={`/trabajos/${(wo as any).workCaseId}`}>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer font-mono">
                                Trabajo: {(wo as any).workCaseNumber}
                              </span>
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{wo.clientName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{wo.bicycleName ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {wo.mechanicName ? (
                          <span className="text-sm">{wo.mechanicName}</span>
                        ) : (
                          <span className="text-xs text-amber-600 flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" /> Sin asignar
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={wo.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${PRIORITY_COLORS[wo.priority] ?? ""}`}>
                          {PRIORITY_LABELS[wo.priority] ?? wo.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(wo.total)}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {new Date(wo.createdAt).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/ordenes/${wo.id}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground mt-2">{filtered.length} orden{filtered.length !== 1 ? "es" : ""}</p>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(wo => (
              <Link key={wo.id} href={`/ordenes/${wo.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-mono font-bold text-primary text-base">{wo.workOrderNumber}</p>
                          {(wo as any).workCaseId && (wo as any).workCaseNumber && (
                            <Link href={`/trabajos/${(wo as any).workCaseId}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 font-mono hover:bg-violet-100">
                              Trabajo: {(wo as any).workCaseNumber}
                            </Link>
                          )}
                        </div>
                        <p className="text-sm font-medium text-foreground mt-0.5">{wo.clientName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{wo.bicycleName ?? "—"}</p>
                      </div>
                      <StatusBadge status={wo.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <UserCog className="h-3.5 w-3.5" />
                        {wo.mechanicName ?? <span className="text-amber-600">Sin mecánico</span>}
                      </span>
                      <span className={`font-medium ${PRIORITY_COLORS[wo.priority] ?? ""}`}>
                        {PRIORITY_LABELS[wo.priority] ?? wo.priority}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
