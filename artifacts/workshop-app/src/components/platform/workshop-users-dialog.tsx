import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPlatformWorkshopUsers, useCreatePlatformWorkshopUser, useUpdatePlatformUser,
  getListPlatformWorkshopUsersQueryKey, type PlatformWorkshop, type PlatformUser,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Copy, KeyRound, Plus, RefreshCw } from "lucide-react";

// Usuarios de un taller, desde el panel de la plataforma: el superadmin cambia emails, resetea contraseñas,
// activa o desactiva el acceso y agrega personas sin tener que entrar al taller.

const randomPassword = () => {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
};

type Role = "admin" | "mechanic" | "reception";
const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Administrador" },
  { value: "mechanic", label: "Mecánico" },
  { value: "reception", label: "Recepción" },
];

export function WorkshopUsersDialog({ workshop, onClose }: { workshop: PlatformWorkshop | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const id = workshop?.id ?? 0;
  const { data: users, isLoading } = useListPlatformWorkshopUsers(id, { query: { enabled: !!workshop, queryKey: getListPlatformWorkshopUsersQueryKey(id) } });
  const update = useUpdatePlatformUser();
  const create = useCreatePlatformWorkshopUser();
  const [editing, setEditing] = useState<{ id: number; name: string; email: string } | null>(null);
  const [adding, setAdding] = useState<{ name: string; email: string; role: Role; password: string } | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: getListPlatformWorkshopUsersQueryKey(id) });
  const fail = (e: any) => setError(e?.data?.error ?? "No se pudo guardar");
  const reset = () => { setEditing(null); setAdding(null); setShown(null); setError(null); };

  const patch = (u: PlatformUser, data: { name?: string; email?: string; password?: string; role?: Role; active?: boolean }, after?: () => void) => {
    setError(null);
    update.mutate({ userId: u.id, data }, { onSuccess: () => { refresh(); after?.(); }, onError: fail });
  };
  const resetPassword = (u: PlatformUser) => {
    const password = randomPassword();
    patch(u, { password }, () => setShown({ email: u.email, password }));
  };
  const copy = async (text: string) => { await navigator.clipboard.writeText(text).catch(() => {}); toast({ title: "Copiado" }); };

  return (
    <Dialog open={!!workshop} onOpenChange={o => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Usuarios de {workshop?.name}</DialogTitle>
          <DialogDescription>Cambia emails y contraseñas, activa o desactiva el acceso y agrega personas. El taller siempre conserva un administrador activo.</DialogDescription>
        </DialogHeader>

        {shown && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm space-y-2 text-amber-950" data-testid="new-password-box">
            <p>Contraseña de <strong>{shown.email}</strong> (no se vuelve a mostrar):</p>
            <pre className="font-mono bg-white rounded p-2 break-all">{shown.password}</pre>
            <Button size="sm" variant="outline" onClick={() => copy(`Email: ${shown.email}\nContraseña: ${shown.password}`)}><Copy className="h-4 w-4 mr-1" />Copiar datos</Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {isLoading ? <Skeleton className="h-24" /> : (
          <div className="divide-y rounded-md border" data-testid="platform-users">
            {(users ?? []).map(u => (
              <div key={u.id} className={cn("p-3", !u.active && "opacity-60")}>
                {editing?.id === u.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} aria-label="Nombre" />
                      <Input type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} aria-label="Email" />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={update.isPending} onClick={() => patch(u, { name: editing.name, email: editing.email }, () => setEditing(null))}>Guardar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <select className="h-8 rounded-md border bg-background px-2 text-sm" value={u.role} aria-label={`Rol de ${u.name}`}
                      onChange={e => patch(u, { role: e.target.value as Role })}>
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing({ id: u.id, name: u.name, email: u.email })}>Editar</Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => resetPassword(u)} disabled={update.isPending}><KeyRound className="h-4 w-4 mr-1" />Nueva clave</Button>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Switch checked={u.active} onCheckedChange={v => patch(u, { active: v })} aria-label={`${u.name} activo`} />
                      {u.active ? "Activo" : "Inactivo"}
                    </label>
                  </div>
                )}
              </div>
            ))}
            {(users ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">Este taller no tiene usuarios.</p>}
          </div>
        )}

        {adding ? (
          <div className="rounded-md border p-3 space-y-2" data-testid="add-user-form">
            <p className="text-sm font-medium">Nuevo usuario</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input placeholder="Nombre" value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} />
              <Input type="email" placeholder="Email" value={adding.email} onChange={e => setAdding({ ...adding, email: e.target.value })} />
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={adding.role} onChange={e => setAdding({ ...adding, role: e.target.value as Role })}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <div className="flex gap-2">
                <Input className="font-mono" value={adding.password} onChange={e => setAdding({ ...adding, password: e.target.value })} aria-label="Contraseña inicial" />
                <Button type="button" variant="outline" size="icon" onClick={() => setAdding({ ...adding, password: randomPassword() })} aria-label="Generar otra"><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={create.isPending || !adding.name.trim() || !adding.email.trim() || adding.password.length < 8}
                onClick={() => {
                  setError(null);
                  create.mutate({ id, data: adding }, {
                    onSuccess: () => { refresh(); setShown({ email: adding.email, password: adding.password }); setAdding(null); },
                    onError: fail,
                  });
                }}>
                Crear usuario
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="outline" data-testid="button-add-user"
              onClick={() => { setShown(null); setAdding({ name: "", email: "", role: "mechanic", password: randomPassword() }); }}>
              <Plus className="h-4 w-4 mr-1" />Agregar usuario
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
