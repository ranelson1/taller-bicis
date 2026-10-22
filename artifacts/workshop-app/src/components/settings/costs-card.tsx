import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateWorkshopCosts, getGetWorkshopSettingsQueryKey, type WorkshopSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/work-status";
import { Calculator } from "lucide-react";

// Cuánto le cuesta al taller una hora de trabajo. Con eso se calcula el margen real de cada trabajo:
// lo cobrado menos repuestos, insumos y horas × este costo.

const WEEKS_PER_MONTH = 4.33;
const toNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));

export function CostsCard({ settings }: { settings: WorkshopSettings }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useUpdateWorkshopCosts();
  // Horas al mes que repara: por defecto, el horario neto del taller.
  const scheduleHours = Math.round(settings.weeklyNetHours * WEEKS_PER_MONTH);
  const [form, setForm] = useState({ fixed: "", salary: "", hours: "", margin: "30" });

  useEffect(() => {
    setForm({
      fixed: settings.monthlyFixedCosts != null ? String(settings.monthlyFixedCosts) : "",
      salary: settings.monthlySalary != null ? String(settings.monthlySalary) : "",
      hours: settings.monthlyWorkHours != null ? String(settings.monthlyWorkHours) : String(scheduleHours),
      margin: String(settings.defaultPartsMarginPct ?? 30),
    });
  }, [settings, scheduleHours]);

  const fixed = toNum(form.fixed) ?? 0, salary = toNum(form.salary) ?? 0, hours = toNum(form.hours) ?? 0;
  const hourCost = hours > 0 ? Math.round((fixed + salary) / hours) : null;
  const margin = toNum(form.margin);
  const valid = hours > 0 && (fixed > 0 || salary > 0) && margin != null && margin >= 0;

  const submit = () => {
    save.mutate({
      data: { monthlyFixedCosts: fixed, monthlySalary: salary, monthlyWorkHours: hours, defaultPartsMarginPct: margin! },
    }, {
      onSuccess: () => { toast({ title: "Costos guardados", description: `Tu hora cuesta ${formatCLP(hourCost)}` }); qc.invalidateQueries({ queryKey: getGetWorkshopSettingsQueryKey() }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo guardar" }),
    });
  };

  const money = (key: "fixed" | "salary", label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input inputMode="numeric" placeholder="0" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} data-testid={`input-cost-${key}`} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4" />Costo de tu hora</CardTitle>
        <CardDescription>Con esto la app te dice cuánto ganas de verdad en cada trabajo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {money("fixed", "Gastos fijos al mes", "Arriendo, luz, agua, internet, contador, herramientas…")}
          {money("salary", "Sueldo que quieres sacar", "Lo que necesitas para vivir, al mes.")}
          <div className="space-y-1.5">
            <Label>Horas que reparas al mes</Label>
            <Input inputMode="numeric" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} data-testid="input-cost-hours" />
            <p className="text-xs text-muted-foreground">Tu horario da ~{scheduleHours} h. Resta lo que se va en atender, comprar y ordenar.</p>
          </div>
        </div>

        <div className="rounded-lg bg-muted p-4 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm">Cada hora de trabajo te cuesta</span>
          <span className="text-2xl font-bold" data-testid="hour-cost">{hourCost != null && (fixed > 0 || salary > 0) ? formatCLP(hourCost) : "—"}</span>
          {hourCost != null && (fixed > 0 || salary > 0) && (
            <p className="w-full text-xs text-muted-foreground">
              Si un servicio de 1 hora lo cobras a menos de {formatCLP(hourCost)} (sin contar repuestos), estás perdiendo plata.
            </p>
          )}
        </div>

        <div className="space-y-1.5 max-w-xs">
          <Label>Margen sobre repuestos que compras para un trabajo</Label>
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" className="w-24" value={form.margin} onChange={e => setForm(f => ({ ...f, margin: e.target.value }))} data-testid="input-parts-margin" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground">Ej.: un retén que te cuesta $10.000 se le cobra al cliente a {formatCLP(10000 * (1 + (margin ?? 0) / 100))}. Si el distribuidor te da un precio de venta, se usa ese.</p>
        </div>

        <Button onClick={submit} disabled={!valid || save.isPending} data-testid="button-save-costs">{save.isPending ? "Guardando…" : "Guardar costos"}</Button>
      </CardContent>
    </Card>
  );
}
