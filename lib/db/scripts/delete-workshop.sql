-- Borra un taller y TODOS sus datos (irreversible). Pensado para talleres de prueba o demo.
-- Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -v workshop=2 -f lib/db/scripts/delete-workshop.sql
-- Las fotos en disco quedan en uploads/taller-<id>/ y se borran a mano.
BEGIN;
SELECT set_config('app.bypass', 'on', true);

DELETE FROM timeline_events WHERE workshop_id = :workshop;
DELETE FROM inventory_movements WHERE workshop_id = :workshop;
DELETE FROM purchase_items WHERE workshop_id = :workshop;
DELETE FROM purchases WHERE workshop_id = :workshop;
DELETE FROM suppliers WHERE workshop_id = :workshop;
DELETE FROM service_supplies WHERE workshop_id = :workshop;
DELETE FROM work_order_photos WHERE workshop_id = :workshop;
DELETE FROM work_order_checklist_items WHERE workshop_id = :workshop;
DELETE FROM work_order_items WHERE workshop_id = :workshop;
DELETE FROM inspection_findings WHERE workshop_id = :workshop;
DELETE FROM reservations WHERE workshop_id = :workshop;
DELETE FROM work_orders WHERE workshop_id = :workshop;
DELETE FROM receptions WHERE workshop_id = :workshop;
DELETE FROM quote_versions WHERE workshop_id = :workshop;
DELETE FROM quote_items WHERE workshop_id = :workshop;
DELETE FROM quotes WHERE workshop_id = :workshop;
DELETE FROM work_cases WHERE workshop_id = :workshop;
DELETE FROM bicycles WHERE workshop_id = :workshop;
DELETE FROM clients WHERE workshop_id = :workshop;
DELETE FROM service_steps WHERE workshop_id = :workshop;
DELETE FROM services WHERE workshop_id = :workshop;
DELETE FROM parts WHERE workshop_id = :workshop;
DELETE FROM categories WHERE workshop_id = :workshop;
DELETE FROM payment_methods WHERE workshop_id = :workshop;
DELETE FROM users WHERE workshop_id = :workshop;
DELETE FROM workshop_settings WHERE workshop_id = :workshop;
DELETE FROM document_counters WHERE workshop_id = :workshop;
DELETE FROM workshops WHERE id = :workshop;

COMMIT;
