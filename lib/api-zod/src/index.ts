export * from "./generated/api";
// Los tipos TS generados comparten nombres con los schemas Zod de cuerpos inline
// (p.ej. CancelWorkOrderBody); se exponen bajo un namespace para evitar el choque.
export type * as ApiTypes from "./generated/types";
