-- Esquema completo de TallerBicis para una base NUEVA (tablas, funciones, Row Level Security).
-- Generado con pg_dump --schema-only desde una base con todas las migraciones aplicadas.
-- Uso: psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 -f lib/db/schema.sql  (luego ver lib/db/scripts/grant-app-role.sql)
-- Para bases que ya existen, aplicar en cambio las migraciones de lib/db/migrations/ en orden.
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Debian 16.15-1.pgdg13+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: bicycle_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bicycle_type AS ENUM (
    'mtb',
    'road',
    'gravel',
    'urban',
    'ebike',
    'kids',
    'other'
);


--
-- Name: checklist_item_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.checklist_item_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'not_applicable',
    'with_observation'
);


--
-- Name: finding_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.finding_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: quote_item_approval; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quote_item_approval AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: quote_item_origin; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quote_item_origin AS ENUM (
    'customer_request',
    'mechanic_recommendation',
    'visual_inspection',
    'during_work',
    'warranty_correction',
    'manual'
);


--
-- Name: quote_item_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quote_item_type AS ENUM (
    'service',
    'part',
    'additional_labor',
    'diagnosis',
    'recommendation',
    'discount',
    'other'
);


--
-- Name: quote_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.quote_status AS ENUM (
    'draft',
    'sent',
    'partially_approved',
    'approved',
    'rejected',
    'updated_after_sent',
    'ready_for_work_order',
    'converted_to_work_order'
);


--
-- Name: reception_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reception_status AS ENUM (
    'received',
    'in_inspection',
    'inspection_completed',
    'waiting_quote_approval',
    'ready_for_work_order',
    'cancelled'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'mechanic',
    'reception',
    'superadmin'
);


--
-- Name: work_case_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_case_status AS ENUM (
    'lead',
    'quoted',
    'quote_sent',
    'quote_approved',
    'bike_received',
    'in_inspection',
    'ready_for_work_order',
    'in_work_order',
    'in_progress',
    'quality_control',
    'ready_for_pickup',
    'delivered',
    'cancelled',
    'closed'
);


--
-- Name: work_order_item_approval; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_order_item_approval AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: work_order_item_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_order_item_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'cancelled'
);


--
-- Name: work_order_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_order_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);


--
-- Name: work_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.work_order_status AS ENUM (
    'ready_to_work',
    'in_progress',
    'quality_control',
    'ready_for_pickup',
    'delivered',
    'cancelled'
);


--
-- Name: app_bypass(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_bypass() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(current_setting('app.bypass', true), '') = 'on' $$;


--
-- Name: current_workshop_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_workshop_id() RETURNS integer
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('app.workshop_id', true), '')::integer $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bicycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bicycles (
    id integer NOT NULL,
    client_id integer NOT NULL,
    brand text NOT NULL,
    model text NOT NULL,
    type public.bicycle_type DEFAULT 'mtb'::public.bicycle_type NOT NULL,
    color text,
    rim_size text,
    serial_number text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    year integer,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    setup_notes text,
    setup_updated_at timestamp without time zone,
    history_token text
);

ALTER TABLE ONLY public.bicycles FORCE ROW LEVEL SECURITY;


--
-- Name: bicycles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bicycles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bicycles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bicycles_id_seq OWNED BY public.bicycles.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.categories FORCE ROW LEVEL SECURITY;


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id integer NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.clients FORCE ROW LEVEL SECURITY;


--
-- Name: clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clients_id_seq OWNED BY public.clients.id;


