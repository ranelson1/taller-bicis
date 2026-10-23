import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetClient, getGetClientQueryKey, useListBicycles, getListBicyclesQueryKey,
  useUpdateClient, getListClientsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Mail, FileText, Bike, Pencil } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ClientFormDialog, type ClientFormData } from "@/components/client-form-dialog";
import { WhatsAppButton } from "@/components/whatsapp-button";

export default function ClientDetail() {
  const params = useParams();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const updateMutation = useUpdateClient();

  const onSubmit = (data: ClientFormData) => {
    updateMutation.mutate({ id, data }, {
      onSuccess: () => {
        toast({ title: "Cliente actualizado" });
        setEditOpen(false);
        qc.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
      },
      onError: () => toast({ variant: "destructive", title: "Error al actualizar" }),
    });
  };

  const { data: client, isLoading: isClientLoading } = useGetClient(id, {
    query: { enabled: !!id, queryKey: getGetClientQueryKey(id) }
  });
  
  const { data: bicycles, isLoading: isBicyclesLoading } = useListBicycles(
    { clientId: id },
    { query: { enabled: !!id, queryKey: getListBicyclesQueryKey({ clientId: id }) } }
  );

  if (isClientLoading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!client) return <div className="p-8">Cliente no encontrado</div>;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground">{client.name}</h1>
            {!client.active && <Badge variant="destructive">Inactivo</Badge>}
          </div>
          <p className="text-muted-foreground mt-1">Detalles del cliente e historial de bicicletas.</p>
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)} className="flex items-center gap-2 w-fit" data-testid="button-edit-client">
          <Pencil className="h-4 w-4" /> Editar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Información de Contacto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {client.phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a href={`tel:${client.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{client.phone}</a>
                <WhatsAppButton phone={client.phone} text={`Hola ${client.name.split(" ")[0]}, te escribo del taller.`} label="WhatsApp" className="h-7" />
              </div>
            )}
            {client.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{client.email}</span>
              </div>
            )}
          </div>
          {client.notes && (
            <div className="pt-4 border-t">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-muted-foreground mt-1" />
                <p className="text-sm">{client.notes}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Bike className="h-5 w-5" />
          Bicicletas del Cliente
        </h2>

        {isBicyclesLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marca / Modelo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Color / Rodado</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bicycles?.map((bike) => (
                  <TableRow key={bike.id} className={!bike.active ? "opacity-60" : ""}>
                    <TableCell>
                      <Link href={`/bicicletas/${bike.id}`} className="block hover:underline" data-testid={`link-bicycle-${bike.id}`}>
                        <div className="font-medium">{bike.brand}</div>
                        <div className="text-sm text-muted-foreground">{bike.model}</div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{bike.type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {bike.color && <span>{bike.color}</span>}
                      {bike.color && bike.rimSize && <span> • </span>}
                      {bike.rimSize && <span>{bike.rimSize}"</span>}
                    </TableCell>
                    <TableCell>
                      {!bike.active && <Badge variant="destructive">Inactiva</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {bicycles?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      El cliente no tiene bicicletas registradas.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ClientFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
        pending={updateMutation.isPending}
        onSubmit={onSubmit}
      />
    </div>
  );
}
