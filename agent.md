You are an expert AI software engineer assisting with the "TimeForMass" schedule-management system. This repository uses a React.js SPA, Node.js runtime environment, and a Supabase backend.

## SYSTEM GUARDRAILS (DO NOT VIOLATE)
1. **Targeted In-Place Editing Only:** When asked to modify a file, do not rewrite the entire file and do not output diff/patch notation. Instead, locate the specific lines or functions that require changes, update them cleanly, and leave the rest of the file exactly as it is.
2. **NO Lazy Layout Placeholders:** While you must use diff format to save tokens, your code blocks *inside* the diff must be fully written out. Never leave structural code shortcuts like `// Rest of the logic remains unchanged...` *inside* the new block you are introducing. 
3. **Do Not Overwrite Existing UI/Logic:** The admin manual calendar grid workspace is highly integrated with coordinate drag-and-drop and resize hooks. Do not modify or refactor the core scheduling canvas layout or pointer-events handlers (`handlePointerDown`, `handleDragScheduleStart`, etc.) unless explicitly requested.
4. **Separation of Scraper States:** Under no circumstances should unverified, freshly scraped schedules be mixed into public views. They must live as draft states (`is_scraped_draft = true`).

## 📁 Repository Blueprint
- `.env` (Project Root): Contains Supabase environment configurations. VITE parameters are public. Server/Python role tokens are confidential.
- `src/repositories/`: Implements the Data Access Object (DAO) pattern separating direct data client manipulations from app logic layers.
- `src/services/`: Structural coordinator layer mapping operations across multi-table repositories.
- `src/views/pages/`: Contains view screens. `Home.jsx` handles consumer queries. `AdminDashboard.jsx` handles data entry.
- `scraper/`: Isolated Python engine namespace. Handles out-of-band cron execution web tasks and PDF extractions.

## Database
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.admin (
  admin_id integer NOT NULL DEFAULT nextval('admin_admin_id_seq'::regclass),
  parish_id integer,
  name character varying NOT NULL,
  email character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  auth_uid uuid,
  CONSTRAINT admin_pkey PRIMARY KEY (admin_id),
  CONSTRAINT admin_parish_id_fkey FOREIGN KEY (parish_id) REFERENCES public.parish(parish_id)
);
CREATE TABLE public.mass_types (
  mass_type_id integer NOT NULL DEFAULT nextval('mass_types_mass_type_id_seq'::regclass),
  admin_id integer,
  name character varying NOT NULL,
  color character varying NOT NULL DEFAULT '#2C3E91'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mass_types_pkey PRIMARY KEY (mass_type_id),
  CONSTRAINT mass_types_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin(admin_id)
);
CREATE TABLE public.parish (
  parish_id integer NOT NULL DEFAULT nextval('parish_parish_id_seq'::regclass),
  name character varying NOT NULL,
  address text,
  city character varying,
  contact_number character varying,
  email character varying,
  website character varying,
  last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  location_url character varying,
  target_scrape_url text,
  last_automated_sync timestamp with time zone,
  CONSTRAINT parish_pkey PRIMARY KEY (parish_id)
);
CREATE TABLE public.schedule_templates (
  template_id integer NOT NULL DEFAULT nextval('schedule_templates_template_id_seq'::regclass),
  admin_id integer,
  name character varying NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT schedule_templates_pkey PRIMARY KEY (template_id),
  CONSTRAINT schedule_templates_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin(admin_id)
);
CREATE TABLE public.template_schedules (
  template_schedule_id integer NOT NULL DEFAULT nextval('template_schedules_template_schedule_id_seq'::regclass),
  template_id integer,
  mass_type_id integer,
  day_of_week smallint NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  language character varying,
  notes text,
  last_updated timestamp with time zone DEFAULT now(),
  is_scraped_draft boolean DEFAULT false,
  CONSTRAINT template_schedules_pkey PRIMARY KEY (template_schedule_id),
  CONSTRAINT template_schedules_mass_type_id_fkey FOREIGN KEY (mass_type_id) REFERENCES public.mass_types(mass_type_id),
  CONSTRAINT template_schedules_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.schedule_templates(template_id)
);