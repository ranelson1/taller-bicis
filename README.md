# TallerBicis

Sistema de gestión para talleres de bicicletas: clientes, bicicletas, servicios con checklist,
repuestos, presupuestos, recepciones, órdenes de trabajo y la ficha unificada de **Trabajos (TR)**.

Documentación funcional y de arquitectura: [`replit.md`](./replit.md).

## Requisitos

- Node.js 22+ (desarrollado con 24) y pnpm 10
- PostgreSQL 16+

## Desarrollo local

```bash
pnpm install --frozen-lockfile

export DATABASE_URL="postgresql://usuario@localhost/taller"
export SESSION_SECRET="$(openssl rand -hex 32)"
export WORKSHOP_NAME="Mi Taller"            # opcional, se muestra al cliente
export WORKSHOP_PHONE="+56 9 1234 5678"     # opcional, botones Llamar/WhatsApp del cliente

# Base nueva: crear tablas y datos demo (no hacerlo sobre una base restaurada)
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run seed

# Terminal 1 — API
PORT=8080 pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend, reenviando /api al backend
PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:8080 \
  pnpm --filter @workspace/workshop-app run dev
```

Abrir http://localhost:5173. Usuarios demo en `replit.md` (solo desarrollo).

## Migraciones

`drizzle push` pide confirmaciones interactivas en bases con datos. Los cambios de esquema se
entregan también como SQL idempotente en `lib/db/migrations/`; aplicarlos en orden:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/001-ot-publica.sql
```

## Comandos útiles

- `pnpm run typecheck` — typecheck de todo el monorepo
- `pnpm --filter @workspace/api-spec run codegen` — regenerar cliente y schemas desde `lib/api-spec/openapi.yaml`

## Producción

Ver `LEEME-TRASLADO.md` del respaldo original: build de API y frontend, Nginx con `/api` hacia el
backend, HTTPS y un store de sesiones persistente (hoy en memoria).

> ⚠️ Nunca subir respaldos de base de datos ni archivos `.env` a este repositorio.
