import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, useGetMe, useUpdateMyAccount } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// Mi cuenta: cada persona cambia su nombre, su email o su contraseña (pidiendo la actual).

export function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const update = useUpdateMyAccount();
  const [f, setF] = useState({ name: "", email: "", current: "", next: "", repeat: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setF({ name: me?.name ?? "", email: me?.email ?? "", current: "", next: "", repeat: "" }); setError(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const changed = f.name.trim() !== (me?.name ?? "") || f.email.trim().toLowerCase() !== (me?.email ?? "").toLowerCase() || f.next !== "";

  const submit = () => {
    setError(null);
    if (f.next && f.next.length < 8) { setError("La contraseña nueva debe tener al menos 8 caracteres"); return; }
    if (f.next !== f.repeat) { setError("Las contraseñas nuevas no coinciden"); return; }
    update.mutate({
      data: {
        currentPassword: f.current,
        name: f.name.trim() !== me?.name ? f.name.trim() : undefined,
        email: f.email.trim().toLowerCase() !== (me?.email ?? "").toLowerCase() ? f.email.trim() : undefined,
        newPassword: f.next || undefined,
      },
    }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetMeQueryKey() }); toast({ title: "Cuenta actualizada" }); onOpenChange(false); },
      onError: (e: any) => setError(e?.data?.error ?? "No se pudo guardar"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mi cuenta</DialogTitle>
          <DialogDescription>Cambia tus datos de acceso. Para guardar, escribe tu contraseña actual.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Nombre</Label><Input value={f.name} onChange={set("name")} data-testid="input-account-name" /></div>
          <div className="space-y-1.5"><Label>Email (con el que entras)</Label><Input type="email" value={f.email} onChange={set("email")} data-testid="input-account-email" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Contraseña nueva</Label><Input type="password" autoComplete="new-password" value={f.next} onChange={set("next")} placeholder="Déjala vacía para no cambiarla" /></div>
            <div className="space-y-1.5"><Label>Repetir contraseña nueva</Label><Input type="password" autoComplete="new-password" value={f.repeat} onChange={set("repeat")} /></div>
          </div>
          <div className="space-y-1.5"><Label>Contraseña actual *</Label><Input type="password" autoComplete="current-password" value={f.current} onChange={set("current")} data-testid="input-account-current" /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={update.isPending || !changed || !f.current} data-testid="button-save-account">Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
