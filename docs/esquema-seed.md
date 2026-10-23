# Datos de prueba (seed): qué se necesita

Hay dos niveles. **Para generar datos usa el formato simple (sección 1)**: el script de seed
deriva todo lo interno (presupuesto, recepción, OT, checklist, historial, numeración) con las mismas
reglas que la app, así los datos quedan coherentes. La sección 2 es la referencia completa de la base.

---

## 1. Formato simple (lo que hay que entregar)

Un JSON con cinco listas. Las fechas son relativas a "hoy" (días negativos = pasado), así el seed
sirve cualquier día y siempre hay trabajos atrasados, para hoy, etc.

```jsonc
{
  "taller": {
    "nombre": "Bicicletería Los Andes",
    "telefono": "+56 9 5555 1234",
    "direccion": "Av. Providencia 1234, Santiago",
    "horario": { "1": ["10:00", "19:00"], "2": ["10:00", "19:00"], "3": ["10:00", "19:00"],
                 "4": ["10:00", "19:00"], "5": ["10:00", "19:00"], "6": ["10:00", "14:00"] },
    "colacion": ["14:00", "15:00"]                      // o null
  },

  "usuarios": [
    { "nombre": "Ana Pérez",   "email": "ana@taller.cl",   "rol": "admin" },
    { "nombre": "Juan Soto",   "email": "juan@taller.cl",  "rol": "mechanic", "horasSemanales": 44 },
    { "nombre": "Diego Muñoz", "email": "diego@taller.cl", "rol": "mechanic", "horasSemanales": 30 },
    { "nombre": "Carla Rojas", "email": "carla@taller.cl", "rol": "reception" }
  ],

  "catalogo": {
    "categorias": ["Suspensión", "Frenos", "Transmisión", "Ruedas", "Mantención general"],
    "servicios": [
      { "nombre": "Mantención general", "categoria": "Mantención general", "precio": 45000, "horas": 2,
        "pasos": ["Lavado", "Revisión de frenos", "Ajuste de cambios", "Lubricación de cadena", "Prueba en ruta"] }
    ],
    "repuestos": [
      { "nombre": "Cadena Shimano SLX 12v", "categoria": "Transmisión", "marca": "Shimano", "precio": 32000, "sku": "SHI-CN-M7100" }
    ],
    "metodosPago": ["Efectivo", "Transferencia", "Débito", "Crédito"]
  },

  "clientes": [
    { "nombre": "Camila Fuentes", "telefono": "+56 9 8765 4321", "email": "camila@mail.cl",
      "bicis": [ { "marca": "Trek", "modelo": "Marlin 7", "tipo": "mtb", "anio": 2022, "color": "Azul", "aro": "29" } ] }
  ],

  "trabajos": [
    {
      "cliente": "Camila Fuentes", "bici": "Trek Marlin 7",
      "ingresoHaceDias": 3,                     // cuándo llegó
      "estado": "in_progress",                  // ver tabla de estados abajo
      "mecanico": "juan@taller.cl",             // o null
      "problema": "Frena mal adelante y los cambios saltan",
      "items": [
        { "servicio": "Mantención general" },                         // precio/horas/pasos del catálogo
        { "repuesto": "Cadena Shimano SLX 12v", "cantidad": 1 },
        { "otro": "Enderezar disco delantero", "precio": 8000, "horas": 0.5 }
      ],
      "adicionales": [                          // opcional: aparecen durante el trabajo
        { "repuesto": "Pastillas freno Shimano", "precio": 9500, "decision": "pending" }   // pending | approved | rejected
      ],
      "avance": 0.6,                            // fracción del checklist hecha (solo en reparación)
      "terminadoHaceDias": null,                // para lista para retiro / entregada
      "entregadoHaceDias": null,
      "pago": null,                             // o { "metodo": "Débito", "monto": 53000, "haceDias": 0 }
      "comentarios": [ { "texto": "Disco doblado, se endereza", "visibleCliente": true } ]
    }
  ],
  "reservas": [                                 // opcional: bicis que van a llegar (no consumen número de OT)
    { "cliente": "Matías Herrera", "bici": "Trek Marlin 7", "enDias": 1, "hora": "18:00",   // hora puede ser null
      "items": [ { "servicio": "Mantención general" }, { "otro": "Cadena que trae el cliente", "precio": 0 } ],
      "nota": "La deja saliendo del trabajo" }      // cliente nuevo: agregar también "telefono"
  ]
}
```

El demo debe mantenerse chico: como máximo 8 trabajos abiertos (en distintos estados), 6 reservas pendientes, 2 mecánicos y 6 clientes en "A quién escribirle".

### Estados de un trabajo y qué datos deben acompañarlo

| `estado` | Significa | Debe traer |
|---|---|---|
| `ready_to_work` | Recibida, sin empezar | ingreso; mecánico opcional |
| `in_progress` | En reparación | mecánico (obligatorio); `avance` 0–1 |
| `quality_control` | Control de calidad | mecánico; checklist casi completo |
| `ready_for_pickup` | Lista para retiro | mecánico; `terminadoHaceDias` |
| `delivered` | Entregada | `terminadoHaceDias` ≥ `entregadoHaceDias`; normalmente `pago` |
| `cancelled` | Cancelada | motivo en un comentario |

Reglas que el seed respeta (y conviene que los datos no contradigan):

