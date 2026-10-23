import { Link } from "wouter";
import { useGetWorkOrderEconomics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCLP } from "@/lib/work-status";
import { Calculator, ShoppingCart } from "lucide-react";

// Cuánto ganas de verdad en este trabajo (solo admin) + atajo para comprar un repuesto para él.

export function EconomicsCard({ workOrderId, closed }: { workOrderId: number; closed: boolean }) {
  const { data: e } = useGetWorkOrderEconomics(workOrderId);
  const row = (label: string, value: string, strong = false) => (
    <div className={cn("flex justify-between gap-3", strong && "font-semibold border-t pt-2 mt-1")}><span className={strong ? "" : "text-muted-foreground"}>{label}</span><span>{value}</span></div>
  );
  return (
    <Card data-testid="economics-card">
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4" />Números del trabajo</CardTitle></CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {e ? (
          <>
            {row(e.recoversVat ? "Cobrado (sin IVA)" : "Cobrado", formatCLP(e.revenue))}
            {row("Repuestos e insumos", `− ${formatCLP(e.materialsCost)}`)}
            {row(`Tu tiempo (${e.laborHours} h)`, e.laborCost != null ? `− ${formatCLP(e.laborCost)}` : "—")}
            {row("Ganancia", `${formatCLP(e.margin)}${e.marginPct != null ? ` · ${Math.round(e.marginPct)} %` : ""}`, true)}
            {e.missingLaborCost && <p className="text-xs text-amber-700 pt-1">Configura el costo de tu hora en Configuración para contar tu tiempo.</p>}
            {e.missingCosts && <p className="text-xs text-amber-700">Hay repuestos sin costo: la ganancia real puede ser menor.</p>}
            {!e.stockConsumed && !closed && <p className="text-xs text-muted-foreground pt-1">Los insumos de las recetas se estiman hasta que el trabajo quede listo.</p>}
          </>
        ) : <p className="text-muted-foreground">Calculando…</p>}
        {!closed && (
          <Button asChild variant="outline" size="sm" className="mt-2 w-full">
            <Link href={`/inventario?tab=compras&ot=${workOrderId}`}><ShoppingCart className="h-4 w-4 mr-1.5" />Comprar repuesto para este trabajo</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
