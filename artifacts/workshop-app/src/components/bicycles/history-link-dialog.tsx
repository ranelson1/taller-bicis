import { useEffect, useState } from "react";
import {
  useCreateBicycleHistoryLink, useGetBicycleHistoryLink, useGetWorkshopSettings, useRevokeBicycleHistoryLink,
  getGetBicycleHistoryLinkQueryKey, type Bicycle,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { Copy, ExternalLink, Link2Off, ScrollText } from "lucide-react";

// Compartir el historial de mantención de una bici (para mostrar al vender o al cambiar de taller).

export function HistoryLinkDialog({ bike, phone, onOpenChange }: { bike: Bicycle | null; phone?: string | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = useGetWorkshopSettings();
  const id = bike?.id ?? 0;
  const { data: link, isLoading } = useGetBicycleHistoryLink(id, { query: { enabled: !!bike, queryKey: getGetBicycleHistoryLinkQueryKey(id) } });
  const create = useCreateBicycleHistoryLink();
  const revoke = useRevokeBicycleHistoryLink();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  useEffect(() => { setConfirmRevoke(false); }, [bike]);

  const refresh = () => qc.invalidateQueries({ queryKey: getGetBicycleHistoryLinkQueryKey(id) });
  const url = link?.path ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${link.path}` : null;
  const name = bike ? `${bike.brand} ${bike.model}` : "";
  const message = url
    ? `Te comparto el historial de mantención de tu ${name}, llevado por ${settings?.name ?? "el taller"}: ${url}`
    : "";

  return (
    <Dialog open={!!bike} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5" />Historial de {name}</DialogTitle>
          <DialogDescription>
            Una página con todos los servicios hechos a esta bici, sin precios ni datos personales. Sirve para mostrarla al venderla o llevarla a otro taller.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : !url ? (
          <Button onClick={() => create.mutate({ id }, { onSuccess: refresh, onError: () => toast({ variant: "destructive", title: "No se pudo crear el link" }) })}
            disabled={create.isPending} data-testid="button-create-history-link">Crear link del historial</Button>
        ) : (
          <div className="space-y-3">
            <p className="rounded-md bg-muted p-3 text-sm break-all text-primary" data-testid="history-link-url">{url}</p>
            <div className="flex flex-wrap gap-2">
              <WhatsAppButton size="default" phone={phone} label="Enviar por WhatsApp" text={message} />
              <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(url).catch(() => {}); toast({ title: "Link copiado" }); }}><Copy className="h-4 w-4 mr-1.5" />Copiar</Button>
              <Button variant="outline" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1.5" />Ver</a></Button>
            </div>
            {confirmRevoke ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm space-y-2">
                <p className="text-red-800">El link actual dejará de funcionar para quien lo tenga.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ id }, { onSuccess: () => { refresh(); toast({ title: "Dejaste de compartir el historial" }); } })}>Sí, dejar de compartir</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmRevoke(true)}><Link2Off className="h-4 w-4 mr-1.5" />Dejar de compartir</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
