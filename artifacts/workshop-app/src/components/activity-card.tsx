import { useState } from "react";
import { Link } from "wouter";
import { useGetDashboardActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BellRing, Check, ThumbsUp, X } from "lucide-react";

// Novedades: lo que respondieron los clientes desde su link, para enterarse sin revisar el chat.
// "Visto" se guarda en este dispositivo; lo nuevo aparece destacado.

const SEEN_KEY = "taller-activity-seen";
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; } };

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "recién";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} día${days === 1 ? "" : "s"}`;
}

export function ActivityCard() {
  const { data } = useGetDashboardActivity({ query: { refetchInterval: 60_000, queryKey: ["dashboard-activity"] } });
  const [seen, setSeen] = useState(readSeen);
  if (!data || data.length === 0) return null;

  const isNew = (iso: string) => iso > seen;
  const fresh = data.filter(i => isNew(i.createdAt)).length;
  // Con todo visto se muestra solo lo de los últimos 3 días, para no cargar la pantalla.
  const visible = fresh > 0 ? data : data.filter(i => Date.now() - new Date(i.createdAt).getTime() < 3 * 86_400_000);
  if (visible.length === 0) return null;

  const markSeen = () => {
    const now = new Date().toISOString();
    try { localStorage.setItem(SEEN_KEY, now); } catch { /* sin almacenamiento */ }
    setSeen(now);
  };

  const text = (i: (typeof data)[number]) => {
    const who = (i.clientName ?? "El cliente").split(" ")[0];
    if (i.kind === "quote_approved") return <><strong>{who}</strong> aprobó la cotización</>;
    return <><strong>{who}</strong> {i.kind === "item_approved" ? "aprobó" : "rechazó"}{i.detail ? <>: {i.detail}</> : " un adicional"}</>;
  };

  return (
    <Card className={cn(fresh > 0 && "border-2 border-green-300")} data-testid="activity-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <BellRing className="h-4 w-4" />Novedades {fresh > 0 && <span className="rounded-full bg-green-600 text-white text-[10px] px-1.5 py-0.5">{fresh}</span>}
        </CardTitle>
        {fresh > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markSeen} data-testid="button-mark-seen">Marcar vistas</Button>}
      </CardHeader>
      <CardContent className="divide-y">
        {visible.slice(0, 6).map(i => (
          <Link key={i.id} href={i.workCaseId ? `/trabajos/${i.workCaseId}` : "/trabajos"}>
            <div className={cn("py-2 flex items-start gap-2.5 text-sm cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded", isNew(i.createdAt) && "bg-green-50/60")}>
              <span className={cn("mt-0.5 rounded-full p-1", i.kind === "item_rejected" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>
                {i.kind === "quote_approved" ? <ThumbsUp className="h-3 w-3" /> : i.kind === "item_approved" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate">{text(i)}</span>
                <span className="text-xs text-muted-foreground">{i.workOrderNumber} · {ago(i.createdAt)}</span>
              </span>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
