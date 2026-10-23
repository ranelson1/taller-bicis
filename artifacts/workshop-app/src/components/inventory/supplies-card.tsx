import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListServiceSupplies, useUpdateServiceSupplies, useListInventory, getListServiceSuppliesQueryKey,
  type ServiceSupply,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/work-status";
import { fmtQty } from "@/lib/inventory";
import { FlaskConical, Plus, Trash2 } from "lucide-react";

// Receta del servicio: qué insumos del taller gasta cada vez (grasa, lubricante, cinta…).
// Se descuentan del stock cuando el trabajo queda listo para retiro y entran en el costo del trabajo.

type Row = { partId: number | null; quantity: string };

export function ServiceSuppliesCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: saved } = useListServiceSupplies(serviceId);
  const { data: items } = useListInventory();
  const save = useUpdateServiceSupplies();
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!saved) return;
    setRows(saved.map((s: ServiceSupply) => ({ partId: s.partId, quantity: String(s.quantity) })));
    setDirty(false);
  }, [saved]);

  const supplies = (items ?? []).filter(i => i.kind === "supply");
  const byId = new Map((items ?? []).map(i => [i.id, i]));
  const setRow = (i: number, patch: Partial<Row>) => { setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r))); setDirty(true); };
  const cost = rows.reduce((s, r) => {
    const it = r.partId ? byId.get(r.partId) : null;
    return s + (it?.costPrice ?? 0) * (Number(r.quantity.replace(",", ".")) || 0);
  }, 0);

  const submit = () => {
    const list = rows.filter(r => r.partId && Number(r.quantity.replace(",", ".")) > 0)
      .map(r => ({ partId: r.partId!, quantity: Number(r.quantity.replace(",", ".")) }));
    save.mutate({ id: serviceId, data: { supplies: list } }, {
      onSuccess: () => { toast({ title: "Insumos guardados" }); qc.invalidateQueries({ queryKey: getListServiceSuppliesQueryKey(serviceId) }); setDirty(false); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo guardar" }),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="h-4 w-4" />Insumos que gasta</CardTitle>
        <CardDescription>Lo que se consume cada vez que haces este servicio. Se descuenta del stock al dejar la bici lista y cuenta en tu costo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {supplies.length === 0 && (
          <p className="text-sm text-muted-foreground">Primero crea tus insumos en Inventario (tipo "Insumo del taller").</p>
        )}
        {rows.map((r, i) => {
          const it = r.partId ? byId.get(r.partId) : null;
          return (
            <div key={i} className="flex items-center gap-2" data-testid={`supply-row-${i}`}>
              <Select value={r.partId ? String(r.partId) : ""} onValueChange={v => setRow(i, { partId: Number(v) })}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Elige un insumo" /></SelectTrigger>
                <SelectContent>{supplies.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="w-24" inputMode="decimal" value={r.quantity} onChange={e => setRow(i, { quantity: e.target.value })} aria-label="Cantidad" />
              <span className="w-10 text-sm text-muted-foreground">{it?.unit ?? ""}</span>
              <Button variant="ghost" size="icon" onClick={() => { setRows(rs => rs.filter((_, k) => k !== i)); setDirty(true); }} aria-label="Quitar"><Trash2 className="h-4 w-4" /></Button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={supplies.length === 0} onClick={() => { setRows(rs => [...rs, { partId: null, quantity: "1" }]); setDirty(true); }} data-testid="button-add-supply">
            <Plus className="h-4 w-4 mr-1" />Agregar insumo
          </Button>
          {rows.length > 0 && <span className="text-sm text-muted-foreground">Costo por servicio: <strong className="text-foreground">{formatCLP(Math.round(cost))}</strong></span>}
          {dirty && <Button size="sm" className="ml-auto" onClick={submit} disabled={save.isPending} data-testid="button-save-supplies">Guardar</Button>}
        </div>
        {rows.length > 0 && <p className="text-xs text-muted-foreground">{rows.map(r => r.partId && byId.get(r.partId) ? `${byId.get(r.partId)!.name}: ${fmtQty(Number(r.quantity.replace(",", ".")) || 0, byId.get(r.partId)!.unit)}` : null).filter(Boolean).join(" · ")}</p>}
      </CardContent>
    </Card>
  );
}
