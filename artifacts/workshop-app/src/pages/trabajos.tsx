import { useState } from "react";
import { Link } from "wouter";
import {
  useListWorkCases,
  useListClients,
  useListUsers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Briefcase, Search, Plus, ExternalLink, FileText, Inbox, ClipboardList,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  lead: "Lead",
  quoted: "Presupuestado",
  quote_sent: "Presupuesto enviado",
  quote_approved: "Presupuesto aprobado",
  bike_received: "Bici recibida",
  in_inspection: "En inspección",
  ready_for_work_order: "Listo para OT",
  in_work_order: "En OT",
  in_progress: "En trabajo",
  quality_control: "Control calidad",
  ready_for_pickup: "Listo para retiro",
  delivered: "Entregado",
  cancelled: "Cancelado",
  closed: "Cerrado",
};

const STATUS_COLORS: Record<string, string> = {
  lead: "bg-gray-100 text-gray-700 border-gray-200",
  quoted: "bg-blue-50 text-blue-700 border-blue-200",
  quote_sent: "bg-indigo-50 text-indigo-700 border-indigo-200",
  quote_approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  bike_received: "bg-sky-50 text-sky-700 border-sky-200",
  in_inspection: "bg-amber-50 text-amber-700 border-amber-200",
  ready_for_work_order: "bg-teal-50 text-teal-700 border-teal-200",
  in_work_order: "bg-orange-50 text-orange-700 border-orange-200",
  in_progress: "bg-yellow-50 text-yellow-700 border-yellow-200",
  quality_control: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_pickup: "bg-green-50 text-green-700 border-green-200",
  delivered: "bg-gray-50 text-gray-500 border-gray-200",
  cancelled: "bg-red-50 text-red-600 border-red-200",
  closed: "bg-gray-100 text-gray-500 border-gray-200",
};

function formatCLP(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function Trabajos() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [mechanicFilter, setMechanicFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const apiParams: Record<string, string> = { active: "true" };
  if (statusFilter !== "all") apiParams.status = statusFilter;
  if (clientFilter !== "all") apiParams.clientId = clientFilter;
  if (mechanicFilter !== "all") apiParams.mechanicId = mechanicFilter;
  if (dateFrom) apiParams.dateFrom = dateFrom;
  if (dateTo) apiParams.dateTo = dateTo;
  if (search) apiParams.search = search;

  const { data: workCases, isLoading } = useListWorkCases(apiParams as any);
  const { data: clients } = useListClients({});
  const { data: users } = useListUsers();

  const activeClients = (clients ?? []).filter((c: any) => c.active !== false);
  const mechanics = (users ?? []).filter((u: any) => u.role === "mechanic" && u.active !== false);

  const WorkCaseCard = ({ wc }: { wc: any }) => (
    <Card className="hover:shadow-sm transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-primary">{wc.workOrderNumber ?? wc.workCaseNumber}</span>
              <StatusBadge status={wc.status ?? ""} />
            </div>
            <span className="font-medium truncate">{wc.clientName ?? "—"}</span>
          </div>
          <Link href={`/trabajos/${wc.id}`}>
            <Button size="icon" variant="ghost" className="shrink-0">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {wc.bicycleName && (
          <p className="text-muted-foreground truncate">🚲 {wc.bicycleName}</p>
        )}
        {wc.mechanicName && (
          <p className="text-muted-foreground text-xs">🔧 {wc.mechanicName}</p>
        )}
        {wc.progressPercentage !== null && wc.progressPercentage !== undefined && (
          <div className="space-y-1">
            <Progress value={wc.progressPercentage} className="h-1.5" />
            <span className="text-xs text-muted-foreground">{Number(wc.progressPercentage).toFixed(0)}% completado</span>
          </div>
        )}
        <div className="flex justify-between pt-1 border-t items-center">
          <span className="text-muted-foreground text-xs">{new Date(wc.createdAt ?? "").toLocaleDateString("es-CL")}</span>
          {wc.totalEstimatedAmount !== null && wc.totalEstimatedAmount !== undefined && (
            <span className="font-semibold">{formatCLP(wc.totalEstimatedAmount)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Briefcase className="h-8 w-8" /> Trabajos
          </h1>
          <p className="text-muted-foreground mt-1">Ficha unificada del recorrido de cada bicicleta.</p>
        </div>
        <Link href="/trabajos/nuevo">
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nuevo Trabajo
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="relative xl:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar TR, P, R, OT, cliente..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los clientes</SelectItem>
            {activeClients.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mechanicFilter} onValueChange={setMechanicFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Mecánico" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los mecánicos</SelectItem>
            {mechanics.map((m: any) => (
              <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 xl:col-span-1">
          <Input
            type="date"
            className="text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="Desde"
          />
          <Input
            type="date"
            className="text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="Hasta"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Trabajo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Bicicleta</TableHead>
                  <TableHead>Mecánico</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Documentos</TableHead>
                  <TableHead>Progreso</TableHead>
                  <TableHead className="text-right">Monto est.</TableHead>
                  <TableHead className="text-right">Creado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(workCases ?? []).map((wc) => (
                  <TableRow key={wc.id}>
                    <TableCell className="font-mono font-bold text-primary">{wc.workOrderNumber ?? wc.workCaseNumber}</TableCell>
                    <TableCell>{wc.clientName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{wc.bicycleName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{wc.mechanicName ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={wc.status ?? ""} /></TableCell>
                    <TableCell>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        {(wc.quoteCount ?? 0) > 0 && <span className="flex items-center gap-0.5"><FileText className="h-3 w-3" />{wc.quoteCount}</span>}
                        {(wc.receptionCount ?? 0) > 0 && <span className="flex items-center gap-0.5"><Inbox className="h-3 w-3" />{wc.receptionCount}</span>}
                        {(wc.workOrderCount ?? 0) > 0 && <span className="flex items-center gap-0.5"><ClipboardList className="h-3 w-3" />{wc.workOrderCount}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {wc.progressPercentage !== null && wc.progressPercentage !== undefined ? (
                        <div className="flex items-center gap-2 min-w-[80px]">
                          <Progress value={wc.progressPercentage} className="h-1.5 flex-1" />
                          <span className="text-xs text-muted-foreground w-8">{Number(wc.progressPercentage).toFixed(0)}%</span>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {wc.totalEstimatedAmount !== null && wc.totalEstimatedAmount !== undefined ? formatCLP(wc.totalEstimatedAmount) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {new Date(wc.createdAt ?? "").toLocaleDateString("es-CL")}
                    </TableCell>
                    <TableCell>
                      <Link href={`/trabajos/${wc.id}`}>
                        <Button size="icon" variant="ghost">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {(workCases ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      No hay trabajos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {(workCases ?? []).map((wc) => <WorkCaseCard key={wc.id} wc={wc} />)}
            {(workCases ?? []).length === 0 && (
              <div className="text-center py-12 text-muted-foreground bg-card rounded-lg border">
                <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-30" />
                No hay trabajos.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
