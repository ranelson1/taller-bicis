import { useState } from "react";
import { Link } from "wouter";
import {
  useListReceptions,
  useListClients,
  type ReceptionWithDetails,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Bike, User, FileText, Clock } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  received: "Recibida",
  in_inspection: "En inspección",
  inspection_completed: "Inspección completa",
  waiting_quote_approval: "Esperando aprobación",
  ready_for_work_order: "Lista para OT",
  cancelled: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  received: "bg-blue-50 text-blue-700 border-blue-200",
  in_inspection: "bg-amber-50 text-amber-700 border-amber-200",
  inspection_completed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  waiting_quote_approval: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_work_order: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-gray-50 text-gray-500 border-gray-200",
};

export default function Recepciones() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: clients } = useListClients({});
  const { data: receptions, isLoading } = useListReceptions({
    status: statusFilter !== "all" ? statusFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const filtered = (receptions ?? []).filter((r) => {
    if (clientFilter !== "all" && String(r.clientId) !== clientFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.receptionNumber.toLowerCase().includes(s) ||
      (r.clientName ?? "").toLowerCase().includes(s) ||
      (r.bicycleName ?? "").toLowerCase().includes(s) ||
      (r.customerReportedProblem ?? "").toLowerCase().includes(s)
    );
  });

  const activeClients = (clients ?? []).filter((c: any) => c.active !== false);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Recepciones</h1>
          <p className="text-muted-foreground mt-1 text-sm">Bicicletas recibidas en el taller.</p>
        </div>
        <Link href="/recepciones/nueva">
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nueva recepción
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por número, cliente, bicicleta..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-[200px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="sm:w-[200px]">
              <SelectValue placeholder="Cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {activeClients.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Desde:</span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="flex-1" />
          </div>
          <div className="flex items-center gap-2 flex-1">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Hasta:</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="flex-1" />
          </div>
          {(dateFrom || dateTo || clientFilter !== "all" || statusFilter !== "all" || search) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setClientFilter("all"); setStatusFilter("all"); setSearch(""); }} className="shrink-0">
              Limpiar filtros
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No hay recepciones{search || statusFilter !== "all" || clientFilter !== "all" ? " con esos filtros" : ""}.</p>
          {!search && statusFilter === "all" && clientFilter === "all" && (
            <Link href="/recepciones/nueva">
              <Button variant="outline" className="mt-4 flex items-center gap-2 mx-auto">
                <Plus className="h-4 w-4" /> Registrar primera recepción
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Número / TR</TableHead>
                  <TableHead className="font-semibold">Cliente</TableHead>
                  <TableHead className="font-semibold">Bicicleta</TableHead>
                  <TableHead className="font-semibold">Estado</TableHead>
                  <TableHead className="font-semibold">Presupuesto</TableHead>
                  <TableHead className="font-semibold">Fecha ingreso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30 transition-colors">
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Link href={`/recepciones/${r.id}`}>
                          <span className="font-mono font-bold text-primary">{r.receptionNumber}</span>
                        </Link>
                        {r.workCaseId && r.workCaseNumber && (
                          <Link href={`/trabajos/${r.workCaseId}`}>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer font-mono">
                              Trabajo: {r.workCaseNumber}
                            </span>
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/recepciones/${r.id}`}>
                        <span className="flex items-center gap-1.5 text-sm">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />{r.clientName ?? "—"}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/recepciones/${r.id}`}>
                        <span className="flex items-center gap-1.5 text-sm">
                          <Bike className="h-3.5 w-3.5 text-muted-foreground" />{r.bicycleName ?? "—"}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/recepciones/${r.id}`}>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/recepciones/${r.id}`}>
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          {r.quoteNumber ? <><FileText className="h-3.5 w-3.5" />{r.quoteNumber}</> : "—"}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/recepciones/${r.id}`}>
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {new Date(r.receivedAt).toLocaleDateString("es-CL")}
                        </span>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((r) => (
              <ReceptionCard key={r.id} reception={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReceptionCard({ reception: r }: { reception: ReceptionWithDetails }) {
  return (
    <Link href={`/recepciones/${r.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-mono font-bold text-primary text-base">{r.receptionNumber}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
                {r.workCaseId && r.workCaseNumber && (
                  <Link href={`/trabajos/${r.workCaseId}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 font-mono hover:bg-violet-100">
                    Trabajo: {r.workCaseNumber}
                  </Link>
                )}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{r.clientName ?? "—"}</span>
                <span className="flex items-center gap-1.5"><Bike className="h-3.5 w-3.5" />{r.bicycleName ?? "—"}</span>
                {r.quoteNumber && (
                  <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{r.quoteNumber}</span>
                )}
              </div>
              {r.customerReportedProblem && (
                <p className="text-sm text-foreground mt-2 line-clamp-2">{r.customerReportedProblem}</p>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(r.receivedAt).toLocaleDateString("es-CL")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
