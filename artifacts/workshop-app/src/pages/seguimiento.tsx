import { Link } from "wouter";
import { useGetWorkshopSettings, useListFollowups } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FollowupRow } from "@/components/followups/followup-row";
import { ArrowLeft, Megaphone } from "lucide-react";

// Todos los clientes a quienes ya les toca repetir un servicio, el más vencido primero.

export default function Seguimiento() {
  const { data: followups, isLoading } = useListFollowups();
  const { data: settings } = useGetWorkshopSettings();

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" />Inicio</Link>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Megaphone className="h-7 w-7" />A quién escribirle</h1>
        <p className="text-muted-foreground">Clientes a quienes ya les toca repetir un servicio. Los plazos se cambian en cada servicio, en "Servicios y precios".</p>
      </div>
      {isLoading ? <Skeleton className="h-48" /> : !followups || followups.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Nadie por ahora. Cuando a un cliente le toque repetir un servicio, aparece aquí.</CardContent></Card>
      ) : (
        <Card><CardContent className="p-4 divide-y">
          {followups.map(c => <FollowupRow key={c.clientId} client={c} shopName={settings?.name} />)}
        </CardContent></Card>
      )}
    </div>
  );
}
