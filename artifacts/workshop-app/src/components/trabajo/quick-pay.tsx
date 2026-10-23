import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateWorkOrder, getListWorkOrdersQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PaymentDialog } from "@/components/trabajo/dates-card";
import { Wallet } from "lucide-react";

// "Pagó": registra el pago completo de un trabajo entregado sin abrir su ficha (elige el método y listo).
export function QuickPayButton({ workOrderId, total, label = "Pagó", onDone }: { workOrderId: number; total: number; label?: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateWorkOrder();
  const [open, setOpen] = useState(false);

  const confirm = (paymentMethodId: number | null, paidAmount: number) => update.mutate(
    { id: workOrderId, data: { paidAt: new Date().toISOString(), paymentMethodId, paidAmount } as any },
    {
      onSuccess: () => {
        toast({ title: "Pago registrado" });
        qc.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });
        qc.invalidateQueries({ queryKey: ["/api/reports/summary"] });
        qc.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").includes("/api/reports") });
        setOpen(false);
        onDone?.();
      },
      onError: (e: any) => toast({ variant: "destructive", title: e?.data?.error ?? "No se pudo registrar el pago" }),
    },
  );

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`quick-pay-${workOrderId}`}>
        <Wallet className="h-3 w-3 mr-1" />{label}
      </Button>
      <PaymentDialog open={open} onOpenChange={setOpen} total={total} pending={update.isPending} onConfirm={confirm} />
    </>
  );
}