--
-- Name: document_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_counters (
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    kind text NOT NULL,
    last_value integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.document_counters FORCE ROW LEVEL SECURITY;


--
-- Name: followup_snoozes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.followup_snoozes (
    id integer NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    client_id integer NOT NULL,
    until_on date NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.followup_snoozes FORCE ROW LEVEL SECURITY;


--
-- Name: followup_snoozes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.followup_snoozes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: followup_snoozes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.followup_snoozes_id_seq OWNED BY public.followup_snoozes.id;


--
-- Name: inspection_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_findings (
    id integer NOT NULL,
    reception_id integer NOT NULL,
    quote_id integer,
    mechanic_id integer,
    area text NOT NULL,
    severity public.finding_severity DEFAULT 'low'::public.finding_severity NOT NULL,
    finding text NOT NULL,
    recommendation text,
    should_create_quote_item boolean DEFAULT false NOT NULL,
    created_quote_item_id integer,
    item_type text,
    service_id integer,
    part_id integer,
    quote_item_description text,
    quantity numeric(10,3),
    unit_price numeric(12,2),
    estimated_labor_hours numeric(8,2),
    internal_notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.inspection_findings FORCE ROW LEVEL SECURITY;


--
-- Name: inspection_findings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inspection_findings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inspection_findings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inspection_findings_id_seq OWNED BY public.inspection_findings.id;


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id integer NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    part_id integer NOT NULL,
    kind text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    unit_cost numeric(12,2),
    work_order_id integer,
    purchase_id integer,
    automatic boolean DEFAULT false NOT NULL,
    note text,
    user_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    work_order_item_id integer
);

ALTER TABLE ONLY public.inventory_movements FORCE ROW LEVEL SECURITY;


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_movements_id_seq OWNED BY public.inventory_movements.id;


--
-- Name: parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts (
    id integer NOT NULL,
    name text NOT NULL,
    category_id integer,
    brand text,
    suggested_price numeric(10,2),
    sku text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    kind text DEFAULT 'part'::text NOT NULL,
    unit text DEFAULT 'un'::text NOT NULL,
    cost_price numeric(12,2),
    stock numeric(12,3) DEFAULT 0 NOT NULL,
    min_stock numeric(12,3),
    CONSTRAINT parts_kind_check CHECK ((kind = ANY (ARRAY['part'::text, 'supply'::text])))
);

ALTER TABLE ONLY public.parts FORCE ROW LEVEL SECURITY;


--
-- Name: parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parts_id_seq OWNED BY public.parts.id;


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_methods (
    id integer NOT NULL,
    name text NOT NULL,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.payment_methods FORCE ROW LEVEL SECURITY;


--
-- Name: payment_methods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_methods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_methods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_methods_id_seq OWNED BY public.payment_methods.id;


--
-- Name: purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_items (
    id integer NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    purchase_id integer NOT NULL,
    part_id integer,
    description text NOT NULL,
    supplier_code text,
    quantity numeric(12,3) DEFAULT 1 NOT NULL,
    unit text,
    unit_cost_net numeric(12,2) DEFAULT 0 NOT NULL,
    work_order_id integer,
    sale_price numeric(12,2),
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.purchase_items FORCE ROW LEVEL SECURITY;


--
-- Name: purchase_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_items_id_seq OWNED BY public.purchase_items.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id integer NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    supplier_id integer,
    doc_type text DEFAULT 'factura'::text NOT NULL,
    doc_number text,
    issued_on date,
    net_total numeric(12,2),
    tax_total numeric(12,2),
    total numeric(12,2),
    status text DEFAULT 'draft'::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    file_key text,
    file_mime text,
    notes text,
    created_by_user_id integer,
    confirmed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.purchases FORCE ROW LEVEL SECURITY;


--
-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchases_id_seq OWNED BY public.purchases.id;


--
-- Name: quote_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_items (
    id integer NOT NULL,
    quote_id integer NOT NULL,
    item_type public.quote_item_type NOT NULL,
    origin public.quote_item_origin DEFAULT 'manual'::public.quote_item_origin NOT NULL,
    description text NOT NULL,
    quantity numeric(10,3) DEFAULT '1'::numeric NOT NULL,
    unit_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    estimated_labor_hours numeric(8,2),
    approval_status public.quote_item_approval DEFAULT 'pending'::public.quote_item_approval NOT NULL,
    service_id integer,
    part_id integer,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.quote_items FORCE ROW LEVEL SECURITY;


--
-- Name: quote_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quote_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quote_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quote_items_id_seq OWNED BY public.quote_items.id;


--
-- Name: quote_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_versions (
    id integer NOT NULL,
    quote_id integer NOT NULL,
    version_number integer NOT NULL,
    status text NOT NULL,
    subtotal numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    discount_total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    estimated_labor_hours numeric(8,2) DEFAULT '0'::numeric NOT NULL,
    items_snapshot jsonb,
    customer_notes_snapshot text,
    internal_notes_snapshot text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    sent_at timestamp without time zone,
    approved_at timestamp without time zone,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.quote_versions FORCE ROW LEVEL SECURITY;


--
-- Name: quote_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quote_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quote_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quote_versions_id_seq OWNED BY public.quote_versions.id;


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotes (
    id integer NOT NULL,
    quote_number text NOT NULL,
    client_id integer NOT NULL,
    bicycle_id integer,
    origin_channel text NOT NULL,
    initial_requirement text,
    status public.quote_status DEFAULT 'draft'::public.quote_status NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    customer_notes text,
    internal_notes text,
    subtotal numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    discount_total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    estimated_labor_hours numeric(8,2) DEFAULT '0'::numeric NOT NULL,
    sent_at timestamp without time zone,
    approved_at timestamp without time zone,
    rejected_at timestamp without time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    work_order_id integer,
    work_case_id integer,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.quotes FORCE ROW LEVEL SECURITY;


--
-- Name: quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quotes_id_seq OWNED BY public.quotes.id;


--
-- Name: receptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receptions (
    id integer NOT NULL,
    reception_number text NOT NULL,
    client_id integer NOT NULL,
    bicycle_id integer NOT NULL,
    quote_id integer,
    received_by_user_id integer,
    received_at timestamp without time zone DEFAULT now() NOT NULL,
    customer_reported_problem text,
    initial_visual_condition text,
    accessories_received jsonb,
    internal_notes text,
    customer_notes text,
    status public.reception_status DEFAULT 'received'::public.reception_status NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    work_order_id integer,
    work_case_id integer,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.receptions FORCE ROW LEVEL SECURITY;


--
-- Name: receptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.receptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: receptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.receptions_id_seq OWNED BY public.receptions.id;


--
-- Name: reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservations (
    id integer NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    client_id integer,
    client_name text NOT NULL,
    client_phone text,
    bicycle_text text,
    note text,
    service_id integer,
    estimated_hours numeric(6,2),
    expected_on date NOT NULL,
    expected_time text,
    status text DEFAULT 'reserved'::text NOT NULL,
    work_case_id integer,
    work_order_id integer,
    created_by_user_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT reservations_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'arrived'::text, 'cancelled'::text, 'no_show'::text])))
);

ALTER TABLE ONLY public.reservations FORCE ROW LEVEL SECURITY;


--
-- Name: reservations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reservations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reservations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reservations_id_seq OWNED BY public.reservations.id;


--
-- Name: service_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_steps (
    id integer NOT NULL,
    service_id integer NOT NULL,
    description text NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.service_steps FORCE ROW LEVEL SECURITY;


--
-- Name: service_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_steps_id_seq OWNED BY public.service_steps.id;


--
-- Name: service_supplies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_supplies (
    id integer NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    service_id integer NOT NULL,
    part_id integer NOT NULL,
    quantity numeric(12,3) NOT NULL
);

ALTER TABLE ONLY public.service_supplies FORCE ROW LEVEL SECURITY;


--
-- Name: service_supplies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_supplies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_supplies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_supplies_id_seq OWNED BY public.service_supplies.id;


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id integer NOT NULL,
    name text NOT NULL,
    category_id integer,
    base_price numeric(10,2),
    estimated_hours numeric(5,2),
    client_description text,
    internal_description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    followup_months integer,
    CONSTRAINT services_followup_months_check CHECK (((followup_months IS NULL) OR ((followup_months >= 0) AND (followup_months <= 60))))
);

ALTER TABLE ONLY public.services FORCE ROW LEVEL SECURITY;


--
-- Name: services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.services_id_seq OWNED BY public.services.id;


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id integer NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    name text NOT NULL,
    rut text,
    phone text,
    email text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.suppliers FORCE ROW LEVEL SECURITY;


--
-- Name: suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suppliers_id_seq OWNED BY public.suppliers.id;


--
-- Name: timeline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timeline_events (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    user_id integer,
    action text NOT NULL,
    previous_status text,
    new_status text,
    comment text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    visible_to_client boolean DEFAULT false NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.timeline_events FORCE ROW LEVEL SECURITY;


--
-- Name: timeline_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.timeline_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: timeline_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.timeline_events_id_seq OWNED BY public.timeline_events.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role public.user_role DEFAULT 'mechanic'::public.user_role NOT NULL,
    weekly_hours integer,
    calendar_color text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id(),
    does_jobs boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: work_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_cases (
    id integer NOT NULL,
    work_case_number text NOT NULL,
    client_id integer NOT NULL,
    bicycle_id integer,
    status public.work_case_status DEFAULT 'lead'::public.work_case_status NOT NULL,
    origin_channel text,
    initial_requirement text,
    assigned_mechanic_id integer,
    total_estimated_amount numeric(12,2),
    total_estimated_labor_hours numeric(8,2),
    progress_percentage numeric(5,2),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.work_cases FORCE ROW LEVEL SECURITY;


--
-- Name: work_cases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_cases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_cases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_cases_id_seq OWNED BY public.work_cases.id;


--
-- Name: work_order_checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_order_checklist_items (
    id integer NOT NULL,
    work_order_id integer NOT NULL,
    work_order_item_id integer,
    service_step_id integer,
    description text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status public.checklist_item_status DEFAULT 'pending'::public.checklist_item_status NOT NULL,
    completed_by_user_id integer,
    completed_at timestamp without time zone,
    mechanic_note text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.work_order_checklist_items FORCE ROW LEVEL SECURITY;


--
-- Name: work_order_checklist_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_order_checklist_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_order_checklist_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_order_checklist_items_id_seq OWNED BY public.work_order_checklist_items.id;


--
-- Name: work_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_order_items (
    id integer NOT NULL,
    work_order_id integer NOT NULL,
    quote_item_id integer,
    item_type text NOT NULL,
    description text NOT NULL,
    quantity numeric(10,3) DEFAULT '1'::numeric NOT NULL,
    unit_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    estimated_labor_hours numeric(8,2),
    status public.work_order_item_status DEFAULT 'pending'::public.work_order_item_status NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    approval_status public.work_order_item_approval DEFAULT 'approved'::public.work_order_item_approval NOT NULL,
    origin text DEFAULT 'initial'::text NOT NULL,
    approval_decided_at timestamp without time zone,
    approval_decided_by text,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    part_id integer,
    unit_cost numeric(12,2),
    stock_consumed boolean DEFAULT false NOT NULL,
    service_id integer
);

ALTER TABLE ONLY public.work_order_items FORCE ROW LEVEL SECURITY;


--
-- Name: work_order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_order_items_id_seq OWNED BY public.work_order_items.id;


--
-- Name: work_order_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_order_photos (
    id integer NOT NULL,
    work_order_id integer NOT NULL,
    storage_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    note text,
    visible_to_client boolean DEFAULT true NOT NULL,
    uploaded_by_user_id integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL
);

ALTER TABLE ONLY public.work_order_photos FORCE ROW LEVEL SECURITY;


--
-- Name: work_order_photos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_order_photos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_order_photos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_order_photos_id_seq OWNED BY public.work_order_photos.id;


--
-- Name: work_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_orders (
    id integer NOT NULL,
    work_order_number text NOT NULL,
    quote_id integer,
    reception_id integer,
    client_id integer NOT NULL,
    bicycle_id integer NOT NULL,
    mechanic_id integer,
    status public.work_order_status DEFAULT 'ready_to_work'::public.work_order_status NOT NULL,
    priority public.work_order_priority DEFAULT 'normal'::public.work_order_priority NOT NULL,
    internal_notes text,
    customer_notes text,
    estimated_delivery_date timestamp without time zone,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    delivered_at timestamp without time zone,
    total numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    estimated_labor_hours numeric(8,2) DEFAULT '0'::numeric NOT NULL,
    progress_percentage numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    work_case_id integer,
    public_token text,
    paid_at timestamp without time zone,
    payment_method_id integer,
    paid_amount numeric(12,2),
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    stock_consumed_at timestamp without time zone,
    quote_approved_at timestamp without time zone,
    quote_approved_by text
);

ALTER TABLE ONLY public.work_orders FORCE ROW LEVEL SECURITY;


--
-- Name: work_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_orders_id_seq OWNED BY public.work_orders.id;


--
-- Name: workshop_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workshop_settings (
    name text,
    phone text,
    address text,
    workdays text DEFAULT '1,2,3,4,5'::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    schedule jsonb,
    lunch_start text,
    lunch_end text,
    workshop_id integer DEFAULT public.current_workshop_id() NOT NULL,
    monthly_fixed_costs numeric(12,2),
    monthly_salary numeric(12,2),
    monthly_work_hours numeric(6,1),
    labor_cost_per_hour numeric(12,2),
    default_parts_margin_pct numeric(5,1) DEFAULT 30 NOT NULL,
    logo_key text,
    recovers_vat boolean DEFAULT false NOT NULL,
    payment_info text
);

ALTER TABLE ONLY public.workshop_settings FORCE ROW LEVEL SECURITY;


--
-- Name: workshops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workshops (
    id integer NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workshops FORCE ROW LEVEL SECURITY;


--
-- Name: workshops_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workshops_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workshops_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workshops_id_seq OWNED BY public.workshops.id;


--
-- Name: bicycles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bicycles ALTER COLUMN id SET DEFAULT nextval('public.bicycles_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients ALTER COLUMN id SET DEFAULT nextval('public.clients_id_seq'::regclass);


--
-- Name: followup_snoozes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_snoozes ALTER COLUMN id SET DEFAULT nextval('public.followup_snoozes_id_seq'::regclass);


--
-- Name: inspection_findings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings ALTER COLUMN id SET DEFAULT nextval('public.inspection_findings_id_seq'::regclass);


--
-- Name: inventory_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements ALTER COLUMN id SET DEFAULT nextval('public.inventory_movements_id_seq'::regclass);


--
-- Name: parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts ALTER COLUMN id SET DEFAULT nextval('public.parts_id_seq'::regclass);


--
-- Name: payment_methods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods ALTER COLUMN id SET DEFAULT nextval('public.payment_methods_id_seq'::regclass);


--
-- Name: purchase_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items ALTER COLUMN id SET DEFAULT nextval('public.purchase_items_id_seq'::regclass);


--
-- Name: purchases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases ALTER COLUMN id SET DEFAULT nextval('public.purchases_id_seq'::regclass);


--
-- Name: quote_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items ALTER COLUMN id SET DEFAULT nextval('public.quote_items_id_seq'::regclass);


--
-- Name: quote_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_versions ALTER COLUMN id SET DEFAULT nextval('public.quote_versions_id_seq'::regclass);


--
-- Name: quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes ALTER COLUMN id SET DEFAULT nextval('public.quotes_id_seq'::regclass);


--
-- Name: receptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptions ALTER COLUMN id SET DEFAULT nextval('public.receptions_id_seq'::regclass);


--
-- Name: reservations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations ALTER COLUMN id SET DEFAULT nextval('public.reservations_id_seq'::regclass);


--
-- Name: service_steps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_steps ALTER COLUMN id SET DEFAULT nextval('public.service_steps_id_seq'::regclass);


--
-- Name: service_supplies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_supplies ALTER COLUMN id SET DEFAULT nextval('public.service_supplies_id_seq'::regclass);


--
-- Name: services id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services ALTER COLUMN id SET DEFAULT nextval('public.services_id_seq'::regclass);


--
-- Name: suppliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers ALTER COLUMN id SET DEFAULT nextval('public.suppliers_id_seq'::regclass);


--
-- Name: timeline_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timeline_events ALTER COLUMN id SET DEFAULT nextval('public.timeline_events_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: work_cases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cases ALTER COLUMN id SET DEFAULT nextval('public.work_cases_id_seq'::regclass);


--
-- Name: work_order_checklist_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_checklist_items ALTER COLUMN id SET DEFAULT nextval('public.work_order_checklist_items_id_seq'::regclass);


--
-- Name: work_order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_items ALTER COLUMN id SET DEFAULT nextval('public.work_order_items_id_seq'::regclass);


--
-- Name: work_order_photos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos ALTER COLUMN id SET DEFAULT nextval('public.work_order_photos_id_seq'::regclass);


--
-- Name: work_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders ALTER COLUMN id SET DEFAULT nextval('public.work_orders_id_seq'::regclass);


--
-- Name: workshops id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workshops ALTER COLUMN id SET DEFAULT nextval('public.workshops_id_seq'::regclass);


--
-- Name: bicycles bicycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bicycles
    ADD CONSTRAINT bicycles_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: document_counters document_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_counters
    ADD CONSTRAINT document_counters_pkey PRIMARY KEY (workshop_id, kind);


--
-- Name: followup_snoozes followup_snoozes_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_snoozes
    ADD CONSTRAINT followup_snoozes_client_id_key UNIQUE (client_id);


--
-- Name: followup_snoozes followup_snoozes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_snoozes
    ADD CONSTRAINT followup_snoozes_pkey PRIMARY KEY (id);


--
-- Name: inspection_findings inspection_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: purchase_items purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: quote_items quote_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_pkey PRIMARY KEY (id);


--
-- Name: quote_versions quote_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_versions
    ADD CONSTRAINT quote_versions_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: receptions receptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_pkey PRIMARY KEY (id);


--
-- Name: reservations reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_pkey PRIMARY KEY (id);


--
-- Name: service_steps service_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_steps
    ADD CONSTRAINT service_steps_pkey PRIMARY KEY (id);


--
-- Name: service_supplies service_supplies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_supplies
    ADD CONSTRAINT service_supplies_pkey PRIMARY KEY (id);


--
-- Name: service_supplies service_supplies_service_id_part_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_supplies
    ADD CONSTRAINT service_supplies_service_id_part_id_key UNIQUE (service_id, part_id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: timeline_events timeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: work_cases work_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cases
    ADD CONSTRAINT work_cases_pkey PRIMARY KEY (id);


--
-- Name: work_order_checklist_items work_order_checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_checklist_items
    ADD CONSTRAINT work_order_checklist_items_pkey PRIMARY KEY (id);


--
-- Name: work_order_items work_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_items
    ADD CONSTRAINT work_order_items_pkey PRIMARY KEY (id);


--
-- Name: work_order_photos work_order_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_pkey PRIMARY KEY (id);


--
-- Name: work_order_photos work_order_photos_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_storage_key_key UNIQUE (storage_key);


--
-- Name: work_orders work_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_pkey PRIMARY KEY (id);


--
-- Name: work_orders work_orders_public_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_public_token_unique UNIQUE (public_token);


--
-- Name: workshop_settings workshop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workshop_settings
    ADD CONSTRAINT workshop_settings_pkey PRIMARY KEY (workshop_id);


--
-- Name: workshops workshops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workshops
    ADD CONSTRAINT workshops_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: bicycles_history_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bicycles_history_token_unique ON public.bicycles USING btree (history_token) WHERE (history_token IS NOT NULL);


--
-- Name: bicycles_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bicycles_workshop_idx ON public.bicycles USING btree (workshop_id);


--
-- Name: categories_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX categories_workshop_idx ON public.categories USING btree (workshop_id);


--
-- Name: clients_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_workshop_idx ON public.clients USING btree (workshop_id);


--
-- Name: followup_snoozes_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX followup_snoozes_workshop_idx ON public.followup_snoozes USING btree (workshop_id);


--
-- Name: inspection_findings_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inspection_findings_workshop_idx ON public.inspection_findings USING btree (workshop_id);


--
-- Name: inventory_movements_part_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_movements_part_idx ON public.inventory_movements USING btree (part_id);


--
-- Name: inventory_movements_wo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_movements_wo_idx ON public.inventory_movements USING btree (work_order_id) WHERE (work_order_id IS NOT NULL);


--
-- Name: inventory_movements_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_movements_workshop_idx ON public.inventory_movements USING btree (workshop_id);


--
-- Name: parts_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parts_workshop_idx ON public.parts USING btree (workshop_id);


--
-- Name: payment_methods_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_methods_workshop_idx ON public.payment_methods USING btree (workshop_id);


--
-- Name: purchase_items_purchase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_items_purchase_idx ON public.purchase_items USING btree (purchase_id);


--
-- Name: purchase_items_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_items_workshop_idx ON public.purchase_items USING btree (workshop_id);


--
-- Name: purchases_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_workshop_idx ON public.purchases USING btree (workshop_id);


--
-- Name: quote_items_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_items_workshop_idx ON public.quote_items USING btree (workshop_id);


--
-- Name: quote_versions_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quote_versions_workshop_idx ON public.quote_versions USING btree (workshop_id);


--
-- Name: quotes_number_per_workshop; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotes_number_per_workshop ON public.quotes USING btree (workshop_id, quote_number);


--
-- Name: quotes_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotes_workshop_idx ON public.quotes USING btree (workshop_id);


--
-- Name: receptions_number_per_workshop; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX receptions_number_per_workshop ON public.receptions USING btree (workshop_id, reception_number);


--
-- Name: receptions_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX receptions_workshop_idx ON public.receptions USING btree (workshop_id);


--
-- Name: reservations_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservations_open_idx ON public.reservations USING btree (expected_on) WHERE (status = 'reserved'::text);


--
-- Name: reservations_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservations_workshop_idx ON public.reservations USING btree (workshop_id);


--
-- Name: service_steps_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_steps_workshop_idx ON public.service_steps USING btree (workshop_id);


--
-- Name: service_supplies_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_supplies_workshop_idx ON public.service_supplies USING btree (workshop_id);


--
-- Name: services_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_workshop_idx ON public.services USING btree (workshop_id);


--
-- Name: suppliers_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppliers_workshop_idx ON public.suppliers USING btree (workshop_id);


--
-- Name: timeline_events_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX timeline_events_workshop_idx ON public.timeline_events USING btree (workshop_id);


--
-- Name: users_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_workshop_idx ON public.users USING btree (workshop_id);


--
-- Name: work_cases_number_per_workshop; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX work_cases_number_per_workshop ON public.work_cases USING btree (workshop_id, work_case_number);


--
-- Name: work_cases_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_cases_workshop_idx ON public.work_cases USING btree (workshop_id);


--
-- Name: work_order_checklist_items_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_order_checklist_items_workshop_idx ON public.work_order_checklist_items USING btree (workshop_id);


--
-- Name: work_order_items_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_order_items_workshop_idx ON public.work_order_items USING btree (workshop_id);


--
-- Name: work_order_photos_wo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_order_photos_wo_idx ON public.work_order_photos USING btree (work_order_id) WHERE active;


--
-- Name: work_order_photos_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_order_photos_workshop_idx ON public.work_order_photos USING btree (workshop_id);


--
-- Name: work_orders_active_quote_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX work_orders_active_quote_unique ON public.work_orders USING btree (quote_id) WHERE (active AND (quote_id IS NOT NULL));


--
-- Name: work_orders_number_per_workshop; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX work_orders_number_per_workshop ON public.work_orders USING btree (workshop_id, work_order_number);


--
-- Name: work_orders_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_orders_workshop_idx ON public.work_orders USING btree (workshop_id);


--
-- Name: workshop_settings_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workshop_settings_workshop_idx ON public.workshop_settings USING btree (workshop_id);


--
-- Name: bicycles bicycles_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bicycles
    ADD CONSTRAINT bicycles_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: bicycles bicycles_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bicycles
    ADD CONSTRAINT bicycles_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: categories categories_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: clients clients_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: document_counters document_counters_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_counters
    ADD CONSTRAINT document_counters_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: followup_snoozes followup_snoozes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_snoozes
    ADD CONSTRAINT followup_snoozes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: followup_snoozes followup_snoozes_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followup_snoozes
    ADD CONSTRAINT followup_snoozes_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: inspection_findings inspection_findings_created_quote_item_id_quote_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_created_quote_item_id_quote_items_id_fk FOREIGN KEY (created_quote_item_id) REFERENCES public.quote_items(id);


--
-- Name: inspection_findings inspection_findings_mechanic_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_mechanic_id_users_id_fk FOREIGN KEY (mechanic_id) REFERENCES public.users(id);


--
-- Name: inspection_findings inspection_findings_part_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: inspection_findings inspection_findings_quote_id_quotes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_quote_id_quotes_id_fk FOREIGN KEY (quote_id) REFERENCES public.quotes(id);


--
-- Name: inspection_findings inspection_findings_reception_id_receptions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_reception_id_receptions_id_fk FOREIGN KEY (reception_id) REFERENCES public.receptions(id);


--
-- Name: inspection_findings inspection_findings_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: inspection_findings inspection_findings_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_findings
    ADD CONSTRAINT inspection_findings_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: inventory_movements inventory_movements_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: inventory_movements inventory_movements_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);


--
-- Name: inventory_movements inventory_movements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: inventory_movements inventory_movements_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id);


--
-- Name: inventory_movements inventory_movements_work_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_work_order_item_id_fkey FOREIGN KEY (work_order_item_id) REFERENCES public.work_order_items(id);


--
-- Name: inventory_movements inventory_movements_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: parts parts_category_id_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: parts parts_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: payment_methods payment_methods_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: purchase_items purchase_items_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: purchase_items purchase_items_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchase_items purchase_items_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id);


--
-- Name: purchase_items purchase_items_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: purchases purchases_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: purchases purchases_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchases purchases_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: quote_items quote_items_part_id_parts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: quote_items quote_items_quote_id_quotes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_quote_id_quotes_id_fk FOREIGN KEY (quote_id) REFERENCES public.quotes(id);


--
-- Name: quote_items quote_items_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: quote_items quote_items_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: quote_versions quote_versions_quote_id_quotes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_versions
    ADD CONSTRAINT quote_versions_quote_id_quotes_id_fk FOREIGN KEY (quote_id) REFERENCES public.quotes(id);


--
-- Name: quote_versions quote_versions_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_versions
    ADD CONSTRAINT quote_versions_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: quotes quotes_bicycle_id_bicycles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_bicycle_id_bicycles_id_fk FOREIGN KEY (bicycle_id) REFERENCES public.bicycles(id);


--
-- Name: quotes quotes_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: quotes quotes_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: receptions receptions_bicycle_id_bicycles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_bicycle_id_bicycles_id_fk FOREIGN KEY (bicycle_id) REFERENCES public.bicycles(id);


--
-- Name: receptions receptions_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: receptions receptions_quote_id_quotes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_quote_id_quotes_id_fk FOREIGN KEY (quote_id) REFERENCES public.quotes(id);


--
-- Name: receptions receptions_received_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_received_by_user_id_users_id_fk FOREIGN KEY (received_by_user_id) REFERENCES public.users(id);


--
-- Name: receptions receptions_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: reservations reservations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: reservations reservations_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: reservations reservations_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: reservations reservations_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: service_steps service_steps_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_steps
    ADD CONSTRAINT service_steps_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_steps service_steps_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_steps
    ADD CONSTRAINT service_steps_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: service_supplies service_supplies_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_supplies
    ADD CONSTRAINT service_supplies_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: service_supplies service_supplies_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_supplies
    ADD CONSTRAINT service_supplies_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_supplies service_supplies_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_supplies
    ADD CONSTRAINT service_supplies_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: services services_category_id_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: services services_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: suppliers suppliers_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: timeline_events timeline_events_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: timeline_events timeline_events_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: users users_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: work_cases work_cases_assigned_mechanic_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cases
    ADD CONSTRAINT work_cases_assigned_mechanic_id_users_id_fk FOREIGN KEY (assigned_mechanic_id) REFERENCES public.users(id);


--
-- Name: work_cases work_cases_bicycle_id_bicycles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cases
    ADD CONSTRAINT work_cases_bicycle_id_bicycles_id_fk FOREIGN KEY (bicycle_id) REFERENCES public.bicycles(id);


--
-- Name: work_cases work_cases_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cases
    ADD CONSTRAINT work_cases_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: work_cases work_cases_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_cases
    ADD CONSTRAINT work_cases_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: work_order_checklist_items work_order_checklist_items_completed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_checklist_items
    ADD CONSTRAINT work_order_checklist_items_completed_by_user_id_users_id_fk FOREIGN KEY (completed_by_user_id) REFERENCES public.users(id);


--
-- Name: work_order_checklist_items work_order_checklist_items_service_step_id_service_steps_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_checklist_items
    ADD CONSTRAINT work_order_checklist_items_service_step_id_service_steps_id_fk FOREIGN KEY (service_step_id) REFERENCES public.service_steps(id);


--
-- Name: work_order_checklist_items work_order_checklist_items_work_order_id_work_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_checklist_items
    ADD CONSTRAINT work_order_checklist_items_work_order_id_work_orders_id_fk FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id);


--
-- Name: work_order_checklist_items work_order_checklist_items_work_order_item_id_work_order_items_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_checklist_items
    ADD CONSTRAINT work_order_checklist_items_work_order_item_id_work_order_items_ FOREIGN KEY (work_order_item_id) REFERENCES public.work_order_items(id);


--
-- Name: work_order_checklist_items work_order_checklist_items_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_checklist_items
    ADD CONSTRAINT work_order_checklist_items_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: work_order_items work_order_items_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_items
    ADD CONSTRAINT work_order_items_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: work_order_items work_order_items_quote_item_id_quote_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_items
    ADD CONSTRAINT work_order_items_quote_item_id_quote_items_id_fk FOREIGN KEY (quote_item_id) REFERENCES public.quote_items(id);


--
-- Name: work_order_items work_order_items_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_items
    ADD CONSTRAINT work_order_items_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: work_order_items work_order_items_work_order_id_work_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_items
    ADD CONSTRAINT work_order_items_work_order_id_work_orders_id_fk FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id);


--
-- Name: work_order_items work_order_items_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_items
    ADD CONSTRAINT work_order_items_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: work_order_photos work_order_photos_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id);


--
-- Name: work_order_photos work_order_photos_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_orders(id);


--
-- Name: work_order_photos work_order_photos_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order_photos
    ADD CONSTRAINT work_order_photos_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: work_orders work_orders_bicycle_id_bicycles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_bicycle_id_bicycles_id_fk FOREIGN KEY (bicycle_id) REFERENCES public.bicycles(id);


--
-- Name: work_orders work_orders_client_id_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: work_orders work_orders_mechanic_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_mechanic_id_users_id_fk FOREIGN KEY (mechanic_id) REFERENCES public.users(id);


--
-- Name: work_orders work_orders_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id);


--
-- Name: work_orders work_orders_quote_id_quotes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_quote_id_quotes_id_fk FOREIGN KEY (quote_id) REFERENCES public.quotes(id);


--
-- Name: work_orders work_orders_reception_id_receptions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_reception_id_receptions_id_fk FOREIGN KEY (reception_id) REFERENCES public.receptions(id);


--
-- Name: work_orders work_orders_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: workshop_settings workshop_settings_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workshop_settings
    ADD CONSTRAINT workshop_settings_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.workshops(id);


--
-- Name: bicycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bicycles ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: document_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: followup_snoozes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.followup_snoozes ENABLE ROW LEVEL SECURITY;

--
-- Name: inspection_findings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inspection_findings ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: parts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_methods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: quote_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

--
-- Name: quote_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quote_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: receptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.receptions ENABLE ROW LEVEL SECURITY;

--
-- Name: reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: service_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: service_supplies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_supplies ENABLE ROW LEVEL SECURITY;

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: bicycles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.bicycles USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.categories USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: clients tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.clients USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: document_counters tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.document_counters USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: followup_snoozes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.followup_snoozes USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: inspection_findings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.inspection_findings USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: inventory_movements tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.inventory_movements USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: parts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.parts USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: payment_methods tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.payment_methods USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: purchase_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.purchase_items USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: purchases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.purchases USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: quote_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.quote_items USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: quote_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.quote_versions USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: quotes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.quotes USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: receptions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.receptions USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: reservations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.reservations USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: service_steps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_steps USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: service_supplies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.service_supplies USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: services tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.services USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: suppliers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.suppliers USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: timeline_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.timeline_events USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: users tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.users USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: work_cases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.work_cases USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: work_order_checklist_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.work_order_checklist_items USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: work_order_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.work_order_items USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: work_order_photos tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.work_order_photos USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: work_orders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.work_orders USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: workshop_settings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workshop_settings USING ((public.app_bypass() OR (workshop_id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (workshop_id = public.current_workshop_id())));


--
-- Name: workshops tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workshops USING ((public.app_bypass() OR (id = public.current_workshop_id()))) WITH CHECK ((public.app_bypass() OR (id = public.current_workshop_id())));


--
-- Name: timeline_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: work_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: work_order_checklist_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_order_checklist_items ENABLE ROW LEVEL SECURITY;

--
-- Name: work_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: work_order_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_order_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: work_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: workshop_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workshop_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: workshops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workshops ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


