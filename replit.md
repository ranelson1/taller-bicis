# Taller de Bicicletas

Sistema de gestión para un taller de bicicletas: clientes, bicicletas, servicios con checklist, repuestos, usuarios, métodos de pago, presupuestos, recepciones y órdenes de trabajo operativas.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (puerto asignado por `PORT`, default 8080)
- `pnpm --filter @workspace/workshop-app run dev` — Frontend React+Vite
- `pnpm --filter @workspace/api-spec run codegen` — regenerar hooks Orval y schemas Zod desde el OpenAPI spec
- `pnpm --filter @workspace/db run push` — aplicar cambios de schema a la DB (solo desarrollo)
- `pnpm run typecheck` — typecheck completo en todos los packages
- Required env: `DATABASE_URL` — Postgres connection string (disponible en Replit automáticamente)

## Demo Credentials (SOLO DESARROLLO — cambiar antes de producción)

| Usuario | Email | Password | Rol |
|---------|-------|----------|-----|
| Admin Taller | admin@taller.com | admin123 | admin |
| Mecánico Juan | juan@taller.com | juan123 | mechanic |
| Mecánico Diego | diego@taller.com | diego123 | mechanic |

**⚠️ Estas credenciales son de seed solo para desarrollo. No usar en producción.**

## Stack

- **Monorepo**: pnpm workspaces, Node.js 24, TypeScript 5.9
- **API**: Express 5 + bcryptjs + express-session (sesiones en cookie)
- **DB**: PostgreSQL + Drizzle ORM (`lib/db`)
- **Validación backend**: Zod (`zod/v4`) en cada route handler
- **Frontend**: React 18 + Vite + Wouter (routing) + react-hook-form + shadcn/ui + Tailwind CSS v4
- **API codegen**: Orval desde `lib/api-spec/openapi.yaml` → hooks en `lib/api-client-react`, schemas en `lib/api-zod`

## Estructura del Proyecto

```
lib/
  api-spec/openapi.yaml      — fuente de verdad del contrato API
  api-client-react/          — hooks TanStack Query generados por Orval
  api-zod/                   — schemas Zod generados por Orval
  db/src/schema/             — schema Drizzle (una tabla por archivo)
artifacts/
  api-server/src/routes/     — rutas Express (auth, users, clients, bicycles, services, serviceSteps, parts, categories, paymentMethods, dashboard, quotes, receptions, work-orders, work-cases)
  api-server/src/helpers/workCase.ts — helper compartido TR: autoCreateWorkCase, triggerWorkCaseRecalc, logWorkCaseEvent
  workshop-app/src/pages/    — páginas React (con CRUD completo)
  workshop-app/src/components/layout/app-layout.tsx — sidebar + nav móvil
```

## Tablas de Base de Datos

| Tabla | Campos clave | Soft-delete |
|-------|-------------|-------------|
| `users` | id, name, email, passwordHash, role (admin/mechanic/reception), weeklyHours, calendarColor, active | ✅ |
| `clients` | id, name, phone, email, notes, active | ✅ |
| `bicycles` | id, clientId, brand, model, type (mtb/road/gravel/urban/ebike/kids/other), color, rimSize, serialNumber, notes, active | ✅ |
| `categories` | id, name, description, active | ✅ |
| `services` | id, name, categoryId, basePrice, estimatedHours, clientDescription, internalDescription, active | ✅ |
| `service_steps` | id, serviceId, description, order, notes, active | ✅ |
| `parts` | id, name, categoryId, brand, suggestedPrice, sku, active | ✅ |
| `payment_methods` | id, name, notes, active | ✅ |

| `work_cases` | id, workCaseNumber (TR-XXXX), clientId, bicycleId, status, assignedMechanicId, originChannel, totalEstimatedAmount, progressPercentage, active | ✅ |
| `quotes` | id, quoteNumber, clientId, bicycleId, workCaseId, status, originChannel, currentVersion, estimatedLaborHours, total, active | ✅ |
| `quote_items` | id, quoteId, itemType, description, quantity, unitPrice, total, approvalStatus, active | ✅ |
| `receptions` | id, receptionNumber, clientId, bicycleId, workCaseId, status, quoteId, receivedAt, active | ✅ |
| `inspection_findings` | id, receptionId, area, severity, finding, recommendation, shouldCreateQuoteItem, active | ✅ |
| `work_orders` | id, workOrderNumber, clientId, bicycleId, workCaseId, quoteId, receptionId, mechanicId, status, priority, progressPercentage, total, active | ✅ |
| `work_order_items` | id, workOrderId, itemType, description, quantity, unitPrice, total, status, active | ✅ |
| `work_order_checklist_items` | id, workOrderId, workOrderItemId, description, status, mechanicNote, active | ✅ |

