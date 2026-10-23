import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPurchase, useUpdatePurchase, useConfirmPurchase, useDeletePurchase, useListInventory, useListWorkOrders,
  useGetWorkshopSettings, getListPurchasesQueryKey, getGetPurchaseQueryKey, getListInventoryQueryKey, getListPartsQueryKey,
  type PurchaseInput,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { OPEN_WO_STATUSES, formatCLP } from "@/lib/work-status";
import { UNITS, effectiveCost, priceWithMargin, marginPct } from "@/lib/inventory";
import { ArrowLeft, CheckCircle2, FileText, Plus, Trash2 } from "lucide-react";

// Editor de una compra (factura/boleta): revisar lo leído, asignar a artículos y a trabajos, confirmar.

type Line = {
  partId: number | null; description: string; supplierCode: string; quantity: string; unit: string;
  unitCostNet: string; workOrderId: number | null; salePrice: string;
};
const emptyLine = (workOrderId: number | null = null): Line => ({
  partId: null, description: "", supplierCode: "", quantity: "1", unit: "un", unitCostNet: "", workOrderId, salePrice: "",
});
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const NONE = "none";

export default function CompraDetail() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const otPreset = Number(new URLSearchParams(useSearch()).get("ot")) || null;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: purchase, isLoading } = useGetPurchase(pid);
  const { data: parts } = useListInventory();
  const { data: orders } = useListWorkOrders();
  const { data: settings } = useGetWorkshopSettings();
  const save = useUpdatePurchase();
  const confirm = useConfirmPurchase();
  const del = useDeletePurchase();

  const [head, setHead] = useState({ supplierName: "", supplierRut: "", docType: "factura", docNumber: "", issuedOn: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!purchase) return;
    setHead({
      supplierName: purchase.supplierName ?? "", supplierRut: purchase.supplierRut ?? "", docType: purchase.docType,
      docNumber: purchase.docNumber ?? "", issuedOn: purchase.issuedOn ?? "", notes: purchase.notes ?? "",
    });
    const mapped = purchase.items.map<Line>(i => ({
      partId: i.partId ?? null, description: i.description, supplierCode: i.supplierCode ?? "", quantity: String(i.quantity),
      unit: i.unit ?? i.partUnit ?? "un", unitCostNet: String(i.unitCostNet), workOrderId: i.workOrderId ?? null,
      salePrice: i.salePrice != null ? String(i.salePrice) : "",
    }));
    setLines(mapped.length ? mapped : [emptyLine(otPreset)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase]);

  const openOrders = (orders ?? []).filter(o => OPEN_WO_STATUSES.includes(o.status));
  const recoversVat = !!settings?.recoversVat;
  const marginDefault = settings?.defaultPartsMarginPct ?? 30;
  const draft = purchase?.status === "draft";
  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const pickPart = (i: number, v: string) => {
    if (v === NONE) return setLine(i, { partId: null });
    const p = (parts ?? []).find(x => x.id === Number(v));
    if (p) setLine(i, { partId: p.id, unit: p.unit, description: lines[i].description || p.name });
  };

  const body = (): PurchaseInput => ({
    supplierName: head.supplierName.trim() || null, supplierRut: head.supplierRut.trim() || null,
    docType: head.docType as PurchaseInput["docType"], docNumber: head.docNumber.trim() || null,
    issuedOn: head.issuedOn || null, notes: head.notes.trim() || null,
    items: lines.filter(l => l.description.trim()).map(l => ({
      partId: l.partId, description: l.description.trim(), supplierCode: l.supplierCode.trim() || null,
      quantity: num(l.quantity) ?? 0, unit: l.unit, unitCostNet: num(l.unitCostNet) ?? 0,
      workOrderId: l.workOrderId, salePrice: num(l.salePrice),
    })),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListPurchasesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPurchaseQueryKey(pid) });
    qc.invalidateQueries({ queryKey: getListInventoryQueryKey() });
    qc.invalidateQueries({ queryKey: getListPartsQueryKey() });
  };
  const fail = (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo guardar" });

  const saveDraft = () => save.mutate({ id: pid, data: body() }, { onSuccess: () => { toast({ title: "Borrador guardado" }); refresh(); }, onError: fail });
  const doConfirm = () => save.mutate({ id: pid, data: body() }, {
    onError: fail,
    onSuccess: () => confirm.mutate({ id: pid }, {
      onError: fail,
      onSuccess: () => { toast({ title: "Compra confirmada", description: "El stock ya está actualizado" }); refresh(); navigate("/inventario?tab=compras"); },
    }),
  });
  const doDelete = () => {
    if (!window.confirm("¿Borrar este borrador?")) return;
    del.mutate({ id: pid }, { onSuccess: () => { refresh(); navigate("/inventario?tab=compras"); }, onError: fail });
  };

  if (isLoading || !purchase) return <div className="p-8"><Skeleton className="h-64" /></div>;

  const netTotal = lines.reduce((s, l) => s + (num(l.unitCostNet) ?? 0) * (num(l.quantity) ?? 0), 0);
  const valid = lines.some(l => l.description.trim() && (num(l.quantity) ?? 0) > 0 && num(l.unitCostNet) != null);
  const busy = save.isPending || confirm.isPending;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5">
      <Link href="/inventario?tab=compras" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" />Compras</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{draft ? "Revisar compra" : "Compra"}{purchase.docNumber ? ` ${purchase.docNumber}` : ""}</h1>
        {!draft && <span className="rounded-full bg-green-100 text-green-800 text-xs px-2 py-0.5">Confirmada</span>}
        {purchase.fileUrl && <a href={purchase.fileUrl} target="_blank" rel="noreferrer" className="ml-auto text-sm text-primary hover:underline inline-flex items-center gap-1"><FileText className="h-4 w-4" />Ver documento</a>}
      </div>
      {draft && purchase.source !== "manual" && <p className="text-sm text-muted-foreground">Esto se leyó del documento. Revisa que cantidades y costos estén bien antes de confirmar: al confirmar suma stock.</p>}

      <Card><CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5 sm:col-span-2"><Label>Proveedor</Label>
          <Input disabled={!draft} value={head.supplierName} onChange={e => setHead(h => ({ ...h, supplierName: e.target.value }))} data-testid="input-supplier" /></div>
        <div className="space-y-1.5"><Label>RUT</Label>
          <Input disabled={!draft} value={head.supplierRut} onChange={e => setHead(h => ({ ...h, supplierRut: e.target.value }))} /></div>
        <div className="space-y-1.5"><Label>Documento</Label>
          <Select disabled={!draft} value={head.docType} onValueChange={v => setHead(h => ({ ...h, docType: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[["factura", "Factura"], ["boleta", "Boleta"], ["guia", "Guía"], ["otro", "Otro"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1.5"><Label>N°</Label>
          <Input disabled={!draft} value={head.docNumber} onChange={e => setHead(h => ({ ...h, docNumber: e.target.value }))} /></div>
        <div className="space-y-1.5"><Label>Fecha</Label>
          <Input type="date" disabled={!draft} value={head.issuedOn} onChange={e => setHead(h => ({ ...h, issuedOn: e.target.value }))} /></div>
      </CardContent></Card>

      <div className="space-y-3">
        {lines.map((l, i) => {
          const unitCost = num(l.unitCostNet);
          const cost = unitCost != null ? effectiveCost(unitCost, recoversVat) : null;
          const suggested = cost != null ? priceWithMargin(cost, marginDefault) : null;
          const price = num(l.salePrice) ?? suggested;
          const m = l.workOrderId || l.salePrice ? marginPct(price, cost, recoversVat) : null;
          return (
            <Card key={i} data-testid={`purchase-line-${i}`}><CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                <div className="space-y-1.5 sm:col-span-4"><Label>Descripción</Label>
                  <Input disabled={!draft} value={l.description} onChange={e => setLine(i, { description: e.target.value })} data-testid={`line-desc-${i}`} /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label>Código proveedor</Label>
                  <Input disabled={!draft} value={l.supplierCode} onChange={e => setLine(i, { supplierCode: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Cantidad</Label>
                  <Input disabled={!draft} inputMode="decimal" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} data-testid={`line-qty-${i}`} /></div>
                <div className="space-y-1.5"><Label>Unidad</Label>
                  <Select disabled={!draft} value={l.unit} onValueChange={v => setLine(i, { unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5 sm:col-span-2"><Label>Costo unitario neto</Label>
                  <Input disabled={!draft} inputMode="decimal" value={l.unitCostNet} onChange={e => setLine(i, { unitCostNet: e.target.value })} data-testid={`line-cost-${i}`} />
                  {cost != null && <p className="text-xs text-muted-foreground">Te cuesta {formatCLP(cost)} {recoversVat ? "(sin IVA)" : "(con IVA)"}</p>}</div>
                <div className="space-y-1.5 sm:col-span-2"><Label>Precio al cliente (PVP)</Label>
                  <Input disabled={!draft} inputMode="numeric" value={l.salePrice} onChange={e => setLine(i, { salePrice: e.target.value })}
                    placeholder={suggested != null ? `Sugerido ${formatCLP(suggested)}` : "Opcional"} data-testid={`line-price-${i}`} />
                  {m != null && <p className="text-xs text-muted-foreground">Margen {m.toFixed(0)} %</p>}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Artículo del inventario</Label>
                  <Select disabled={!draft} value={l.partId ? String(l.partId) : NONE} onValueChange={v => pickPart(i, v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Crear artículo nuevo</SelectItem>
                      {(parts ?? []).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>¿Es para un trabajo?</Label>
                  <Select disabled={!draft} value={l.workOrderId ? String(l.workOrderId) : NONE} onValueChange={v => setLine(i, { workOrderId: v === NONE ? null : Number(v) })}>
                    <SelectTrigger data-testid={`line-order-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No, es para el stock</SelectItem>
                      {openOrders.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.workOrderNumber} · {o.clientName ?? ""} · {o.bicycleName ?? ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {l.workOrderId && <p className="text-xs text-muted-foreground">Se suma al stock, se agrega a la OT y se consume al tiro.</p>}</div>
              </div>
              {draft && lines.length > 1 && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4 mr-1" />Quitar línea</Button>
              )}
            </CardContent></Card>
          );
        })}
        {draft && <Button variant="outline" onClick={() => setLines(ls => [...ls, emptyLine()])} data-testid="button-add-line"><Plus className="h-4 w-4 mr-1" />Agregar línea</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <div className="text-sm text-muted-foreground mr-auto">Neto <strong className="text-foreground">{formatCLP(Math.round(netTotal))}</strong> · con IVA {formatCLP(Math.round(netTotal * 1.19))}</div>
        {draft ? (
          <>
            <Button variant="ghost" className="text-destructive" onClick={doDelete}>Borrar</Button>
            <Button variant="outline" onClick={saveDraft} disabled={busy}>Guardar borrador</Button>
            <Button onClick={doConfirm} disabled={busy || !valid} data-testid="button-confirm-purchase"><CheckCircle2 className="h-4 w-4 mr-1" />Confirmar y sumar al stock</Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
