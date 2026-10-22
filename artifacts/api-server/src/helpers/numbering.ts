import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Numeración correlativa por taller (cada taller parte en OT-0001), en la tabla
// document_counters (migración 008). El upsert bloquea la fila del contador, así que dos
// trabajos creados a la vez nunca reciben el mismo número.
const KINDS = ["TR", "P", "R", "OT"] as const;

export async function nextDocumentNumber(exec: Tx | typeof db, kind: typeof KINDS[number]): Promise<string> {
  const result = await exec.execute(sql`
    insert into document_counters (kind, last_value) values (${kind}, 1)
    on conflict (workshop_id, kind) do update set last_value = document_counters.last_value + 1
    returning last_value`);
  const n = Number((result.rows[0] as { last_value: string | number }).last_value);
  return `${kind}-${String(n).padStart(4, "0")}`;
}