Todas las tablas tienen `created_at` y `updated_at`.

## OT única + link del cliente (Etapa 6)

El flujo recomendado es **una sola OT que se va actualizando**. Presupuesto (P) y recepción (R)
se siguen creando por dentro desde Nuevo Trabajo, pero ya no aparecen en el menú.

- Ficha del taller `/trabajos/:id`: muestra la OT vigente (número OT, estado, ítems con su aprobación,
  total aprobado), botón **Enviar al cliente** (WhatsApp / copiar link) y avance de estado.
- Adicionales: `POST /api/work-orders/:id/items` crea el ítem con `origin=additional` y
  `approvalStatus=pending` (o `approved` si `alreadyApproved`). Solo los ítems aprobados y no
  cancelados suman al total; los descuentos siempre restan (`computeWorkOrderTotal`).
- El taller puede registrar la decisión del cliente con `POST /api/work-orders/:id/items/:itemId/approval`.
- Link público: `POST /api/work-orders/:id/share` crea (una vez) `work_orders.public_token` y
  devuelve `/ot/:token` + mensaje de WhatsApp.
- Vista del cliente `/ot/:token` (sin login): `GET /api/public/ot/:token` y
  `POST /api/public/ot/:token/items/:itemId/decision`. Solo expone esa OT: sin notas internas,
  teléfono ni email del cliente. El cliente solo puede decidir ítems pendientes de una OT abierta.
- Comentarios con `visibleToClient: true` aparecen en el seguimiento del cliente.
- Estados de OT validados en el backend (`WO_TRANSITIONS`); iniciar requiere mecánico; una OT
  entregada o cancelada ya no cambia. El progreso usa el checklist o, si no tiene, los ítems completados.
- Una sola OT activa por presupuesto (índice único `work_orders_active_quote_unique`).
- Variables opcionales: `WORKSHOP_NAME`, `WORKSHOP_PHONE` (se muestran al cliente), `CORS_ORIGINS`.

