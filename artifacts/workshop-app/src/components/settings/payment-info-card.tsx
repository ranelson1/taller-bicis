import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateWorkshopPaymentInfo, getGetWorkshopSettingsQueryKey, type WorkshopSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Landmark } from "lucide-react";

// Datos para transferir: se escriben una vez y el cliente los ve en su link cuando hay saldo por pagar;
// además se agregan al mensaje de cobro por WhatsApp.
export function PaymentInfoCard({ settings }: { settings: WorkshopSettings }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useUpdateWorkshopPaymentInfo();
  const [text, setText] = useState("");
  useEffect(() => { setText(settings.paymentInfo ?? ""); }, [settings.paymentInfo]);
  const dirty = text.trim() !== (settings.paymentInfo ?? "");

  const submit = () => save.mutate({ data: { paymentInfo: text.trim() || null } }, {
    onSuccess: () => { toast({ title: "Datos para transferir guardados" }); qc.invalidateQueries({ queryKey: getGetWorkshopSettingsQueryKey() }); },
    onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo guardar" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Landmark className="h-4 w-4" />Datos para transferir</CardTitle>
        <CardDescription>El cliente los ve en su link cuando tiene saldo por pagar, y se incluyen al cobrar por WhatsApp. Así no los pasas cada vez.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={5} maxLength={600} value={text} onChange={e => setText(e.target.value)} data-testid="textarea-payment-info"
          placeholder={"Nombre completo\nRUT\nBanco y tipo de cuenta\nN° de cuenta\nCorreo para el comprobante"} />
        <Button onClick={submit} disabled={!dirty || save.isPending} data-testid="button-save-payment-info">{save.isPending ? "Guardando…" : "Guardar"}</Button>
      </CardContent>
    </Card>
  );
}
