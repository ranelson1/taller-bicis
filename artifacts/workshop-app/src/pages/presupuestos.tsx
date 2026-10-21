import { useState } from "react";
import { Link } from "wouter";
import {
  useListQuotes,
  getListQuotesQueryKey,
  useDeleteQuote,
  type QuoteWithClient,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, ExternalLink, Trash2, FileText } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviado",
  partially_approved: "Aprobado parcial",
  approved: "Aprobado",
  rejected: "Rechazado",
  updated_after_sent: "Actualizado",
  ready_for_work_order: "Listo para OT",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  sent: "bg-blue-50 text-blue-700 border-blue-200",
  partially_approved: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  updated_after_sent: "bg-purple-50 text-purple-700 border-purple-200",
  ready_for_work_order: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  presencial: "Presencial",
  telefono: "Teléfono",
  email: "Email",
  instagram: "Instagram",
  otro: "Otro",
};

function formatCLP(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(num);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function Presupuestos() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<QuoteWithClient | null>(null);

  const { data: quotes, isLoading } = useListQuotes({ active: "true" });
  const deleteMutation = useDeleteQuote();

  const filtered = (quotes ?? []).filter((q) => {
    const matchSearch =
      !search ||
      q.quoteNumber.toLowerCase().includes(search.toLowerCase()) ||
      (q.clientName ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || q.status === statusFilter;
    const matchChannel = channelFilter === "all" || q.originChannel === channelFilter;
    return matchSearch && matchStatus && matchChannel;
  });

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id }, {
      onSuccess: () => {
        toast({ title: "Presupuesto eliminado" });
        setDeleteTarget(null);
        qc.invalidateQueries({ queryKey: getListQuotesQueryKey() });
      },
      onError: () => toast({ variant: "destructive", title: "Error al eliminar" }),
    });
  };

  const QuoteCard = ({ q }: { q: QuoteWithClient }) => (
    <Card className="hover:shadow-sm transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold text-primary">{q.quoteNumber}</span>
              <StatusBadge status={q.status} />
              {q.workCaseId && q.workCaseNumber && (
                <Link href={`/trabajos/${q.workCaseId}`} onClick={(e) => e.stopPropagation()}>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer font-mono">
                    Trabajo: {q.workCaseNumber}
                  </span>
                </Link>
              )}
            </div>
            <span className="font-medium truncate">{q.clientName ?? "—"}</span>
          </div>
          <Link href={`/presupuestos/${q.id}`}>
            <Button size="icon" variant="ghost" className="shrink-0">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {q.bicycleName && (
          <p className="text-muted-foreground truncate">🚲 {q.bicycleName}</p>
        )}
        <div className="flex items-center justify-between pt-1 border-t">
          <span className="text-muted-foreground">{CHANNEL_LABELS[q.originChannel] ?? q.originChannel}</span>
          <span className="font-semibold">{formatCLP(q.total)}</span>
        </div>
        {q.status === "draft" && (
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive w-full flex items-center gap-2 justify-center"
            onClick={() => setDeleteTarget(q)}
          >
            <Trash2 className="h-4 w-4" /> Eliminar borrador
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Presupuestos</h1>
          <p className="text-muted-foreground mt-1">Gestión de presupuestos de reparación.</p>
        </div>
        <Link href="/presupuestos/nuevo">
          <Button className="flex items-center gap-2" data-testid="button-new-quote">
            <Plus className="h-4 w-4" /> Nuevo Presupuesto
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número o cliente..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-quotes"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-52" data-testid="select-status-filter">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-full sm:w-44" data-testid="select-channel-filter">
            <SelectValue placeholder="Todos los canales" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los canales</SelectItem>
            {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                  <TableHead>N° Presupuesto</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Bicicleta</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Trabajo</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((q) => (
                  <TableRow key={q.id} data-testid={`row-quote-${q.id}`}>
                    <TableCell className="font-mono font-bold text-primary">{q.quoteNumber}</TableCell>
                    <TableCell>{q.clientName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{q.bicycleName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{CHANNEL_LABELS[q.originChannel] ?? q.originChannel}</TableCell>
                    <TableCell><StatusBadge status={q.status} /></TableCell>
                    <TableCell>
                      {q.workCaseId && q.workCaseNumber ? (
                        <Link href={`/trabajos/${q.workCaseId}`} onClick={(e) => e.stopPropagation()}>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 cursor-pointer font-mono">
                            Trabajo: {q.workCaseNumber}
                          </span>
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{q.estimatedLaborHours ? `${q.estimatedLaborHours}h` : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCLP(q.total)}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">{new Date(q.createdAt).toLocaleDateString("es-CL")}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/presupuestos/${q.id}`}>
                          <Button size="icon" variant="ghost" data-testid={`button-view-quote-${q.id}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                        {q.status === "draft" && (
                          <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(q)} data-testid={`button-delete-quote-${q.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      No hay presupuestos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {filtered.map((q) => <QuoteCard key={q.id} q={q} />)}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted-foreground bg-card rounded-lg border">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                No hay presupuestos.
              </div>
            )}
          </div>
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar presupuesto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{deleteTarget?.quoteNumber}</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
