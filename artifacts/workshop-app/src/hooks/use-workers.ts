import { useListUsers } from "@workspace/api-client-react";

// Quienes hacen trabajos en el taller (se les asignan OT). En un taller de una persona es una sola:
// entonces la app no pregunta por mecánicos y los asigna sola.
export function useWorkers() {
  const { data: users, isLoading } = useListUsers();
  const workers = (users ?? []).filter((u: any) => u.doesJobs && u.active !== false);
  return { workers, isLoading, solo: !isLoading && workers.length <= 1 };
}
