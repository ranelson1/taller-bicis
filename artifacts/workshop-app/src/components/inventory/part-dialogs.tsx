import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePart, useUpdatePart, useAdjustInventory, useListInventoryMovements,
  getListInventoryQueryKey, getListPartsQueryKey, getListInventoryMovementsQueryKey, type InventoryItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";
import { KIND_LABELS, UNITS, fmtQty, marginPct } from "@/lib/inventory";

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

function useRefreshInventory() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getListInventoryQueryKey() });
    qc.invalidateQueries({ queryKey: getListPartsQueryKey() });
  };
}

// ── Crear / editar artículo ─────────────────────────────────────────────────────
export function PartFormDialog({ open, onOpenChange, item, recoversVat }: {
  open: boolean; onOpenChange: (o: boolean) => void; item: InventoryItem | null; recoversVat: boolean;
}) {
  const { toast } = useToast();
  const refresh = useRefreshInventory();
  const create = useCreatePart();
  const update = useUpdatePart();
  const empty = { name: "", kind: "part", unit: "un", sku: "", brand: "", costPrice: "", salePrice: "", minStock: "", initialStock: "" };
  const [f, setF] = useState(empty);

  useEffect(() => {
    if (!open) return;
    setF(item ? {
      name: item.name, kind: item.kind, unit: item.unit, sku: item.sku ?? "", brand: item.brand ?? "",
      costPrice: item.costPrice != null ? String(item.costPrice) : "", salePrice: item.salePrice != null ? String(item.salePrice) : "",
      minStock: item.minStock != null ? String(item.minStock) : "", initialStock: "",
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const margin = marginPct(numOrNull(f.salePrice), numOrNull(f.costPrice), recoversVat);
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const data = {
      name: f.name.trim(), kind: f.kind as "part" | "supply", unit: f.unit, sku: f.sku.trim() || null, brand: f.brand.trim() || null,
      costPrice: numOrNull(f.costPrice), suggestedPrice: numOrNull(f.salePrice), minStock: numOrNull(f.minStock),
    };
    const done = { onSuccess: () => { toast({ title: item ? "Artículo actualizado" : "Artículo creado" }); refresh(); onOpenChange(false); },
      onError: () => toast({ variant: "destructive", title: "No se pudo guardar" }) };
    if (item) update.mutate({ id: item.id, data }, done);
    else create.mutate({ data: { ...data, initialStock: numOrNull(f.initialStock) } }, done);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? "Editar artículo" : "Nuevo artículo"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Nombre *</Label><Input value={f.name} onChange={set("name")} placeholder="Pastillas freno Shimano B03S" data-testid="input-part-name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={f.kind} onValueChange={v => setF(x => ({ ...x, kind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="part">Repuesto (se cobra)</SelectItem>
                  <SelectItem value="supply">Insumo del taller</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unidad</Label>
              <Select value={f.unit} onValueChange={v => setF(x => ({ ...x, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Código / SKU</Label><Input value={f.sku} onChange={set("sku")} /></div>
            <div className="space-y-1.5"><Label>Marca</Label><Input value={f.brand} onChange={set("brand")} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Costo por {f.unit === "un" ? "unidad" : f.unit}</Label>
              <Input inputMode="decimal" value={f.costPrice} onChange={set("costPrice")} placeholder="Lo que te cuesta" data-testid="input-part-cost" />
            </div>
            <div className="space-y-1.5">
              <Label>Precio al cliente</Label>
              <Input inputMode="numeric" value={f.salePrice} onChange={set("salePrice")} placeholder={f.kind === "supply" ? "No se cobra aparte" : "PVP con IVA"} data-testid="input-part-price" />
              {margin != null && <p className={cn("text-xs", margin < 15 ? "text-red-600" : "text-muted-foreground")}>Margen {margin.toFixed(0)} %</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Punto de recompra</Label>
              <Input inputMode="decimal" value={f.minStock} onChange={set("minStock")} placeholder="Avísame bajo…" />
            </div>
            {!item && (
              <div className="space-y-1.5"><Label>Stock actual</Label><Input inputMode="decimal" value={f.initialStock} onChange={set("initialStock")} placeholder="0" /></div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={pending || !f.name.trim()} data-testid="button-save-part">{item ? "Guardar" : "Crear artículo"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ajustar stock ───────────────────────────────────────────────────────────────
export function AdjustStockDialog({ item, onOpenChange }: { item: InventoryItem | null; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const refresh = useRefreshInventory();
  const adjust = useAdjustInventory();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (item) { setCounted(String(item.stock)); setNote(""); } }, [item]);
  const value = numOrNull(counted);
  const diff = item && value != null ? value - item.stock : 0;

  const submit = () => {
    if (!item || value == null) return;
    adjust.mutate({ partId: item.id, data: { countedStock: value, note: note.trim() || undefined } }, {
      onSuccess: () => { toast({ title: "Stock corregido" }); refresh(); onOpenChange(false); },
      onError: () => toast({ variant: "destructive", title: "No se pudo corregir" }),
    });
  };

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corregir stock</DialogTitle>
          <DialogDescription>{item?.name}: el sistema tiene {fmtQty(item?.stock, item?.unit)}. Escribe lo que contaste.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Stock contado</Label>
            <Input inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} data-testid="input-counted-stock" />
            {diff !== 0 && <p className={cn("text-xs", diff < 0 ? "text-red-600" : "text-green-700")}>{diff > 0 ? "+" : ""}{fmtQty(diff, item?.unit)} respecto del sistema</p>}
          </div>
          <div className="space-y-1.5"><Label>Motivo</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Conteo mensual, se rompió, regalo al cliente…" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={adjust.isPending || value == null || diff === 0}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Historial de movimientos ────────────────────────────────────────────────────
const MOVE_LABELS: Record<string, string> = { purchase: "Compra", consumption: "Uso", return: "Devolución", adjustment: "Ajuste" };

export function MovementsDialog({ item, onOpenChange }: { item: InventoryItem | null; onOpenChange: (o: boolean) => void }) {
  const { data: moves, isLoading } = useListInventoryMovements(item?.id ?? 0, {
    query: { enabled: !!item, queryKey: getListInventoryMovementsQueryKey(item?.id ?? 0) },
  });
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
          <DialogDescription>Stock actual {fmtQty(item?.stock, item?.unit)} · costo promedio {formatCLP(item?.costPrice)}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto divide-y">
          {isLoading && <p className="text-sm text-muted-foreground py-3">Cargando…</p>}
          {!isLoading && (moves ?? []).length === 0 && <p className="text-sm text-muted-foreground py-3">Sin movimientos todavía.</p>}
          {(moves ?? []).map(m => (
            <div key={m.id} className="py-2 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{MOVE_LABELS[m.kind] ?? m.kind}
                  {m.workOrderNumber && m.workCaseId && <> · <Link href={`/trabajos/${m.workCaseId}`} className="text-primary hover:underline">{m.workOrderNumber}</Link></>}
                </p>
                <p className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}{m.userName ? ` · ${m.userName}` : ""}{m.note ? ` · ${m.note}` : ""}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={cn("font-semibold", m.quantity < 0 ? "text-red-600" : "text-green-700")}>{m.quantity > 0 ? "+" : ""}{fmtQty(m.quantity, item?.unit)}</p>
                {m.unitCost != null && <p className="text-xs text-muted-foreground">{formatCLP(m.unitCost)} c/u</p>}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { KIND_LABELS };
