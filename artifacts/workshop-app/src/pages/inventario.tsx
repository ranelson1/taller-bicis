import { useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useListInventory, useListPurchases, useCreatePurchase, useGetWorkshopSettings, useGetPurchaseReaderStatus,
  type InventoryItem,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";
import { KIND_LABELS, fmtQty, marginPct } from "@/lib/inventory";
import { AdjustStockDialog, MovementsDialog, PartFormDialog } from "@/components/inventory/part-dialogs";
import { WhatsAppIcon } from "@/components/whatsapp-button";
import { Copy, FileUp, History, Loader2, MoreHorizontal, Package, PencilLine, Plus, Search, SlidersHorizontal } from "lucide-react";

// Inventario: stock de repuestos e insumos, compras (facturas/boletas) y lo que hay que comprar.

const TABS = [
  { value: "stock", label: "Stock" },
  { value: "compras", label: "Compras" },
  { value: "comprar", label: "Por comprar" },
] as const;

export default function Inventario() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab = TABS.find(t => t.value === new URLSearchParams(search).get("tab"))?.value ?? "stock";
  const { data: items } = useListInventory();
  const toBuy = (items ?? []).filter(i => i.needsReorder).length;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5">
      <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Package className="h-7 w-7" />Inventario</h1>
      <div className="inline-flex rounded-lg border bg-muted p-1 gap-1">
        {TABS.map(t => (
          <button key={t.value} type="button" onClick={() => navigate(`/inventario?tab=${t.value}`)} data-testid={`tab-${t.value}`}
            className={cn("rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}{t.value === "comprar" && toBuy > 0 && <span className="ml-1.5 rounded-full bg-red-600 text-white text-[10px] px-1.5 py-0.5">{toBuy}</span>}
          </button>
        ))}
      </div>
      {tab === "stock" && <StockTab />}
      {tab === "compras" && <PurchasesTab />}
      {tab === "comprar" && <ToBuyTab />}
    </div>
  );
}

// ── Stock ───────────────────────────────────────────────────────────────────────
function StockTab() {
  const { data: items, isLoading } = useListInventory();
  const { data: settings } = useGetWorkshopSettings();
  const recoversVat = !!settings?.recoversVat;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "part" | "supply" | "low">("all");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<InventoryItem | null>(null);

  const query = q.trim().toLowerCase();
  const visible = (items ?? []).filter(i =>
    (!query || i.name.toLowerCase().includes(query) || (i.sku ?? "").toLowerCase().includes(query) || (i.brand ?? "").toLowerCase().includes(query))
    && (filter === "all" || (filter === "low" ? i.needsReorder : i.kind === filter)));
  const stockValue = (items ?? []).reduce((s, i) => s + Math.max(i.stock, 0) * (i.costPrice ?? 0), 0);

  const actions = (i: InventoryItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Acciones"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setEditing(i)}><PencilLine className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAdjusting(i)}><SlidersHorizontal className="h-4 w-4 mr-2" />Corregir stock</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setHistory(i)}><History className="h-4 w-4 mr-2" />Movimientos</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-10" placeholder="Buscar por nombre, código o marca" value={q} onChange={e => setQ(e.target.value)} data-testid="input-inventory-search" />
        </div>
        <Button onClick={() => setCreating(true)} className="h-10" data-testid="button-new-part"><Plus className="h-4 w-4 mr-1" />Nuevo artículo</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {([["all", "Todos"], ["part", "Repuestos"], ["supply", "Insumos"], ["low", "Bajo mínimo"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFilter(v)}
            className={cn("rounded-full border px-3 py-1 text-sm", filter === v ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted")}>{l}</button>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">Valor del stock: <strong className="text-foreground">{formatCLP(Math.round(stockValue))}</strong></span>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : visible.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {(items ?? []).length === 0 ? "Todavía no hay artículos. Sube tu primera factura en Compras o crea uno." : "Nada coincide con la búsqueda."}
        </CardContent></Card>
      ) : (
        <>
          <div className="hidden md:block rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artículo</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Comprometido</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Margen</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(i => {
                  const m = i.kind === "part" ? marginPct(i.salePrice, i.costPrice, recoversVat) : null;
                  return (
                    <TableRow key={i.id} data-testid={`inventory-row-${i.id}`}>
                      <TableCell>
                        <div className="font-medium">{i.name}</div>
                        <div className="text-xs text-muted-foreground">{KIND_LABELS[i.kind]}{i.sku ? ` · ${i.sku}` : ""}{i.brand ? ` · ${i.brand}` : ""}</div>
                      </TableCell>
                      <TableCell className={cn("text-right font-medium", i.stock < 0 ? "text-red-600" : i.needsReorder ? "text-amber-700" : "")}>
                        {fmtQty(i.stock, i.unit)}
                        {i.minStock != null && <div className="text-[11px] text-muted-foreground font-normal">mín. {fmtQty(i.minStock, i.unit)}</div>}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{i.reserved ? fmtQty(i.reserved, i.unit) : "—"}</TableCell>
                      <TableCell className="text-right">{formatCLP(i.costPrice)}</TableCell>
                      <TableCell className="text-right">{i.kind === "part" ? formatCLP(i.salePrice) : "—"}</TableCell>
                      <TableCell className={cn("text-right", m != null && m < 15 ? "text-red-600 font-medium" : "text-muted-foreground")}>{m != null ? `${m.toFixed(0)} %` : "—"}</TableCell>
                      <TableCell className="text-right">{actions(i)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden space-y-2">
            {visible.map(i => (
              <Card key={i.id}>
                <CardContent className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{KIND_LABELS[i.kind]}{i.sku ? ` · ${i.sku}` : ""} · costo {formatCLP(i.costPrice)}{i.kind === "part" ? ` · precio ${formatCLP(i.salePrice)}` : ""}</p>
                    {i.reserved > 0 && <p className="text-xs text-muted-foreground">{fmtQty(i.reserved, i.unit)} comprometido en trabajos</p>}
                  </div>
                  <div className={cn("text-right font-semibold", i.stock < 0 ? "text-red-600" : i.needsReorder ? "text-amber-700" : "")}>{fmtQty(i.stock, i.unit)}</div>
                  {actions(i)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <PartFormDialog open={creating || !!editing} onOpenChange={o => { if (!o) { setCreating(false); setEditing(null); } }} item={editing} recoversVat={recoversVat} />
      <AdjustStockDialog item={adjusting} onOpenChange={o => !o && setAdjusting(null)} />
      <MovementsDialog item={history} onOpenChange={o => !o && setHistory(null)} />
    </div>
  );
}

// ── Compras ─────────────────────────────────────────────────────────────────────
const DOC_LABELS: Record<string, string> = { factura: "Factura", boleta: "Boleta", guia: "Guía", otro: "Documento" };

export function useImportPurchase() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const importFile = async (file: File, workOrderId?: number) => {
    setBusy(true);
    try {
      const type = file.type || (file.name.toLowerCase().endsWith(".xml") ? "application/xml" : "application/octet-stream");
      const res = await fetch("/api/purchases/import", { method: "POST", credentials: "include", headers: { "Content-Type": type === "text/xml" ? "application/xml" : type }, body: file });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo leer el documento");
      toast({ title: "Documento leído", description: `${data.items.length} línea(s). Revisa y confirma.` });
      navigate(`/inventario/compras/${data.id}${workOrderId ? `?ot=${workOrderId}` : ""}`);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "No se pudo leer el documento" });
    } finally {
      setBusy(false);
    }
  };
  return { importFile, busy };
}

function PurchasesTab() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: purchases, isLoading } = useListPurchases();
  const { data: reader } = useGetPurchaseReaderStatus();
  const create = useCreatePurchase();
  const { importFile, busy } = useImportPurchase();
  const inputRef = useRef<HTMLInputElement>(null);

  const manual = () => create.mutate({ data: { items: [] } }, {
    onSuccess: p => navigate(`/inventario/compras/${p.id}`),
    onError: () => toast({ variant: "destructive", title: "No se pudo crear la compra" }),
  });

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="font-medium">Ingresa una compra</p>
            <p className="text-sm text-muted-foreground">
              Sube el XML de la factura (lo descargas del SII o te lo manda el proveedor){reader?.pdfAndImages ? ", el PDF o una foto de la factura o boleta" : ""} y se llena solo.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => inputRef.current?.click()} disabled={busy} data-testid="button-upload-invoice">
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileUp className="h-4 w-4 mr-1" />}{busy ? "Leyendo…" : "Subir documento"}
            </Button>
            <Button variant="outline" onClick={manual} disabled={create.isPending} data-testid="button-manual-purchase">A mano</Button>
          </div>
          <input ref={inputRef} type="file" className="hidden" data-testid="input-invoice-file"
            accept={reader?.pdfAndImages ? ".xml,application/xml,text/xml,application/pdf,image/*" : ".xml,application/xml,text/xml"}
            onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-40" /> : (purchases ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Todavía no hay compras registradas.</p>
      ) : (
        <div className="rounded-md border bg-card divide-y">
          {(purchases ?? []).map(p => (
            <Link key={p.id} href={`/inventario/compras/${p.id}`}>
              <div className="flex items-center gap-3 p-3 hover:bg-muted/40 cursor-pointer" data-testid={`purchase-${p.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{p.supplierName ?? "Sin proveedor"}</p>
                  <p className="text-xs text-muted-foreground">
                    {DOC_LABELS[p.docType] ?? p.docType}{p.docNumber ? ` ${p.docNumber}` : ""} · {p.issuedOn ? new Date(`${p.issuedOn}T12:00:00`).toLocaleDateString("es-CL") : new Date(p.createdAt).toLocaleDateString("es-CL")}
                    {" · "}{p.itemCount} línea(s){p.forJobs ? ` · ${p.forJobs} para trabajos` : ""}
                  </p>
                </div>
                {p.status === "draft" && <span className="rounded-full bg-amber-100 text-amber-800 text-xs px-2 py-0.5">Por revisar</span>}
                <span className="font-semibold whitespace-nowrap">{formatCLP(p.total)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Por comprar ─────────────────────────────────────────────────────────────────
function ToBuyTab() {
  const { toast } = useToast();
  const { data: items, isLoading } = useListInventory();
  const list = (items ?? []).filter(i => i.needsReorder);
  const text = `Hola, quiero cotizar:\n${list.map(i => `• ${i.name}${i.sku ? ` (${i.sku})` : ""}: ${fmtQty(i.suggestedQuantity, i.unit)}`).join("\n")}`;

  if (isLoading) return <Skeleton className="h-40" />;
  if (list.length === 0) return <Card><CardContent className="py-10 text-center text-muted-foreground">Nada por comprar: todo está sobre su punto de recompra y alcanza para los trabajos abiertos.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Lo que está bajo el punto de recompra o no alcanza para los trabajos abiertos. La cantidad sugerida repone hasta el mínimo y cubre lo comprometido.</p>
      <div className="rounded-md border bg-card divide-y">
        {list.map(i => (
          <div key={i.id} className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium">{i.name}</p>
              <p className="text-xs text-muted-foreground">
                Hay {fmtQty(i.stock, i.unit)}{i.reserved ? ` · ${fmtQty(i.reserved, i.unit)} comprometido` : ""}{i.minStock != null ? ` · mínimo ${fmtQty(i.minStock, i.unit)}` : ""}
              </p>
            </div>
            <span className="font-semibold whitespace-nowrap">Comprar {fmtQty(i.suggestedQuantity, i.unit)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); toast({ title: "Lista copiada" }); }}>
          <Copy className="h-4 w-4 mr-1" />Copiar lista
        </Button>
        <Button asChild className="bg-[#25D366] hover:bg-[#1ebe5a] text-white">
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><WhatsAppIcon className="h-4 w-4 mr-1.5" />Enviar al proveedor</a>
        </Button>
      </div>
    </div>
  );
}
