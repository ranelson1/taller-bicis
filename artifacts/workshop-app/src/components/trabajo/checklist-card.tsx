import { useState } from "react";
import {
  useUpdateWorkOrderChecklistItem,
  type WorkOrderChecklistItem,
  type WorkOrderItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CheckCircle2, ClipboardCheck, Eye, MinusCircle, MoreHorizontal, StickyNote } from "lucide-react";

// Checklist del mecánico dentro de la ficha del trabajo.
// Un toque marca el paso como hecho; observación, "no aplica" y notas van en el menú.

const DONE = ["completed", "with_observation", "not_applicable"];

type Props = {
  workOrderId: number;
  checklist: WorkOrderChecklistItem[];
  items: WorkOrderItem[];
  disabled: boolean;
  onChanged: () => void;
};

export function ChecklistCard({ workOrderId, checklist, items, disabled, onChanged }: Props) {
  const { toast } = useToast();
  const update = useUpdateWorkOrderChecklistItem();
  const [noteFor, setNoteFor] = useState<{ step: WorkOrderChecklistItem; status: string } | null>(null);
  const [note, setNote] = useState("");

  const save = (step: WorkOrderChecklistItem, status: string, mechanicNote?: string | null) => {
    update.mutate({
      id: workOrderId,
      checklistItemId: step.id,
      data: { status: status as any, mechanicNote: mechanicNote !== undefined ? mechanicNote : step.mechanicNote ?? null },
    }, {
      onSuccess: () => { setNoteFor(null); onChanged(); },
      onError: () => toast({ variant: "destructive", title: "No se pudo actualizar el paso" }),
    });
  };

  const askNote = (step: WorkOrderChecklistItem, status: string) => {
    setNote(step.mechanicNote ?? "");
    setNoteFor({ step, status });
  };

  // Agrupado por ítem del trabajo; los pasos sueltos al final.
  const groups: Array<{ title: string | null; steps: WorkOrderChecklistItem[] }> = [];
  for (const item of items) {
    const steps = checklist.filter(c => c.workOrderItemId === item.id);
    if (steps.length > 0) groups.push({ title: item.description, steps });
  }
  const loose = checklist.filter(c => !c.workOrderItemId || !items.some(i => i.id === c.workOrderItemId));
  if (loose.length > 0) groups.push({ title: groups.length > 0 ? "Otros pasos" : null, steps: loose });

  const done = checklist.filter(c => DONE.includes(c.status)).length;

  return (
    <Card>
      <CardHeader className="pb-1 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" />Checklist
        </CardTitle>
        <span className="text-sm text-muted-foreground">{done}/{checklist.length}</span>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${checklist.length ? Math.round((done / checklist.length) * 100) : 0}%` }} />
        </div>
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && <p className="text-xs font-semibold text-muted-foreground mb-1">{g.title}</p>}
            <ul className="divide-y">
              {g.steps.map(step => {
                const isDone = DONE.includes(step.status);
                return (
                  <li key={step.id} className="py-1.5">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        disabled={disabled || update.isPending}
                        onClick={() => save(step, isDone ? "pending" : "completed")}
                        className="flex-1 flex items-start gap-2.5 text-left min-h-9 py-1 disabled:cursor-default"
                        data-testid={`checklist-step-${step.id}`}
                      >
                        {step.status === "not_applicable" ? <MinusCircle className="h-5 w-5 text-muted-foreground shrink-0" />
                          : step.status === "with_observation" ? <Eye className="h-5 w-5 text-blue-600 shrink-0" />
                          : isDone ? <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                          : <span className="h-5 w-5 rounded-full border-2 border-muted-foreground/40 shrink-0" />}
                        <span className={cn("text-sm", step.status === "not_applicable" && "line-through text-muted-foreground", step.status === "completed" && "text-muted-foreground")}>
                          {step.description}
                          {step.status === "with_observation" && <span className="ml-1 text-xs text-blue-700">· con observación</span>}
                          {step.mechanicNote && <span className="block text-xs text-muted-foreground italic">"{step.mechanicNote}"</span>}
                        </span>
                      </button>
                      {!disabled && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Más opciones del paso"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => askNote(step, "with_observation")}><Eye className="h-4 w-4 mr-2" />Hecho con observación</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => save(step, "not_applicable")}><MinusCircle className="h-4 w-4 mr-2" />No aplica</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => askNote(step, step.status)}><StickyNote className="h-4 w-4 mr-2" />{step.mechanicNote ? "Editar nota" : "Agregar nota"}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {noteFor?.step.id === step.id && (
                      <div className="flex gap-2 pl-7 pb-1">
                        <Input autoFocus className="h-8 text-sm" placeholder={noteFor.status === "with_observation" ? "¿Qué observaste?" : "Nota del mecánico..."}
                          value={note} onChange={e => setNote(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") save(step, noteFor.status, note.trim() || null); }} />
                        <Button size="sm" className="h-8" disabled={update.isPending} onClick={() => save(step, noteFor.status, note.trim() || null)}>Guardar</Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setNoteFor(null)}>Cancelar</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
