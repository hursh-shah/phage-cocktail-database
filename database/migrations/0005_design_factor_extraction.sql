do $$
begin
  create type design_factor_type as enum (
    'host_range',
    'kinetics',
    'genetic_relatedness',
    'receptor_resistance',
    'biofilm',
    'antibiotic_synergy',
    'cocktail_outcome',
    'safety'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists paper_extraction_factor_rows (
  id uuid primary key default gen_random_uuid(),
  paper_extraction_id uuid not null references paper_extractions(id) on delete cascade,
  factor_type design_factor_type not null,
  pathogen text not null default 'S_maltophilia',
  host_species text,
  host_strain_raw text,
  phage_names_json jsonb not null default '[]'::jsonb,
  phage_accessions_json jsonb not null default '[]'::jsonb,
  assay_type assay_type,
  conditions_json jsonb not null default '{}'::jsonb,
  measurements_json jsonb not null default '{}'::jsonb,
  outcome_role text,
  evidence_location text,
  confidence numeric(4,3) not null default 0.5,
  needs_review boolean not null default true,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (confidence >= 0 and confidence <= 1)
);

create table if not exists paper_asset_texts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references paper_assets(id) on delete cascade,
  text_content text not null,
  parse_status text not null default 'parsed',
  parser_notes text,
  created_at timestamptz not null default now(),
  unique (asset_id)
);

create index if not exists idx_paper_factor_rows_extraction
  on paper_extraction_factor_rows (paper_extraction_id);

create index if not exists idx_paper_factor_rows_type
  on paper_extraction_factor_rows (factor_type);

create index if not exists idx_paper_factor_rows_pathogen
  on paper_extraction_factor_rows (pathogen);

create index if not exists idx_paper_factor_rows_measurements_gin
  on paper_extraction_factor_rows using gin (measurements_json);

create index if not exists idx_paper_asset_texts_asset
  on paper_asset_texts (asset_id);

alter table paper_extraction_factor_rows enable row level security;
alter table paper_asset_texts enable row level security;

create policy paper_factor_rows_public_read
  on paper_extraction_factor_rows for select using (true);

create policy paper_factor_rows_curator_insert
  on paper_extraction_factor_rows for insert with check (public.is_curator());

create policy paper_factor_rows_curator_update
  on paper_extraction_factor_rows for update using (public.is_curator()) with check (public.is_curator());

create policy paper_asset_texts_public_read
  on paper_asset_texts for select using (true);

create policy paper_asset_texts_curator_insert
  on paper_asset_texts for insert with check (public.is_curator());

create policy paper_asset_texts_curator_update
  on paper_asset_texts for update using (public.is_curator()) with check (public.is_curator());
