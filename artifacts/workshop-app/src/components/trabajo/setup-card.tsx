import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetBicycle, useUpdateBicycleSetup, getGetBicycleQueryKey, getListBicyclesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, SlidersHorizontal } from "lucide-react";

// Ficha de ajustes de la bici: presión, rebote y compresión de horquilla y shock, apertura de palancas…
// Se guarda en la bicicleta: el cliente la ve al retirar y queda como punto de partida del siguiente servicio.

const TEMPLATE = [
  "Horquilla: __ psi · rebote bajo __ / alto __ · compresión baja __ / alta __",
  "Shock: __ psi · rebote bajo __ / alto __ · compresión baja __ / alta __",
  "Frenos (palanca, de abierto a cerrado): delantero __ · trasero __",
  "Neumáticos: delantero __ psi · trasero __ psi",
  "Otros: ",
].join("\n");

export function SetupCard({ bicycleId, readOnly }: { bicycleId: number; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: bike } = useGetBicycle(bicycleId, { query: { enabled: !!bicycleId, queryKey: getGetBicycleQueryKey(bicycleId) } });
  const save = useUpdateBicycleSetup();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(bike?.setupNotes ?? ""); }, [open, bike?.setupNotes]);

  if (!bike) return null;
  const submit = () => save.mutate({ id: bicycleId, data: { setupNotes: text.trim() || null } }, {
    onSuccess: () => {
      toast({ title: "Ajustes guardados" });
      qc.invalidateQueries({ queryKey: getGetBicycleQueryKey(bicycleId) });
      qc.invalidateQueries({ queryKey: getListBicyclesQueryKey() });
      setOpen(false);
    },
    onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudieron guardar" }),
  });

  return (
    <Card data-testid="setup-card">
      <CardHeader className="pb-1 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />Ajustes de la bici
        </CardTitle>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="text-primary -mr-2" onClick={() => setOpen(true)} data-testid="button-edit-setup">
            <Pencil className="h-3.5 w-3.5 mr-1" />{bike.setupNotes ? "Editar" : "Agregar"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {bike.setupNotes ? (
          <>
            <p className="text-sm whitespace-pre-line break-words">{bike.setupNotes}</p>
            {bike.setupUpdatedAt && <p className="text-xs text-muted-foreground mt-2">Actualizado el {new Date(bike.setupUpdatedAt).toLocaleDateString("es-CL", { day: "numeric", month: "long" })}. El cliente la ve cuando la bici está lista.</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Anota presiones, clicks y palancas al dejar la bici lista: el cliente los ve en su link y quedan para el próximo servicio.</p>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajustes de {bike.brand} {bike.model}</DialogTitle>
            <DialogDescription>Escribe como lo mandas hoy por WhatsApp. Se guarda en la bici para la próxima vez.</DialogDescription>
          </DialogHeader>
          <Textarea rows={9} value={text} onChange={e => setText(e.target.value)} maxLength={1500} data-testid="textarea-setup" placeholder="Shock: 184 psi, LR 12, HR 3, LC 7, HC 1" />
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setText(t => (t.trim() ? `${t.trim()}\n${TEMPLATE}` : TEMPLATE))} data-testid="button-setup-template">Usar plantilla</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={save.isPending} data-testid="button-save-setup">Guardar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
