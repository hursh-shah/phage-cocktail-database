create extension if not exists pgcrypto;

create type evidence_level as enum ('peer_reviewed', 'preprint', 'unpublished_comm');
create type confidence_level as enum ('high', 'medium', 'low');
create type assay_outcome as enum ('susceptible', 'resistant', 'partial', 'unknown');
create type stage_label as enum ('early', 'semi_early', 'late', 'unknown');
create type kinetics_metric_type as enum ('latent_period_min', 'burst_size', 'peak_titer_time_h', 'other');
create type timing_role as enum ('early', 'semi_early', 'late', 'unknown');
create type distance_metric as enum ('ANI', 'Mash', 'other');
create type source_type as enum ('paper', 'database', 'personal_comm', 'dataset');
create type submission_type as enum ('manual', 'csv');
create type submission_status as enum ('pending', 'approved', 'rejected');
create type material_type as enum ('skin', 'sewage', 'sweat', 'wastewater', 'soil', 'clinical_swab', 'other');
create type tag_category as enum ('data_availability', 'research_focus', 'quality');

create table isolation_sources (
  id uuid primary key default gen_random_uuid(),
  material_type material_type not null,
  site text,
  geo_region text,
  created_at timestamptz not null default now()
);

create table phages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  genome_accession text,
  genome_length_bp integer,
  gc_content numeric(5,2),
  taxonomy_family text,
  taxonomy_genus text,
  host_primary_taxon text,
  isolation_source_id uuid references isolation_sources(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (genome_accession)
);

create table host_strains (
  id uuid primary key default gen_random_uuid(),
  species text not null,
  strain_name text,
  strain_identifier text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_host_strains_identity_unique
  on host_strains (species, coalesce(strain_name, ''), coalesce(strain_identifier, ''));

create table host_range_assays (
  id uuid primary key default gen_random_uuid(),
  phage_id uuid not null references phages(id) on delete cascade,
  host_strain_id uuid not null references host_strains(id) on delete cascade,
  assay_method text not null,
  outcome assay_outcome not null,
  moi numeric,
  temperature_c numeric,
  replicates integer,
  measurement_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table kinetics_observations (
  id uuid primary key default gen_random_uuid(),
  phage_id uuid not null references phages(id) on delete cascade,
  stage_label stage_label not null default 'unknown',
  metric_type kinetics_metric_type not null default 'other',
  metric_value numeric,
  metric_unit text,
  context text,
  created_at timestamptz not null default now()
);

create table cocktail_experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_bacterium text,
  design_notes text,
  outcome_summary text,
  synergy_score numeric,
  resistance_delay_metric text,
  study_context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cocktail_components (
  id uuid primary key default gen_random_uuid(),
  cocktail_experiment_id uuid not null references cocktail_experiments(id) on delete cascade,
  phage_id uuid not null references phages(id) on delete cascade,
  timing_role timing_role not null default 'unknown',
  relative_dose numeric,
  component_notes text,
  created_at timestamptz not null default now(),
  unique (cocktail_experiment_id, phage_id)
);

create table genetic_relatedness (
  id uuid primary key default gen_random_uuid(),
  phage_a_id uuid not null references phages(id) on delete cascade,
  phage_b_id uuid not null references phages(id) on delete cascade,
  distance_metric distance_metric not null,
  distance_value numeric,
  method text,
  created_at timestamptz not null default now(),
  check (phage_a_id <> phage_b_id)
);

create table tags (
  id uuid primary key default gen_random_uuid(),
  category tag_category not null,
  value text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table tag_aliases (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references tags(id) on delete cascade,
  alias_value text not null unique,
  created_at timestamptz not null default now()
);

create table phage_tags (
  id uuid primary key default gen_random_uuid(),
  phage_id uuid not null references phages(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (phage_id, tag_id)
);

create table citation_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  authors text[] not null default '{}',
  year integer,
  doi text,
  url text,
  source_type source_type not null,
  created_at timestamptz not null default now(),
  unique (doi)
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  level evidence_level not null,
  confidence confidence_level not null,
  source_id uuid references citation_sources(id) on delete set null,
  comment text,
  created_at timestamptz not null default now()
);

create table field_citations (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  field_name text not null,
  citation_source_id uuid not null references citation_sources(id) on delete cascade,
  evidence_id uuid references evidence(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, field_name, citation_source_id)
);

create table curation_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type submission_type not null,
  status submission_status not null default 'pending',
  submitted_by text,
  reviewed_by text,
  payload_json jsonb not null,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  diff_json jsonb,
  created_at timestamptz not null default now()
);

create index idx_phages_name on phages(name);
create index idx_phages_accession on phages(genome_accession);
create index idx_phages_host_primary_taxon on phages(host_primary_taxon);
create index idx_host_strains_species on host_strains(species);
create index idx_host_range_assays_phage on host_range_assays(phage_id);
create index idx_host_range_assays_host on host_range_assays(host_strain_id);
create index idx_host_range_assays_outcome on host_range_assays(outcome);
create index idx_kinetics_observations_phage on kinetics_observations(phage_id);
create index idx_kinetics_observations_stage on kinetics_observations(stage_label);
create index idx_cocktail_components_experiment on cocktail_components(cocktail_experiment_id);
create index idx_cocktail_components_phage on cocktail_components(phage_id);
create index idx_genetic_relatedness_pair on genetic_relatedness(phage_a_id, phage_b_id);
create index idx_phage_tags_phage on phage_tags(phage_id);
create index idx_phage_tags_tag on phage_tags(tag_id);
create index idx_field_citations_entity on field_citations(entity_type, entity_id);
create index idx_curation_submissions_status on curation_submissions(status);
create index idx_evidence_level on evidence(level);
create index idx_phages_search on phages using gin (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(notes, '')));
create index idx_citation_sources_search on citation_sources using gin (to_tsvector('english', coalesce(title, '')));

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_phages_updated_at
before update on phages
for each row execute function set_updated_at();

create trigger trg_host_strains_updated_at
before update on host_strains
for each row execute function set_updated_at();

create trigger trg_cocktail_experiments_updated_at
before update on cocktail_experiments
for each row execute function set_updated_at();

create trigger trg_curation_submissions_updated_at
before update on curation_submissions
for each row execute function set_updated_at();
