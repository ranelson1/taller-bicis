# TallerBicis

Sistema de gestión para talleres de bicicletas: trabajos (una OT por bicicleta con checklist, fotos,
adicionales que el cliente aprueba desde un link, fechas y pagos), clientes, bicicletas y catálogo.
**Una sola instalación sirve a varios talleres**: cada taller entra con sus usuarios y ve solo lo suyo.

Documentación funcional y de arquitectura: [`replit.md`](./replit.md).

## Requisitos

- Node.js 22+ (desarrollado con 24) y pnpm 10
- PostgreSQL 16+ (en local, con Docker)

## Desarrollo local (Windows)

```powershell
pnpm install
.\dev.ps1
```

La primera vez `dev.ps1` crea el contenedor de Postgres, el esquema, el usuario de la app, el
superadmin y el taller demo ([`seed/demo-sendero.json`](artifacts/api-server/seed/demo-sendero.json)).
Las credenciales quedan en `.env` (no se sube al repo).

En otro sistema, lo mismo a mano:

```bash
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/schema.sql
psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -v app_password='...' -f lib/db/scripts/grant-app-role.sql
SUPERADMIN_EMAIL=tu@correo.cl SUPERADMIN_PASSWORD='...' pnpm --filter @workspace/api-server run create-superadmin
DEMO_USERS_PASSWORD='...' pnpm --filter @workspace/api-server run seed      # taller demo, opcional

PORT=8080 pnpm --filter @workspace/api-server run dev
PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:8080 pnpm --filter @workspace/workshop-app run dev
```

## Varios talleres

- **Superadmin** (dueño de la plataforma): entra a `/plataforma`, crea talleres con su primer
  administrador, los activa o desactiva y puede "entrar" a uno para dar soporte.
- **Usuarios de un taller** (admin, mecánico, recepción): el email identifica su taller; ven y
  editan solo datos de ese taller. El admin de cada taller crea a su equipo en Administración → Usuarios.
- **Aislamiento**: cada tabla tiene `workshop_id` y Postgres aplica Row Level Security; la API fija
  el taller de la sesión en la conexión de cada request. Si una consulta olvida filtrar, la base filtra
  igual. Prueba automática (entra como dos talleres e intenta cruzar datos):

  ```bash
  ISOLATION_A="admin@tallerA.cl:clave" ISOLATION_B="admin@tallerB.cl:clave" pnpm --filter @workspace/api-server run check-isolation
  ```

### Usuario de base de datos de la app

RLS **no aplica a superusuarios ni a roles con BYPASSRLS**. Por eso hay dos conexiones:

| Variable | Usuario | Para qué |
|---|---|---|
| `DATABASE_URL` | `taller_app` (normal) | La API y los scripts (`create-superadmin`, `seed`) |
| `DATABASE_URL_ADMIN` | dueño de la base | Esquema y migraciones |

La API revisa al partir: si su usuario puede saltarse RLS, en producción no arranca.

## Migraciones

Para una base que ya existe, aplicar en orden lo que falte de `lib/db/migrations/` (son idempotentes)
con el usuario dueño:

```bash
for f in lib/db/migrations/*.sql; do psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f "$f"; done
```

`008-multi-taller.sql` convierte una base de un solo taller: sus datos pasan a ser el taller #1.
Después crear el usuario de la app (`lib/db/scripts/grant-app-role.sql`) y apuntar `DATABASE_URL` a él.
No usar `drizzle push`: no conoce las políticas de RLS.

Para una base nueva basta `lib/db/schema.sql`. Si cambias el esquema con una migración, regéneralo:
`pg_dump --schema-only --no-owner --no-privileges` desde una base migrada.

## Comandos útiles

- `pnpm run typecheck` — typecheck de todo el monorepo
- `pnpm --filter @workspace/api-spec run codegen` — regenerar cliente y schemas desde `lib/api-spec/openapi.yaml`
- `psql "$DATABASE_URL_ADMIN" -v workshop=<id> -f lib/db/scripts/delete-workshop.sql` — borrar un taller de prueba y todos sus datos

## Producción

Despliegue en Railway (o cualquier hosting con Docker): ver [docs/railway.md](docs/railway.md). El
`Dockerfile` arma una sola app que sirve la API y la web; al arrancar, `scripts/bootstrap` crea el
esquema o aplica las migraciones nuevas, crea el usuario `taller_app` y el superadmin. Variables:
`DATABASE_URL_ADMIN`, `APP_DB_PASSWORD`, `SESSION_SECRET` (32+ caracteres), `SUPERADMIN_EMAIL`,
`SUPERADMIN_PASSWORD` y, para leer facturas en PDF o foto, `ANTHROPIC_API_KEY`. Las fotos, videos y
documentos van a `UPLOADS_DIR` (monta un volumen) o cambia `helpers/photoStorage.ts` por S3/R2.

> ⚠️ Nunca subir respaldos de base de datos ni archivos `.env` a este repositorio.
