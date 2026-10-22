import { useState } from "react";
import { Link } from "wouter";
import {
  useListClients, useCreateClient, useUpdateClient, useDeleteClient,
  getListClientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Mail, Bike, Plus, Pencil, Ban, RotateCcw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ClientFormDialog, type ClientFormData } from "@/components/client-form-dialog";
import { WhatsAppButton } from "@/components/whatsapp-button";

type ClientRow = { id: number; name: string; phone?: string | null; email?: string | null; notes?: string | null; active: boolean; bicycleCount: number };

export default function Clients() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients, isLoading } = useListClients();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ClientRow | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();
  const deleteMutation = useDeleteClient();

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (client: ClientRow) => {
    setEditing(client);
    setDialogOpen(true);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: getListClientsQueryKey() });

  const onSubmit = (data: ClientFormData) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Cliente actualizado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => { toast({ title: "Cliente creado" }); setDialogOpen(false); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al crear" }),
      });
    }
  };

  const handleToggleActive = (client: ClientRow) => {
    if (client.active) {
      setDeactivateTarget(client);
    } else {
      updateMutation.mutate({ id: client.id, data: { active: true } }, {
        onSuccess: () => { toast({ title: "Cliente reactivado" }); invalidate(); },
        onError: () => toast({ variant: "destructive", title: "Error al reactivar" }),
      });
    }
  };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    updateMutation.mutate({ id: deactivateTarget.id, data: { active: false } }, {
      onSuccess: () => { toast({ title: "Cliente desactivado" }); setDeactivateTarget(null); invalidate(); },
      onError: () => toast({ variant: "destructive", title: "Error al desactivar" }),
    });
  };

  const visible = clients?.filter(c => showInactive ? true : c.active) ?? [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Clientes</h1>
          <p className="text-muted-foreground mt-1">Gestión de base de clientes del taller.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowInactive(!showInactive)} data-testid="button-toggle-inactive">
            {showInactive ? "Ocultar inactivos" : "Ver inactivos"}
          </Button>
          <Button onClick={openCreate} className="flex items-center gap-2" data-testid="button-create-client">
            <Plus className="h-4 w-4" /> Nuevo Cliente
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Bicicletas</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow key={c.id} data-testid={`row-client-${c.id}`} className={!c.active ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      <Link href={`/clientes/${c.id}`} className="hover:underline text-primary flex items-center gap-1">
                        {c.name} <ExternalLink className="h-3 w-3 opacity-50" />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                        {c.phone && (
                          <span className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3" />{c.phone}
                            <WhatsAppButton phone={c.phone} text={`Hola ${c.name.split(" ")[0]}, te escribo del taller.`} className="h-6 px-1.5" />
                          </span>
                        )}
                        {c.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                        {!c.phone && !c.email && <span>—</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="flex w-fit items-center gap-1">
                        <Bike className="h-3 w-3" />{c.bicycleCount}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.active ? <Badge className="bg-green-500/10 text-green-700">Activo</Badge> : <Badge variant="destructive">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(c)} data-testid={`button-edit-client-${c.id}`}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => handleToggleActive(c)} data-testid={`button-toggle-client-${c.id}`}>
                          {c.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No hay clientes.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {visible.map((c) => (
              <Card key={c.id} data-testid={`card-client-${c.id}`} className={!c.active ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">
                      <Link href={`/clientes/${c.id}`} className="hover:underline text-primary">{c.name}</Link>
                    </CardTitle>
                    {!c.active && <Badge variant="destructive">Inactivo</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {c.phone && (
                      <p className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />{c.phone}
                        <WhatsAppButton phone={c.phone} text={`Hola ${c.name.split(" ")[0]}, te escribo del taller.`} label="WhatsApp" className="h-7 ml-auto" />
                      </p>
                    )}
                    {c.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4" />{c.email}</p>}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <Badge variant="secondary" className="flex w-fit items-center gap-1">
                      <Bike className="h-4 w-4" />{c.bicycleCount} {c.bicycleCount === 1 ? "bicicleta" : "bicicletas"}
                    </Badge>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleToggleActive(c)}>
                        {c.active ? <Ban className="h-4 w-4 text-destructive" /> : <RotateCcw className="h-4 w-4 text-green-600" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {visible.length === 0 && <div className="text-center py-10 text-muted-foreground bg-card rounded-lg border">No hay clientes.</div>}
          </div>
        </>
      )}

      {/* Create/Edit Dialog */}
      <ClientFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editing}
        pending={createMutation.isPending || updateMutation.isPending}
        onSubmit={onSubmit}
      />

      {/* Deactivate Alert */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Se desactivará <strong>{deactivateTarget?.name}</strong>. El registro no se eliminará.
            </AlertDialogDescription>
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
