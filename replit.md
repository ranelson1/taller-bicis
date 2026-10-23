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

## Multi-taller (Etapa 8)

- Tabla `workshops`; todas las demás tienen `workshop_id` (default `current_workshop_id()`), con
  Row Level Security forzado (migración `008-multi-taller.sql`, esquema completo en `lib/db/schema.sql`).
- `lib/db/src/index.ts`: cada request usa su propia conexión con `app.workshop_id` fijado
  (`runWithTenantConnection`, middleware en `app.ts`); `db` es un proxy a esa conexión, así las rutas
  no filtran a mano. `withBypass` solo para login, links públicos (`/ot/:token`) y `/api/platform`.
- Sesión: `userId` + `workshopId`. Rol `superadmin` (sin taller) administra `/plataforma` y puede
  entrar a un taller (`POST /api/platform/workshops/:id/enter`) — ahí actúa como su admin.
- Numeración por taller en `document_counters` (cada taller parte en OT-0001).
- Configuración por taller en `workshop_settings` (PK `workshop_id`); ya no se usan `WORKSHOP_*`.
- Fotos guardadas en `uploads/taller-<id>/ot-<id>/`.
- Scripts: `create-superadmin`, `load-demo`/`seed` (JSON de `docs/esquema-seed.md`), `check-isolation`.

## Simplificación (Etapa 7): un trabajo = una OT

- **Navegación**: Inicio, Trabajos, Clientes, Bicicletas. Administración (solo rol `admin`):
  Usuarios, Catálogo (servicios/repuestos/categorías en pestañas) y Configuración (datos del taller,
  días hábiles, métodos de pago).
- **Permisos**: `adminOnlyWrites` (middlewares/auth.ts) — usuarios, catálogos y configuración se
  leen con cualquier sesión, pero solo un admin puede crearlos, editarlos o borrarlos.
- **Estados**: una sola fuente, `workshop-app/src/lib/work-status.ts` (Recibida → En reparación →
  Control de calidad → Lista para retiro → Entregada). La lista y el Inicio usan las OT, no los TR.
- **Inicio** (`pages/dashboard.tsx`): alertas (atrasados, esperando al cliente, listas sin retirar,
  entregadas con saldo), tablero por estado y carga por mecánico. Un mecánico puede ver solo lo suyo.
- **Nuevo trabajo** (`pages/trabajo-nuevo.tsx`): una pantalla — buscar cliente por nombre o teléfono,
  bici del cliente o nueva, servicios del catálogo como botones, término estimado en vivo
  (`POST /api/work-orders/estimate-preview`) antes de crear.
- **Ficha** (`pages/trabajo-detail.tsx` + `components/trabajo/`): checklist en línea, quitar ítems,
  editar notas y cancelar en el menú ⋮, pago con método y monto (abonos), acción principal fija abajo
  en el celular. `/ordenes/:id` redirige al trabajo; `/presupuestos/:id` y `/recepciones/:id` quedan solo
  para trabajos antiguos sin OT.
- **WhatsApp** (`shareMessage`): el texto cambia según el momento (adicionales por aprobar, lista para
  retirar con total, fecha estimada si no ha vencido).
- **Sesiones** en Postgres (`connect-pg-simple`, tabla `session`): reiniciar la API no cierra sesiones.
- **Numeración** TR/P/R/OT con secuencias (`helpers/numbering.ts`), sin choques al crear en paralelo.
- **Configuración** en `workshop_settings` (una fila). Si está vacía se usan `WORKSHOP_NAME`,
  `WORKSHOP_PHONE` y `WORKSHOP_WORKDAYS`; una vez guardada desde la app, manda lo guardado.

Migraciones: `003-pago-ot.sql`, `004-sesiones.sql`, `005-configuracion-y-numeracion.sql`.

### Horario y capacidad (`helpers/schedule.ts`, migración `006-horario-taller.sql`)

- Configuración guarda el horario por día (`schedule`: `[{day, open, close}]`, solo días que abre) y una
  colación del equipo (`lunch_start`/`lunch_end`, null = sin colación). Horas netas del día = cierre −
  apertura − la parte de la colación que cae dentro. Sin horario guardado: L–V 10:00–19:00, colación 14–15.
- Capacidad de cada mecánico = horas netas del día × (sus `weeklyHours` / horas netas semanales del
  taller, tope 1; sin `weeklyHours` = jornada completa).
- La estimación recorre día a día desde ahora (cuenta lo que queda de hoy) hasta cubrir la cola.

