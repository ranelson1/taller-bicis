import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPlatformWorkshops, useCreatePlatformWorkshop, useUpdatePlatformWorkshop, useEnterPlatformWorkshop,
  getListPlatformWorkshopsQueryKey, type PlatformWorkshop,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { WorkshopUsersDialog } from "@/components/platform/workshop-users-dialog";
import { Building2, Copy, LogIn, Plus, RefreshCw, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// Panel de la plataforma: el superadmin crea talleres y entra a uno para dar soporte.

const randomPassword = () => {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
};

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function Platform() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: workshops, isLoading } = useListPlatformWorkshops();
  const update = useUpdatePlatformWorkshop();
  const enter = useEnterPlatformWorkshop();
  const [creating, setCreating] = useState(false);
  const [usersOf, setUsersOf] = useState<PlatformWorkshop | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: getListPlatformWorkshopsQueryKey() });

  const toggleActive = (w: PlatformWorkshop, active: boolean) => {
    update.mutate({ id: w.id, data: { active } }, {
      onSuccess: () => { toast({ title: active ? "Taller activado" : "Taller desactivado", description: active ? undefined : "Sus usuarios ya no pueden entrar." }); refresh(); },
      onError: () => toast({ variant: "destructive", title: "No se pudo cambiar" }),
    });
  };

  const enterWorkshop = (w: PlatformWorkshop) => {
    enter.mutate({ id: w.id }, {
      onSuccess: async () => {
        await qc.resetQueries();
        navigate("/");
        toast({ title: `Entraste a ${w.name}`, description: "Ves y editas como su administrador. Sal desde el aviso de arriba." });
      },
      onError: () => toast({ variant: "destructive", title: "No se pudo entrar" }),
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Building2 className="h-7 w-7" />Talleres</h1>
          <p className="text-muted-foreground text-sm">Cada taller ve solo sus propios trabajos, clientes y catálogo.</p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="button-new-workshop"><Plus className="h-4 w-4 mr-1" />Nuevo taller</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : (workshops ?? []).length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Todavía no hay talleres. Crea el primero.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {(workshops ?? []).map(w => (
            <Card key={w.id} className={cn(!w.active && "opacity-60")} data-testid={`workshop-${w.id}`}>
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{w.name} <span className="text-xs text-muted-foreground font-normal">#{w.id}</span></p>
                  <p className="text-sm text-muted-foreground truncate">Admin: {w.adminEmails.join(", ") || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {w.userCount} usuario(s) · {w.openWorkOrderCount} trabajo(s) abiertos de {w.workOrderCount} · última actividad {fmtDate(w.lastActivityAt)} · creado {fmtDate(w.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Switch checked={w.active} onCheckedChange={v => toggleActive(w, v)} aria-label={`Taller ${w.name} activo`} />
                    {w.active ? "Activo" : "Desactivado"}
                  </label>
                  <Button variant="outline" size="sm" onClick={() => setUsersOf(w)} data-testid={`users-workshop-${w.id}`}>
                    <Users className="h-4 w-4 mr-1" />Usuarios
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => enterWorkshop(w)} disabled={enter.isPending} data-testid={`enter-workshop-${w.id}`}>
                    <LogIn className="h-4 w-4 mr-1" />Entrar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateWorkshopDialog open={creating} onOpenChange={setCreating} onCreated={refresh} />
      <WorkshopUsersDialog workshop={usersOf} onClose={() => { setUsersOf(null); refresh(); }} />
    </div>
  );
}

function CreateWorkshopDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const create = useCreatePlatformWorkshop();
  const empty = { name: "", phone: "", adminName: "", adminEmail: "", adminPassword: randomPassword() };
  const [form, setForm] = useState(empty);
  const [done, setDone] = useState<{ name: string; email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = (o: boolean) => {
    if (!o) { setForm({ ...empty, adminPassword: randomPassword() }); setDone(null); setError(null); }
    onOpenChange(o);
  };

  const submit = () => {
    setError(null);
    create.mutate({ data: { ...form, phone: form.phone || null } }, {
      onSuccess: () => { setDone({ name: form.name, email: form.adminEmail, password: form.adminPassword }); onCreated(); },
      onError: (e: any) => setError(e?.data?.error ?? "No se pudo crear el taller"),
    });
  };

  const credentials = done
    ? `Taller: ${done.name}\nEntrar en: ${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/login\nEmail: ${done.email}\nContraseña: ${done.password}`
    : "";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Taller creado</DialogTitle>
              <DialogDescription>Envíale estos datos al administrador del taller. La contraseña no se vuelve a mostrar; puede cambiarla después.</DialogDescription>
            </DialogHeader>
            <pre className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap break-all" data-testid="new-workshop-credentials">{credentials}</pre>
            <DialogFooter>
              <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(credentials).catch(() => {}); toast({ title: "Datos copiados" }); }}>
                <Copy className="h-4 w-4 mr-1" />Copiar
              </Button>
              <Button onClick={() => close(false)}>Listo</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nuevo taller</DialogTitle>
              <DialogDescription>Se crea con métodos de pago básicos y su primer administrador, que después agrega a su equipo.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Nombre del taller *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-new-workshop-name" /></div>
                <div className="space-y-1.5"><Label>Teléfono</Label><Input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
              </div>
              <p className="text-sm font-medium pt-1">Administrador del taller</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Nombre *</Label><Input value={form.adminName} onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))} data-testid="input-new-admin-name" /></div>
                <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} data-testid="input-new-admin-email" /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Contraseña inicial *</Label>
                <div className="flex gap-2">
                  <Input value={form.adminPassword} onChange={e => setForm(f => ({ ...f, adminPassword: e.target.value }))} className="font-mono" data-testid="input-new-admin-password" />
                  <Button type="button" variant="outline" size="icon" onClick={() => setForm(f => ({ ...f, adminPassword: randomPassword() }))} aria-label="Generar otra"><RefreshCw className="h-4 w-4" /></Button>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={create.isPending || !form.name.trim() || !form.adminName.trim() || !form.adminEmail.trim() || form.adminPassword.length < 8} data-testid="button-create-workshop">
                {create.isPending ? "Creando…" : "Crear taller"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