Migración: `lib/db/migrations/001-ot-publica.sql` (idempotente). En una base existente correrla con
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/001-ot-publica.sql`.

## Nuevo Trabajo Rápido (Etapa 5A)

- `POST /api/work-cases/quick-create` — crea en una sola transacción atómica: cliente (nuevo o existente), bicicleta (nueva o existente), TR, presupuesto, recepción y OT. Requiere al menos 1 ítem (`items` con `minItems: 1`, cada ítem con `itemType`). La inserción rápida de bicicleta NO persiste `rimSize`.
- `POST /api/work-cases/:id/comment` — agrega un comentario al timeline del TR (`commentType`: recepcion, durante_trabajo, aprobacion_cliente, observacion_tecnica, entrega, interno).
- `createWorkOrderFromQuoteInternal` — helper compartido para crear la OT dentro de la transacción de quick-create.
- Página `/trabajos/nuevo` — wizard de 4 pasos (Cliente / Bicicleta / Recepción / Trabajo) con toggles nuevo-o-existente, selección de mecánico y lista de ítems (mínimo 1). Usa `useQuickCreateWorkCase` y navega a `/trabajos/:id`.
- Ficha operativa `/trabajos/:id` — acciones rápidas: avanzar estado de la OT (`ready_to_work→in_progress→quality_control→ready_for_pickup→delivered`, bloqueando el inicio si no hay mecánico asignado), agregar adicional al presupuesto (`origin=during_work`, no se incorpora al checklist) y agregar comentario al timeline. Tras cada cambio de estado se recalcula el TR.

## Concepto TR (Trabajo)

Un **Trabajo (TR-XXXX)** es la ficha unificada que agrupa todos los documentos de un servicio de bicicleta: presupuestos (P), recepciones (R) y órdenes de trabajo (OT). Reglas clave:

- Cada P/R/OT tiene un campo `workCaseId` (entero sin FK formal, para evitar dependencia circular).
- Al crear un presupuesto o recepción sin TR previo, se crea automáticamente un TR nuevo (`autoCreateWorkCase`).
- Al crear una recepción vinculada a un presupuesto existente, hereda el TR del presupuesto.
- Al crear una OT desde P o R, hereda el TR del presupuesto asociado.
- Al crear un presupuesto desde una recepción (`POST /receptions/:id/create-quote`), el nuevo presupuesto hereda el TR de la recepción.
- El estado del TR se recalcula automáticamente (`triggerWorkCaseRecalc`) en cada cambio de estado de P/R/OT.
- Cada vinculación genera un evento de timeline: `quote_linked_to_work_case`, `reception_linked_to_work_case`, `work_order_linked_to_work_case`.

## Flujo de trabajo completo

1. **Trabajo (TR)** → Se crea automáticamente al crear el primer documento del servicio
2. **Recepción** → Recibir bicicleta, inspeccionar, crear presupuesto con hallazgos
3. **Presupuesto** → Enviar al cliente, aprobar/rechazar ítems, marcar listo para OT
4. **Orden de Trabajo** → Crear desde presupuesto o recepción, asignar mecánico, completar checklist por ítem, controlar calidad, marcar lista para retiro

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (devuelve sesión) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Usuario autenticado |
| GET/POST/PATCH/DELETE | `/api/users` | CRUD usuarios |
| GET | `/api/users/capacity` | Mecánicos activos con capacidad horaria |
| GET/POST/PATCH/DELETE | `/api/clients` | CRUD clientes |
| GET/POST/PATCH/DELETE | `/api/bicycles` | CRUD bicicletas (query: `?clientId=N`) |
| GET/POST/PATCH/DELETE | `/api/services` | CRUD servicios |
| POST/PATCH/DELETE | `/api/service-steps` | CRUD pasos de checklist |
| PATCH | `/api/service-steps/:id/move` | Mover paso (body: `{direction: "up"\|"down"}`) |
| GET/POST/PATCH/DELETE | `/api/parts` | CRUD repuestos |
| GET/POST/PATCH/DELETE | `/api/categories` | CRUD categorías |
| GET/POST/PATCH/DELETE | `/api/payment-methods` | CRUD métodos de pago |
| GET | `/api/dashboard/summary` | Conteos: clientes activos, bicicletas, servicios, mecánicos |

Todos los endpoints (excepto auth) requieren sesión activa. DELETE hace soft-delete (active=false).

## Páginas del Frontend

- `/` — Dashboard (conteos)
- `/clientes` — Lista + CRUD completo
- `/clientes/:id` — Detalle + bicicletas del cliente
- `/bicicletas` — Lista + CRUD completo
- `/admin/usuarios` — CRUD usuarios
- `/admin/servicios` — CRUD servicios
- `/admin/servicios/:id` — Detalle + CRUD pasos (mover/agregar/editar/eliminar)
- `/admin/repuestos` — CRUD repuestos
- `/admin/categorias` — CRUD categorías
- `/admin/metodos-pago` — CRUD métodos de pago
- `/presupuestos`, `/recepciones`, `/ordenes`, `/agenda`, `/pagos` — Placeholders para futuras etapas

## Decisiones de Arquitectura

- **Soft-delete universal**: todas las entidades usan `active=false` en lugar de DELETE físico, para preservar historial. El DELETE HTTP hace soft-delete.
- **Sesiones en cookie**: `express-session` con store en memoria (dev). En producción reemplazar por `connect-pg-simple`.
- **Contrato API como fuente de verdad**: `lib/api-spec/openapi.yaml` es el único lugar donde se define el contrato; cambios ahí → `pnpm codegen` → hooks y schemas se regeneran.
- **`activeMechanics` en dashboard**: solo cuenta usuarios con `role='mechanic'` AND `active=true`, no todos los usuarios activos.
- **Validación Zod en rutas**: cada POST/PATCH valida con Zod (`safeParse`) antes de tocar la DB — errores devuelven 400 con detalles.

## Alcance del MVP (Etapa 0)

Fuera de alcance por ahora: órdenes de trabajo, presupuestos, recepciones, agenda/turnos, pagos/facturación. Las rutas existen como placeholders en el frontend.

## Gotchas

- Al agregar campos a una tabla de DB, correr `pnpm --filter @workspace/db run push` Y (si afectan el OpenAPI spec) actualizar `lib/api-spec/openapi.yaml` + correr codegen.
- El frontend usa `credentials: "include"` explícito en algunas llamadas de autenticación para asegurar el envío de cookies a través del proxy de Replit.
- El `useMoveServiceStep` hook requiere body `{ direction: "up" | "down" }` — la ruta es `PATCH /api/service-steps/:id/move`.

## User preferences

- Idioma de la app: español (Chile)
- Mobile-first responsive