## Fechas de la OT y término estimado

- Al crear una OT sin fecha (Nuevo Trabajo, desde presupuesto o recepción) se calcula
  `estimatedDeliveryDate` con `helpers/completionEstimate.ts`: horas pendientes de las OT abiertas
  (del mecánico asignado, o de todo el taller si no hay) + horas de la OT nueva, divididas por la
  capacidad diaria (`weeklyHours` de los mecánicos / días hábiles). Una OT sin horas cuenta 1 h.
- Las horas de cada ítem salen del servicio del catálogo (`services.estimatedHours`) si no vienen.
- `POST /api/work-orders/:id/estimate` recalcula (botón **Recalcular** en la ficha).
- Fechas independientes en la ficha: ingreso (`createdAt`), término estimado, terminada
  (`completedAt`, al quedar lista para retiro; se borra si vuelve a reparación), entregada
  (`deliveredAt`) y pagada (`paidAt`, vía `PATCH /api/work-orders/:id`).
- Variable opcional `WORKSHOP_WORKDAYS` (0=domingo … 6=sábado), por defecto `1,2,3,4,5`.

Migración: `lib/db/migrations/002-fechas-ot.sql` (agrega `work_orders.paid_at`).

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

- `/` — Inicio: guía "Deja tu taller listo" (admin), por comprar, alertas y tablero por estado
- `/mis-trabajos` — lo que me toca (por empezar, en curso, listos) con botones grandes; "Tomar este trabajo"
- `/trabajos`, `/trabajos/nuevo`, `/trabajos/:id` — lista (saldo por cobrar, avance), alta rápida y ficha de la OT
  (fotos y videos, números del trabajo, aviso al cliente por WhatsApp)
- `/clientes`, `/clientes/:id`, `/bicicletas` — clientes y bicicletas
- `/inventario?tab=stock|compras|comprar` y `/inventario/compras/:id` — stock, compras (XML/PDF/foto) y lista de compra
- `/admin/numeros` — Mis números: margen real, cobrado, por cobrar, servicios más usados, por mecánico
- `/admin/catalogo` (servicios con receta de insumos y categorías), `/admin/usuarios`, `/admin/configuracion`
  (datos, horario, costo de la hora, margen, IVA, logo, métodos de pago)
- `/ot/:token` — vista pública del cliente (sin login); `/plataforma` — superadmin

## Inventario, compras y números (migraciones 010 y 011)

- `parts` es el inventario: `kind` repuesto/insumo, `unit`, `cost_price` (costo promedio), `stock`, `min_stock`.
  Todo movimiento queda en `inventory_movements` (compra, consumo, devolución, ajuste).
- Compras (`purchases`/`purchase_items`): borrador → confirmar suma stock. `helpers/invoiceReader.ts` lee XML (SII y
  formatos genéricos) y, con `ANTHROPIC_API_KEY`, PDF/fotos con Claude. Una línea "para un trabajo" entra al stock y se
  consume al tiro en la OT, con PVP del distribuidor o margen por defecto.
- Recetas (`service_supplies`): insumos que gasta un servicio; se descuentan al pasar la OT a "lista para retiro".
- `GET /api/work-orders/:id/economics` y `GET /api/reports/summary` (solo admin): ingresos, repuestos, mano de obra
  (horas × costo de la hora) y margen.

## Reservas (migración 013)

- `reservations`: espacio apartado para una bici que va a llegar (acordado por WhatsApp). No consume número de OT; la OT se
  crea al llegar el cliente con Nuevo trabajo (`/trabajos/nuevo?reserva=<id>` precarga lo acordado; `quick-create` recibe
  `reservationId` y deja la reserva `arrived` enlazada a la OT).
- `helpers/completionEstimate.ts` cuenta las reservas en la carga, en orden de llegada, y devuelve día de inicio y de entrega.
  `POST /api/reservations/preview` da las fechas de una reserva antes de guardarla.
- Inicio: botón "Reservar", sección "Reservas" con "Confirmar" (WhatsApp con día, hora y fecha estimada de entrega), "Llegó",
  "No llegó" y "Cancelar".

## Cobro y cotización viva (migración 014)

- `workshop_settings.payment_info`: datos para transferir (Configuración). El link del cliente los muestra solo con la bici lista
  o entregada y saldo pendiente; el mensaje de cobro por WhatsApp (`paymentReminder`) los incluye.