- Orden de fechas: ingreso ≤ inicio ≤ terminada ≤ entregada. El pago puede ser antes (abono) o después.
- Un adicional `pending` solo tiene sentido en trabajos abiertos (no entregados ni cancelados).
- El término estimado **no se entrega**: el seed lo calcula como lo haría la app al crear el trabajo.
  Para tener atrasados, basta con trabajos abiertos de hace varios días con muchas horas.
- Los totales tampoco: salen de los ítems aprobados (descuentos restan).

### Mezcla sugerida para probar todo

- 3 mecánicos con horas distintas, 1 admin, 1 recepción.
- 5–6 categorías, 12–15 servicios (3–6 pasos cada uno), 25–30 repuestos.
- 40 clientes (algunos con 2 bicis, algunos sin email, 2–3 sin teléfono).
- ~80 trabajos en los últimos 90 días:
  - 55 % entregados (la mayoría pagados, algunos con saldo);
  - 10 % listos para retiro (2 o 3 hace más de 3 días);
  - 15 % en reparación o control;
  - 10 % recibidos (2 o 3 sin mecánico);
  - 5 % con adicionales esperando al cliente;
  - 5 % cancelados.
- Algunos clientes que vuelven (2–4 trabajos en el período) para ver historial.

---

## 2. Referencia: tablas de la base

Orden de inserción (por las llaves foráneas). `id`, `active`, `created_at` y `updated_at` existen en
casi todas y se omiten salvo que importen. Montos en CLP con IVA incluido; `numeric` se guarda como texto.

### Catálogo y equipo

| Tabla | Campos | Notas |
|---|---|---|
| `workshop_settings` | name, phone, address, schedule `jsonb [{day,open,close}]`, lunch_start, lunch_end, workdays | Una fila, `id = 1`. day: 0 = domingo … 6 = sábado |
| `users` | name, email (único), password_hash (bcrypt), role `admin\|mechanic\|reception`, weekly_hours, calendar_color | |
| `payment_methods` | name, notes | |
| `categories` | name, description | |
| `services` | name, category_id → categories, base_price, estimated_hours, client_description, internal_description | |
| `service_steps` | service_id → services, description, order, notes | Pasos que se copian al checklist de la OT |
| `parts` | name, category_id → categories, brand, suggested_price, sku | |

### Clientes

| Tabla | Campos | Notas |
|---|---|---|
| `clients` | name, phone, email, notes | |
| `bicycles` | client_id → clients, brand, model, year, type `mtb\|road\|gravel\|urban\|ebike\|kids\|other`, color, rim_size, serial_number, notes | |

### Un trabajo (por cada uno se crean estas filas)

| Tabla | Campos | Notas |
|---|---|---|
| `work_cases` (TR) | work_case_number `TR-0001`, client_id, bicycle_id, status, origin_channel, initial_requirement, assigned_mechanic_id, total_estimated_amount, total_estimated_labor_hours, progress_percentage | status lo recalcula la app desde la OT |
| `quotes` (P) | quote_number `P-0001`, client_id, bicycle_id, work_case_id, origin_channel, status (`converted_to_work_order` si tiene OT), subtotal, discount_total, total, estimated_labor_hours, approved_at, work_order_id | Interno: ya no se muestra |
| `quote_items` | quote_id, item_type `service\|part\|additional_labor\|diagnosis\|recommendation\|discount\|other`, origin `customer_request\|mechanic_recommendation\|visual_inspection\|during_work\|warranty_correction\|manual`, description, quantity, unit_price, total, estimated_labor_hours, approval_status `pending\|approved\|rejected`, service_id, part_id, sort_order | |
| `receptions` (R) | reception_number `R-0001`, client_id, bicycle_id, quote_id, work_case_id, work_order_id, received_by_user_id, received_at, customer_reported_problem, initial_visual_condition, accessories_received `jsonb string[]`, status | Interno |
| `work_orders` (OT) | work_order_number `OT-0001`, quote_id, reception_id, work_case_id, client_id, bicycle_id, mechanic_id, status, priority, internal_notes, customer_notes, estimated_delivery_date, started_at, completed_at, delivered_at, paid_at, payment_method_id, paid_amount, total, estimated_labor_hours, progress_percentage, public_token | Lo que ve el taller y el cliente |
| `work_order_items` | work_order_id, quote_item_id, item_type, description, quantity, unit_price, total, estimated_labor_hours, status `pending\|in_progress\|completed\|cancelled`, approval_status, origin `initial\|additional`, approval_decided_at, approval_decided_by `client\|staff`, sort_order | Total de la OT = aprobados no cancelados |
| `work_order_checklist_items` | work_order_id, work_order_item_id, service_step_id, description, sort_order, status `pending\|in_progress\|completed\|not_applicable\|with_observation`, completed_by_user_id, completed_at, mechanic_note | Un paso por cada `service_steps` de los servicios |
| `timeline_events` | entity_type `work_order\|work_case`, entity_id, user_id, action, previous_status, new_status, comment, visible_to_client, created_at | Historial. Acciones: `work_order_created`, `status_changed`, `item_decision`, `additional_item_added`, `payment_registered`, `comment_*`… |

Tablas que el seed no toca: `inspection_findings`, `quote_versions` (flujos antiguos), `session`.
Numeración: secuencias `work_case_number_seq`, `quote_number_seq`, `reception_number_seq`,
`work_order_number_seq`; después de insertar con números propios hay que hacer `setval` al máximo.
