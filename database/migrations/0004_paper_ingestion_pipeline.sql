create type paper_oa_status as enum ('unknown', 'open_access', 'closed');
create type paper_ingest_status as enum (
  'queued',
  'metadata_fetched',
  'assets_fetched',
  'extracted',
  'pending_review',
  'published',
  'failed'
);
create type paper_asset_type as enum ('full_text_xml', 'full_text_html', 'supplement', 'figure', 'table');
create type paper_asset_fetch_status as enum ('queued', 'fetched', 'failed');
create type paper_job_type as enum ('search', 'fetch', 'extract', 'publish');
create type paper_job_status as enum ('queued', 'running', 'completed', 'failed');
create type paper_extraction_status as enum ('pending_review', 'approved', 'rejected', 'published');

create table if not exists papers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  journal text,
  year integer,
  doi text,
  pmid text,
  pmcid text,
  url text,
  oa_status paper_oa_status not null default 'unknown',
  pathogen_focus text not null default 'S_aureus',
  ingest_status paper_ingest_status not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists paper_assets (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  asset_type paper_asset_type not null,
  source_url text not null,
  storage_path text,
  mime_type text,
  fetch_status paper_asset_fetch_status not null default 'queued',
  checksum text,
  created_at timestamptz not null default now()
);

create table if not exists paper_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type paper_job_type not null,
  scope_json jsonb not null default '{}'::jsonb,
  status paper_job_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  error_text text,
  stats_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists paper_extractions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  extractor_version text not null default 'v1_rule_parser',
  status paper_extraction_status not null default 'pending_review',
  confidence numeric(4,3) not null default 0.5,
  notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  check (confidence >= 0 and confidence <= 1)
);

create table if not exists paper_extraction_rows (
  id uuid primary key default gen_random_uuid(),
  paper_extraction_id uuid not null references paper_extractions(id) on delete cascade,
  cocktail_name text,
  assay_type assay_type,
  pathogen text not null default 'S_aureus',
  host_species text,
  host_strain_raw text,
  phage_names_json jsonb not null default '[]'::jsonb,
  phage_accessions_json jsonb not null default '[]'::jsonb,
  normalized_phage_set text not null default '',
  conditions_json jsonb not null default '{}'::jsonb,
  conditions_hash text,
  outcome_metrics_json jsonb not null default '{}'::jsonb,
  evidence_location text,
  confidence numeric(4,3) not null default 0.5,
  needs_review boolean not null default true,
  created_at timestamptz not null default now(),
  check (confidence >= 0 and confidence <= 1)
);

create table if not exists paper_publish_links (
  id uuid primary key default gen_random_uuid(),
  paper_row_id uuid not null references paper_extraction_rows(id) on delete cascade,
  cocktail_id uuid references cocktails(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  result_id uuid references cocktail_experiment_results(id) on delete set null,
  citation_source_id uuid references citation_sources(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (paper_row_id)
);

create table if not exists ingest_cursor (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  query_key text not null,
  last_run_at timestamptz,
  cursor_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, query_key)
);

create unique index if not exists idx_papers_doi_unique on papers (doi) where doi is not null;
create unique index if not exists idx_papers_pmid_unique on papers (pmid) where pmid is not null;
create unique index if not exists idx_papers_pmcid_unique on papers (pmcid) where pmcid is not null;
create index if not exists idx_papers_status on papers (ingest_status);
create index if not exists idx_papers_pathogen on papers (pathogen_focus);
create index if not exists idx_papers_created_at on papers (created_at desc);
create index if not exists idx_paper_assets_paper on paper_assets (paper_id);
create index if not exists idx_paper_assets_type on paper_assets (asset_type);
create index if not exists idx_paper_jobs_status on paper_ingest_jobs (status);
create index if not exists idx_paper_jobs_type on paper_ingest_jobs (job_type);
create index if not exists idx_paper_extractions_status on paper_extractions (status);
create index if not exists idx_paper_extractions_paper on paper_extractions (paper_id);
create index if not exists idx_paper_rows_extraction on paper_extraction_rows (paper_extraction_id);
create index if not exists idx_paper_rows_assay on paper_extraction_rows (assay_type);
create index if not exists idx_paper_rows_pathogen on paper_extraction_rows (pathogen);
create index if not exists idx_paper_rows_conditions_hash on paper_extraction_rows (conditions_hash);
create index if not exists idx_paper_rows_conditions_gin on paper_extraction_rows using gin (conditions_json);
create index if not exists idx_paper_rows_outcomes_gin on paper_extraction_rows using gin (outcome_metrics_json);
create unique index if not exists idx_paper_row_dedupe on paper_extraction_rows (
  paper_extraction_id,
  assay_type,
  normalized_phage_set,
  host_strain_raw,
  conditions_hash,
  evidence_location
);
create index if not exists idx_paper_publish_links_result on paper_publish_links (result_id);

drop trigger if exists trg_papers_updated_at on papers;
create trigger trg_papers_updated_at
before update on papers
for each row execute function set_updated_at();

drop trigger if exists trg_ingest_cursor_updated_at on ingest_cursor;
create trigger trg_ingest_cursor_updated_at
before update on ingest_cursor
for each row execute function set_updated_at();

alter table papers enable row level security;
alter table paper_assets enable row level security;
alter table paper_ingest_jobs enable row level security;
alter table paper_extractions enable row level security;
alter table paper_extraction_rows enable row level security;
alter table paper_publish_links enable row level security;
alter table ingest_cursor enable row level security;

create policy papers_public_read on papers for select using (true);
create policy paper_assets_public_read on paper_assets for select using (true);
create policy paper_publish_links_public_read on paper_publish_links for select using (true);

create policy papers_curator_insert on papers for insert with check (public.is_curator());
create policy papers_curator_update on papers for update using (public.is_curator()) with check (public.is_curator());
create policy paper_assets_curator_insert on paper_assets for insert with check (public.is_curator());
create policy paper_assets_curator_update on paper_assets for update using (public.is_curator()) with check (public.is_curator());
create policy paper_jobs_curator_insert on paper_ingest_jobs for insert with check (public.is_curator());
create policy paper_jobs_curator_update on paper_ingest_jobs for update using (public.is_curator()) with check (public.is_curator());
create policy paper_extractions_curator_insert on paper_extractions for insert with check (public.is_curator());
create policy paper_extractions_curator_update on paper_extractions for update using (public.is_curator()) with check (public.is_curator());
create policy paper_rows_curator_insert on paper_extraction_rows for insert with check (public.is_curator());
create policy paper_rows_curator_update on paper_extraction_rows for update using (public.is_curator()) with check (public.is_curator());
create policy paper_publish_links_curator_insert on paper_publish_links for insert with check (public.is_curator());
create policy paper_publish_links_curator_update on paper_publish_links for update using (public.is_curator()) with check (public.is_curator());
create policy ingest_cursor_curator_insert on ingest_cursor for insert with check (public.is_curator());
create policy ingest_cursor_curator_update on ingest_cursor for update using (public.is_curator()) with check (public.is_curator());