- `POST /api/work-orders/:id/items/:itemId/warranty`: deja el ítem en $0 conservando su costo y anota "por garantía (valor $X)".
- En la ficha del trabajo, agregar/quitar/pasar por garantía un ítem ofrece "Avisar por WhatsApp" con el mensaje de cotización
  actualizada; los repuestos "que trae el cliente" se agregan sin cobro ni stock.

## Ficha de ajustes de la bici (migración 015)

- `bicycles.setup_notes` / `setup_updated_at`: texto libre con presiones, clicks de horquilla y shock, apertura de palancas.
  `PUT /api/bicycles/:id/setup`; tarjeta "Ajustes de la bici" en la ficha del trabajo (con plantilla). El link del cliente la
  muestra solo con la bici lista o entregada; queda en la bici como punto de partida del siguiente servicio.

## Historial por bicicleta

- `GET /api/bicycles/:id/history`: trabajos de la bici con sus servicios, último servicio de cada tipo (solo trabajos terminados),
  total invertido y entregados. Página `/bicicletas/:id` (desde la lista de bicis, la ficha del cliente y la ficha del trabajo)
  con la ficha de ajustes. Base para los recordatorios de próxima mantención.
## Recontacto e historial de bicicleta (migraciones 016 y 017)

- Recontacto (`helpers/followups.ts`, `GET /api/followups`): por bicicleta y servicio se mira la última entrega; vence a los
  `services.followup_months` (null = sugerido según el nombre, 0 = nunca). Excluye clientes con trabajo abierto, reserva
  pendiente o "ya le escribí" (`followup_snoozes`). Inicio muestra "A quién escribirle" y `/seguimiento` la lista completa;
  el botón abre WhatsApp con el mensaje armado y marca al cliente como contactado por 30 días.
- Historial de bici (`helpers/bikeHistory.ts`): `bicycles.history_token`; el taller lo crea o revoca desde la ficha del cliente
  (`/api/bicycles/:id/history-link`) y la página pública `/bici/:token` (`GET /api/public/bikes/:token/history`) muestra los
  servicios entregados y la ficha de ajustes, sin precios ni datos del dueño.

## Comprobante en PDF

- `helpers/workOrderPdf.ts` (pdf-lib, sin binarios: se empaqueta en el bundle) dibuja el comprobante a partir del mismo payload del
  link del cliente: cotización mientras el trabajo está en curso, comprobante de servicio con la bici lista o entregada; logo,
  detalle, descuentos, IVA, estado del pago, datos para transferir, ítems pendientes de aprobación y ajustes de la bici.
- `GET /api/public/ot/:token/pdf` (cliente) y `GET /api/work-orders/:id/pdf` (taller). Botón en el link del cliente, en el menú
  del trabajo y en el diálogo de envío.

## Novedades, catálogo inicial y app instalable

- `GET /api/dashboard/activity` y la tarjeta "Novedades" de Inicio: lo que respondieron los clientes desde su link (adicionales
  aprobados o rechazados, cotización aprobada) de los últimos 14 días; "visto" se guarda en el dispositivo.
- `pnpm --filter @workspace/api-server run load-catalogo seed/catalogo-ridemec.json` (con `CATALOG_ADMIN="email:clave"`) carga servicios,
  pasos y repuestos con precio desde un JSON, sin duplicar lo que ya existe.
- PWA: `public/manifest.webmanifest`, `public/sw.js` (sin caché de datos, solo aviso sin conexión) e iconos; `capture-buttons.tsx`
  abre la cámara del celular para foto o video y `lib/media-upload.ts` sube con progreso y un reintento (videos hasta 100 MB).

## Notas de voz

- El mecánico graba una nota de voz desde la ficha del trabajo (o al crear uno): `voice-recorder.tsx` usa `MediaRecorder` (Safari graba
  mp4/aac; Chrome y Android, webm/opus) y la sube como cualquier foto. El servidor acepta `audio/mp4|webm|ogg|mpeg` (hasta 25 MB) y
  valida la firma del contenedor. El cliente la escucha con reproductor en su link.

## Fotos y videos de la OT

- `work_order_photos` guarda imagen o video (`mime_type`); video MP4/MOV/WebM hasta 60 MB, validado por firma.
  El cliente ve los marcados "visibles" en su link, con reproductor.

## Despliegue

- `Dockerfile` + `railway.json` + `docs/railway.md`; `src/scripts/bootstrap.ts` (esquema/migraciones/rol/superadmin) y
  `WEB_DIST` para servir la web desde la API.

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
