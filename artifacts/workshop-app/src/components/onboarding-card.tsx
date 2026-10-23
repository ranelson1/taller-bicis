import { useState } from "react";
import { Link } from "wouter";
import { useGetWorkshopSettings, useListInventory, useListServices, useListWorkOrders } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Rocket, X } from "lucide-react";

// Guía para el taller nuevo: qué configurar para que los números y los avisos funcionen.
// Cada paso se marca solo cuando el dato existe; el admin puede ocultar la guía.

const HIDE_KEY = "taller-onboarding-hidden";
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };

export function OnboardingCard() {
  const [hidden, setHidden] = useState(readHidden);
  const { data: settings } = useGetWorkshopSettings();
  const { data: services } = useListServices({});
  const { data: stock } = useListInventory();
  const { data: orders } = useListWorkOrders();
  if (hidden || !settings) return null;

  const steps = [
    { done: !!(settings.phone || settings.address), label: "Datos del taller", hint: "Teléfono y dirección salen en el link del cliente.", href: "/admin/configuracion" },
    { done: !!settings.logoUrl, label: "Logo del taller", hint: "Aparece en el link y en los mensajes al cliente.", href: "/admin/configuracion" },
    { done: settings.laborCostPerHour != null, label: "Costo de tu hora", hint: "Con él sabes cuánto ganas de verdad en cada trabajo.", href: "/admin/configuracion" },
    { done: (services ?? []).length > 0, label: "Tus servicios y precios", hint: "Mantención, cambio de frenos… con precio y horas.", href: "/admin/catalogo" },
    { done: (stock ?? []).length > 0, label: "Repuestos e insumos", hint: "Sube una factura o crea tus artículos con su costo.", href: "/inventario" },
    { done: (orders ?? []).length > 0, label: "Tu primer trabajo", hint: "Registra una bici y avisa al cliente por WhatsApp.", href: "/trabajos/nuevo" },
  ];
  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.find(s => !s.done)!;

  const hide = () => { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* sin almacenamiento */ } setHidden(true); };

  return (
    <Card className="border-2 border-primary/30" data-testid="onboarding-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Deja tu taller listo</h2>
          <span className="text-sm text-muted-foreground">{doneCount} de {steps.length}</span>
          <button type="button" onClick={hide} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Ocultar guía" title="Ocultar guía"><X className="h-4 w-4" /></button>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {steps.map(s => (
            <li key={s.label}>
              <Link href={s.href}>
                <div className={cn("flex items-start gap-2 rounded-md p-2 cursor-pointer hover:bg-muted/50", s.done && "opacity-60")}>
                  {s.done ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" /> : <Circle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
                  <span className="text-sm"><span className={cn("font-medium", s.done && "line-through")}>{s.label}</span>{!s.done && <span className="block text-xs text-muted-foreground">{s.hint}</span>}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Button asChild size="sm"><Link href={next.href}>Siguiente: {next.label}</Link></Button>
      </CardContent>
    </Card>
  );
}
