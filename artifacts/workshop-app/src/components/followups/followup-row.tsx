import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useSnoozeFollowup, getListFollowupsQueryKey, type FollowupClient } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { followupMessage } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";

// Un cliente al que ya le toca repetir un servicio: qué, hace cuánto y un botón para escribirle por WhatsApp.

function dueLabel(days: number) {
  if (days > 30) return `venció hace ${Math.round(days / 30)} meses`;
  if (days > 0) return `venció hace ${days} día${days === 1 ? "" : "s"}`;
  if (days === 0) return "vence hoy";
  return `vence en ${-days} día${days === -1 ? "" : "s"}`;
}

export function FollowupRow({ client, shopName }: { client: FollowupClient; shopName?: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const snooze = useSnoozeFollowup();

  // Al abrir el chat se marca como "ya le escribí" para no volver a sugerirlo en un mes.
  const postpone = (days: number, message?: string) => snooze.mutate({ clientId: client.clientId, data: { days } }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListFollowupsQueryKey() }); if (message) toast({ title: message }); },
    onError: () => toast({ variant: "destructive", title: "No se pudo guardar" }),
  });

  const first = client.items[0];
  const more = client.items.length - 1;

  return (
    <div className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid={`followup-${client.clientId}`}>
      <div className="min-w-0 flex-1 basis-52">
        <Link href={`/clientes/${client.clientId}`} className="text-sm font-medium truncate block hover:underline">{client.clientName}</Link>
        <p className="text-xs text-muted-foreground truncate">
          {first.serviceName} · {first.bicycleName}{more > 0 ? ` y ${more} más` : ""}
        </p>
        <p className={cn("text-xs", first.overdueDays > 0 ? "text-amber-700" : "text-muted-foreground")}>
          hace {first.monthsAgo} mes{first.monthsAgo === 1 ? "" : "es"} · {dueLabel(first.overdueDays)}
        </p>
      </div>
      <WhatsAppButton phone={client.clientPhone} label="Escribir" className="h-8"
        text={followupMessage(client, shopName)} onOpen={() => postpone(30)} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Más"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => postpone(7, "Te lo recordamos en una semana")}>Recordar en una semana</DropdownMenuItem>
          <DropdownMenuItem onClick={() => postpone(30, "Listo, ya le escribiste")}>Ya le escribí</DropdownMenuItem>
          <DropdownMenuItem onClick={() => postpone(180, "No lo volveremos a sugerir por 6 meses")}>No insistir (6 meses)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
