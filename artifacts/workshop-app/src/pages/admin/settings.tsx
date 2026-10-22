import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetWorkshopSettings, useUpdateWorkshopSettings, getGetWorkshopSettingsQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Clock, Store } from "lucide-react";
import PaymentMethods from "./payment-methods";

// Configuración del taller: datos que ve el cliente, horario y colación (de ahí sale la
// capacidad para estimar el término de cada trabajo) y métodos de pago.

const DAYS = [
  { value: 1, label: "Lunes" }, { value: 2, label: "Martes" }, { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" }, { value: 5, label: "Viernes" }, { value: 6, label: "Sábado" }, { value: 0, label: "Domingo" },
];

type DayRow = { day: number; enabled: boolean; open: string; close: string };

const toMin = (s: string) => (/^\d{2}:\d{2}$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : NaN);
// Mismo cálculo que el backend (helpers/schedule.ts): jornada menos la parte de la colación que cae dentro.
function netHours(row: DayRow, lunch: { enabled: boolean; start: string; end: string }): number {
  const o = toMin(row.open), c = toMin(row.close);
  if (!row.enabled || isNaN(o) || isNaN(c) || c <= o) return 0;
  const ls = toMin(lunch.start), le = toMin(lunch.end);
  const lunchMin = lunch.enabled && !isNaN(ls) && !isNaN(le) ? Math.max(0, Math.min(c, le) - Math.max(o, ls)) : 0;
  return (c - o - lunchMin) / 60;
}
const fmtH = (h: number) => `${h.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h`;

export default function Settings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useGetWorkshopSettings();
  const save = useUpdateWorkshopSettings();
  const [info, setInfo] = useState({ name: "", phone: "", address: "" });
  const [rows, setRows] = useState<DayRow[]>([]);
  const [lunch, setLunch] = useState({ enabled: true, start: "14:00", end: "15:00" });

  useEffect(() => {
    if (!settings) return;
    setInfo({ name: settings.name, phone: settings.phone ?? "", address: settings.address ?? "" });
    setRows(DAYS.map(d => {
      const s = settings.schedule.find(x => x.day === d.value);
      return { day: d.value, enabled: !!s, open: s?.open ?? "10:00", close: s?.close ?? "19:00" };
    }));
    setLunch(settings.lunchStart && settings.lunchEnd
      ? { enabled: true, start: settings.lunchStart, end: settings.lunchEnd }
      : { enabled: false, start: "14:00", end: "15:00" });
  }, [settings]);

  const updateRow = (day: number, patch: Partial<DayRow>) => setRows(prev => prev.map(r => (r.day === day ? { ...r, ...patch } : r)));
  const weekly = rows.reduce((s, r) => s + netHours(r, lunch), 0);
  const rowError = (r: DayRow) => r.enabled && !(toMin(r.close) > toMin(r.open)) ? "El cierre debe ser después de la apertura" : null;
  const lunchError = lunch.enabled && !(toMin(lunch.end) > toMin(lunch.start)) ? "El fin debe ser después del inicio" : null;
  const canSave = !!info.name.trim() && rows.some(r => r.enabled) && !rows.some(rowError) && !lunchError && weekly > 0;

  const submit = () => {
    save.mutate({
      data: {
        name: info.name, phone: info.phone || null, address: info.address || null,
        schedule: rows.filter(r => r.enabled).map(({ day, open, close }) => ({ day, open, close })),
        lunchStart: lunch.enabled ? lunch.start : null,
        lunchEnd: lunch.enabled ? lunch.end : null,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Configuración guardada" });
        qc.invalidateQueries({ queryKey: getGetWorkshopSettingsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() }); // el nombre del taller sale en el menú
      },
      onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo guardar" }),
    });
  };

  return (
    <div>
      <div className="p-4 md:p-8 pb-0 md:pb-0 max-w-7xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-foreground">Configuración</h1>
        {isLoading ? <Skeleton className="h-96 max-w-2xl" /> : (
          <div className="grid gap-6 xl:grid-cols-2 items-start max-w-2xl xl:max-w-none">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Store className="h-4 w-4" />Datos del taller</CardTitle>
                <CardDescription>Se muestran al cliente en su link de seguimiento y en los mensajes de WhatsApp.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nombre del taller *</Label>
                  <Input value={info.name} onChange={e => setInfo(f => ({ ...f, name: e.target.value }))} data-testid="input-workshop-name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono / WhatsApp</Label>
                  <Input type="tel" placeholder="+56 9 1234 5678" value={info.phone} onChange={e => setInfo(f => ({ ...f, phone: e.target.value }))} data-testid="input-workshop-phone" />
                </div>
                <div className="space-y-1.5">
                  <Label>Dirección (para el retiro)</Label>
                  <Input value={info.address} onChange={e => setInfo(f => ({ ...f, address: e.target.value }))} data-testid="input-workshop-address" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />Horario</CardTitle>
                <CardDescription>Con el horario menos la colación se calcula cuántas horas trabaja el taller y el término estimado de cada trabajo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="divide-y">
                  {rows.map(r => {
                    const label = DAYS.find(d => d.value === r.day)!.label;
                    const err = rowError(r);
                    return (
                      <li key={r.day} className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Switch checked={r.enabled} onCheckedChange={v => updateRow(r.day, { enabled: v })} aria-label={`Abre el ${label}`} data-testid={`day-open-${r.day}`} />
                          <span className={cn("w-20 text-sm", !r.enabled && "text-muted-foreground")}>{label}</span>
                          {r.enabled ? (
                            <>
                              <Input type="time" className="h-8 w-[6.5rem]" value={r.open} onChange={e => updateRow(r.day, { open: e.target.value })} aria-label={`Apertura ${label}`} />
                              <span className="text-muted-foreground text-sm">a</span>
                              <Input type="time" className="h-8 w-[6.5rem]" value={r.close} onChange={e => updateRow(r.day, { close: e.target.value })} aria-label={`Cierre ${label}`} />
                              <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">{fmtH(netHours(r, lunch))}</span>
                            </>
                          ) : <span className="text-sm text-muted-foreground">Cerrado</span>}
                        </div>
                        {err && <p className="text-xs text-destructive mt-1 ml-12">{err}</p>}
                      </li>
                    );
                  })}
                </ul>

                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch checked={lunch.enabled} onCheckedChange={v => setLunch(l => ({ ...l, enabled: v }))} data-testid="switch-lunch" />
                    <span className="text-sm font-medium w-20">Colación</span>
                    {lunch.enabled && (
                      <div className="flex items-center gap-2">
                        <Input type="time" className="h-8 w-[6.5rem]" value={lunch.start} onChange={e => setLunch(l => ({ ...l, start: e.target.value }))} aria-label="Inicio colación" data-testid="input-lunch-start" />
                        <span className="text-muted-foreground text-sm">a</span>
                        <Input type="time" className="h-8 w-[6.5rem]" value={lunch.end} onChange={e => setLunch(l => ({ ...l, end: e.target.value }))} aria-label="Fin colación" data-testid="input-lunch-end" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Se descuenta de cada día en que cae dentro del horario.</p>
                  {lunchError && <p className="text-xs text-destructive">{lunchError}</p>}
                </div>

                <p className="text-sm">
                  Total semanal: <strong data-testid="weekly-net-hours">{fmtH(weekly)}</strong> de trabajo por persona.
                  <span className="block text-xs text-muted-foreground">Un mecánico con menos horas semanales en Usuarios cuenta proporcionalmente.</span>
                </p>
              </CardContent>
            </Card>
          </div>
        )}
        {!isLoading && (
          <Button onClick={submit} disabled={save.isPending || !canSave} data-testid="button-save-settings">
            {save.isPending ? "Guardando…" : "Guardar configuración"}
          </Button>
        )}
      </div>
      <PaymentMethods />
    </div>
  );
}
