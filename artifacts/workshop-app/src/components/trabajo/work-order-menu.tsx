import { useState } from "react";
import { useCancelWorkOrder, useUpdateWorkOrder, type WorkOrder } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Ban, MoreVertical, StickyNote } from "lucide-react";

// Acciones poco frecuentes de la ficha: editar notas y cancelar el trabajo.
export function WorkOrderMenu({ wo, onChanged }: { wo: WorkOrder; onChanged: () => void }) {
  const { toast } = useToast();
  const update = useUpdateWorkOrder();
  const cancel = useCancelWorkOrder();
  const [notesOpen, setNotesOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const isClosed = wo.status === "delivered" || wo.status === "cancelled";

  const openNotes = () => {
    setInternalNotes(wo.internalNotes ?? "");
    setCustomerNotes(wo.customerNotes ?? "");
    setNotesOpen(true);
  };

  const saveNotes = () => {
    update.mutate({ id: wo.id, data: { internalNotes: internalNotes.trim() || null, customerNotes: customerNotes.trim() || null } }, {
      onSuccess: () => { toast({ title: "Notas guardadas" }); setNotesOpen(false); onChanged(); },
      onError: () => toast({ variant: "destructive", title: "No se pudieron guardar las notas" }),
    });
  };

  const confirmCancel = () => {
    cancel.mutate({ id: wo.id, data: { comment: cancelReason.trim() || undefined } as any }, {
      onSuccess: () => { toast({ title: "Trabajo cancelado" }); setCancelOpen(false); setCancelReason(""); onChanged(); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo cancelar" }),
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Más acciones" data-testid="button-more"><MoreVertical className="h-5 w-5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={openNotes}><StickyNote className="h-4 w-4 mr-2" />Editar notas</DropdownMenuItem>
          {!isClosed && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCancelOpen(true)} className="text-destructive focus:text-destructive" data-testid="menu-cancel-wo">
                <Ban className="h-4 w-4 mr-2" />Cancelar trabajo
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notas del trabajo</DialogTitle>
            <DialogDescription>Para registrar avances con fecha usa “Agregar comentario”.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Nota interna (solo el taller)</Label>
              <Textarea rows={3} value={internalNotes} onChange={e => setInternalNotes(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mensaje para el cliente (se ve en su link)</Label>
              <Textarea rows={3} value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesOpen(false)}>Cancelar</Button>
            <Button onClick={saveNotes} disabled={update.isPending}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar {wo.workOrderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>El trabajo queda cancelado y ya no se puede modificar. El cliente lo verá en su link.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Motivo (opcional)</Label>
            <Textarea rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Ej: el cliente no aprobó el presupuesto" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Sí, cancelar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
