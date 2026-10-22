import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const clientSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  phone: z.string().optional().nullable(),
  email: z.string().email("Email inválido").optional().or(z.literal("")).nullable(),
  notes: z.string().optional().nullable(),
});
type ClientForm = z.infer<typeof clientSchema>;

export type ClientFormData = { name: string; phone: string | null; email: string | null; notes: string | null };
type ClientValues = { name: string; phone?: string | null; email?: string | null; notes?: string | null };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cliente a editar; sin él el diálogo crea uno nuevo. */
  client?: ClientValues | null;
  pending?: boolean;
  onSubmit: (data: ClientFormData) => void;
};

export function ClientFormDialog({ open, onOpenChange, client, pending, onSubmit }: Props) {
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: "", phone: "", email: "", notes: "" },
  });

  // Solo al abrir: si el cliente se recarga con el diálogo abierto no se pierde lo escrito.
  useEffect(() => {
    if (open) {
      form.reset({ name: client?.name ?? "", phone: client?.phone ?? "", email: client?.email ?? "", notes: client?.notes ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (values: ClientForm) =>
    onSubmit({ name: values.name, phone: values.phone || null, email: values.email || null, notes: values.notes || null });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre *</FormLabel>
                <FormControl><Input placeholder="Nombre del cliente" {...field} data-testid="input-client-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Teléfono</FormLabel>
                <FormControl><Input placeholder="+56 9 XXXX XXXX" {...field} value={field.value ?? ""} data-testid="input-client-phone" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="cliente@ejemplo.com" {...field} value={field.value ?? ""} data-testid="input-client-email" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notas</FormLabel>
                <FormControl><Textarea placeholder="Notas internas..." {...field} value={field.value ?? ""} data-testid="input-client-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending} data-testid="button-submit-client">
                {client ? "Guardar cambios" : "Crear cliente"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
