import { Link } from "wouter";
import { useGetWorkshopSettings, useListFollowups } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FollowupRow } from "@/components/followups/followup-row";
import { Megaphone } from "lucide-react";

// Inicio: los clientes a quienes conviene escribirles hoy (los 4 más vencidos). Si no hay ninguno, no ocupa espacio.

export function FollowupsSection() {
  const { data: followups } = useListFollowups();
  const { data: settings } = useGetWorkshopSettings();
  if (!followups || followups.length === 0) return null;
  const shown = followups.slice(0, 4);

  return (
    <Card data-testid="followups-section">
      <CardHeader className="pb-1 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Megaphone className="h-4 w-4" />A quién escribirle ({followups.length})
        </CardTitle>
        {followups.length > shown.length && <Link href="/seguimiento" className="text-xs text-primary">Ver todos →</Link>}
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground mb-1">Ya les toca repetir un servicio. Un toque y el mensaje sale listo por WhatsApp.</p>
        <div className="divide-y">
          {shown.map(c => <FollowupRow key={c.clientId} client={c} shopName={settings?.name} />)}
        </div>
      </CardContent>
    </Card>
  );
}
