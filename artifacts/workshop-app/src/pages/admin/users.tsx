import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useListUsers, useCreateUser, useUpdateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import type { UserUpdate } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Clock, Pencil, Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const ROLE_LABELS: Record<string, string> = { admin: "Administrador", mechanic: "Mecánico", reception: "Recepción" };

const userSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres").optional().or(z.literal("")),
  role: z.enum(["admin", "mechanic", "reception"]),
  weeklyHours: z.coerce.number().int().min(0).max(168).optional().nullable(),
  calendarColor: z.string().optional().nullable(),
});
type UserForm = z.infer<typeof userSchema>;

type UserRow = { id: number; name: string; email: string; role: string; weeklyHours?: number | null; calendarColor?: string | null; active: boolean };

export default function Users() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users, isLoading } = useListUsers();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();

  const form = useForm<UserForm>({
    resolver: zodResolver(userSchema),
    defaultValues: { name: "", email: "", password: "", role: "mechanic", weeklyHours: undefined, calendarColor: "" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", email: "", password: "", role: "mechanic", weeklyHours: undefined, calendarColor: "" });
    setDialogOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    form.reset({ name: u.name, email: u.email, password: "", role: u.role as "admin" | "mechanic" | "reception", weeklyHours: u.weeklyHours, calendarColor: u.calendarColor ?? "" });
    setDialogOpen(true);
  };

  const onSubmit = (values: UserForm) => {
    const data: Record<string, unknown> = {
      name: values.name, email: values.email, role: values.role,
      weeklyHours: values.weeklyHours ?? null,
      calendarColor: values.calendarColor || null,
    };
    if (values.password) data.password = values.password;

    if (editing) {
      updateMutation.mutate({ id: editing.id, data: data as Parameters<typeof updateMutation.mutate>[0]["data"] }, {
        onSuccess: () => { toast({ title: "Usuario actualizado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      if (!values.password) { form.setError("password", { message: "La contraseña es requerida" }); return; }
      createMutation.mutate({ data: { ...data, password: values.password } as Parameters<typeof createMutation.mutate>[0]["data"] }, {
        onSuccess: () => { toast({ title: "Usuario creado" }); setDialogOpen(false); invalidate(); },
        onError: (e: unknown) => {
          const msg = (e as { data?: { error?: string } })?.data?.error ?? "Error al crear";
          toast({ variant: "destructive", title: msg });
        },
      });
    }
  };

  const handleToggleActive = (u: UserRow) => {
    if (u.active) setDeactivateTarget(u);
    else updateMutation.mutate({ id: u.id, data: { active: true } }, {
      onSuccess: () => { toast({ title: "Usuario reactivado" }); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    updateMutation.mutate({ id: deactivateTarget.id, data: { active: false } }, {
      onSuccess: () => { toast({ title: "Usuario desactivado" }); setDeactivateTarget(null); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error" }),
    });
  };

  const visible = users?.filter(u => showInactive ? true : u.active) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Usuarios</h1>
          <p className="text-muted-foreground mt-1">Gestión del equipo del taller.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? "Ocultar inactivos" : "Ver inactivos"}
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2" data-testid="button-create-user">
            <Plus className="h-4 w-4" /> Nuevo Usuario
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Capacidad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`} className={!u.active ? "opacity-60" : ""}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {u.calendarColor && <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: u.calendarColor }} />}
                      {u.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                  <TableCell><Badge variant="outline">{ROLE_LABELS[u.role] ?? u.role}</Badge></TableCell>
                  <TableCell>
                    {u.weeklyHours ? (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground"><Clock className="h-3 w-3" />{u.weeklyHours}h/sem</span>
                    ) : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                  <TableCell>
                    {u.active ? <Badge className="bg-green-500/10 text-green-700">Activo</Badge> : <Badge variant="destructive">Inactivo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(u)} data-testid={`button-edit-user-${u.id}`}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleToggleActive(u)} data-testid={`button-toggle-user-${u.id}`}>
                        {u.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No hay usuarios.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Nombre *</FormLabel><FormControl><Input {...field} data-testid="input-user-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email *</FormLabel><FormControl><Input type="email" {...field} data-testid="input-user-email" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>{editing ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña *"}</FormLabel>
                  <FormControl><Input type="password" {...field} value={field.value ?? ""} data-testid="input-user-password" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem><FormLabel>Rol *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="mechanic">Mecánico</SelectItem>
                      <SelectItem value="reception">Recepción</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="weeklyHours" render={({ field }) => (
                  <FormItem><FormLabel>Horas/semana</FormLabel><FormControl><Input type="number" min={0} max={168} {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? null : Number(e.target.value))} data-testid="input-user-hours" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="calendarColor" render={({ field }) => (
                  <FormItem><FormLabel>Color agenda</FormLabel><FormControl><Input type="color" {...field} value={field.value ?? "#3b82f6"} data-testid="input-user-color" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-user">
                  {editing ? "Guardar cambios" : "Crear usuario"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar usuario?</AlertDialogTitle>
            <AlertDialogDescription>Se desactivará <strong>{deactivateTarget?.name}</strong>. No podrá iniciar sesión.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Desactivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
