create type assay_type as enum ('spot', 'plaque', 'EOP', 'kill_curve', 'biofilm', 'in_vivo', 'other');

alter table phages
  add column if not exists aliases text[] not null default '{}',
  add column if not exists assembly_fasta_sha256 text,
  add column if not exists lifecycle text,
  add column if not exists completeness text,
  add column if not exists phage_cluster text,
  add column if not exists phage_subcluster text,
  add column if not exists phage_metadata jsonb not null default '{}'::jsonb;

alter table host_strains
  add column if not exists lineage text,
  add column if not exists pigment text,
  add column if not exists antibiotic_resistance_profile jsonb not null default '{}'::jsonb;

create table if not exists assays (
  id uuid primary key default gen_random_uuid(),
  type assay_type not null,
  protocol_ref text,
  readout_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),
  assay_id uuid not null references assays(id) on delete restrict,
  lab text,
  operator text,
  experiment_date date,
  conditions jsonb not null default '{}'::jsonb,
  raw_data_uri text,
  qc_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists phage_strain_susceptibility (
  id uuid primary key default gen_random_uuid(),
  phage_id uuid not null references phages(id) on delete cascade,
  strain_id uuid not null references host_strains(id) on delete cascade,
  assay_id uuid references assays(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  susceptible boolean,
  eop numeric,
  confidence numeric(3,2),
  evidence text,
  conditions_hash text,
  notes text,
  created_at timestamptz not null default now(),
  check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table if not exists phage_kinetics (
  id uuid primary key default gen_random_uuid(),
  phage_id uuid not null references phages(id) on delete cascade,
  strain_id uuid references host_strains(id) on delete set null,
  adsorption_rate numeric,
  latent_period_min numeric,
  burst_size numeric,
  moi numeric,
  method text,
  conditions_hash text,
  evidence text,
  created_at timestamptz not null default now()
);

create table if not exists strain_mutations (
  id uuid primary key default gen_random_uuid(),
  parent_strain_id uuid not null references host_strains(id) on delete cascade,
  mutation_calls jsonb not null default '[]'::jsonb,
  phenotype_changes jsonb not null default '{}'::jsonb,
  sequencing_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists cocktails (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  intent text,
  design_rationale text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cocktail_component (
  id uuid primary key default gen_random_uuid(),
  cocktail_id uuid not null references cocktails(id) on delete cascade,
  phage_id uuid not null references phages(id) on delete cascade,
  ratio numeric,
  dose_pfu numeric,
  timing_role timing_role not null default 'unknown',
  component_notes text,
  created_at timestamptz not null default now(),
  unique (cocktail_id, phage_id)
);

create table if not exists cocktail_experiment_results (
  id uuid primary key default gen_random_uuid(),
  cocktail_id uuid not null references cocktails(id) on delete cascade,
  strain_id uuid references host_strains(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  outcome_metrics jsonb not null default '{}'::jsonb,
  resistance_emerged boolean,
  observed_synergy numeric,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_assays_type on assays(type);
create index if not exists idx_experiments_assay_id on experiments(assay_id);
create index if not exists idx_experiments_date on experiments(experiment_date);
create index if not exists idx_pss_phage_id on phage_strain_susceptibility(phage_id);
create index if not exists idx_pss_strain_id on phage_strain_susceptibility(strain_id);
create index if not exists idx_pss_conditions_hash on phage_strain_susceptibility(conditions_hash);
create index if not exists idx_kinetics_phage_id on phage_kinetics(phage_id);
create index if not exists idx_kinetics_strain_id on phage_kinetics(strain_id);
create index if not exists idx_cocktails_name on cocktails(name);
create index if not exists idx_cocktail_component_cocktail on cocktail_component(cocktail_id);
create index if not exists idx_cocktail_component_phage on cocktail_component(phage_id);
create index if not exists idx_cer_cocktail on cocktail_experiment_results(cocktail_id);
create index if not exists idx_cer_strain on cocktail_experiment_results(strain_id);
create index if not exists idx_cer_experiment on cocktail_experiment_results(experiment_id);

drop trigger if exists trg_cocktails_updated_at on cocktails;
create trigger trg_cocktails_updated_at
before update on cocktails
for each row execute function set_updated_at();

alter table assays enable row level security;
alter table experiments enable row level security;
alter table phage_strain_susceptibility enable row level security;
alter table phage_kinetics enable row level security;
alter table strain_mutations enable row level security;
alter table cocktails enable row level security;
alter table cocktail_component enable row level security;
alter table cocktail_experiment_results enable row level security;

create policy assays_public_read on assays for select using (true);
create policy experiments_public_read on experiments for select using (true);
create policy pss_public_read on phage_strain_susceptibility for select using (true);
create policy phage_kinetics_public_read on phage_kinetics for select using (true);
create policy strain_mutations_public_read on strain_mutations for select using (true);
create policy cocktails_public_read on cocktails for select using (true);
create policy cocktail_component_public_read on cocktail_component for select using (true);
create policy cocktail_experiment_results_public_read on cocktail_experiment_results for select using (true);

create policy assays_curator_insert on assays for insert with check (public.is_curator());
create policy assays_curator_update on assays for update using (public.is_curator()) with check (public.is_curator());

create policy experiments_curator_insert on experiments for insert with check (public.is_curator());
create policy experiments_curator_update on experiments for update using (public.is_curator()) with check (public.is_curator());

create policy pss_curator_insert on phage_strain_susceptibility for insert with check (public.is_curator());
create policy pss_curator_update on phage_strain_susceptibility for update using (public.is_curator()) with check (public.is_curator());

create policy phage_kinetics_curator_insert on phage_kinetics for insert with check (public.is_curator());
create policy phage_kinetics_curator_update on phage_kinetics for update using (public.is_curator()) with check (public.is_curator());

create policy strain_mutations_curator_insert on strain_mutations for insert with check (public.is_curator());
create policy strain_mutations_curator_update on strain_mutations for update using (public.is_curator()) with check (public.is_curator());

create policy cocktails_curator_insert on cocktails for insert with check (public.is_curator());
create policy cocktails_curator_update on cocktails for update using (public.is_curator()) with check (public.is_curator());

create policy cocktail_component_curator_insert on cocktail_component for insert with check (public.is_curator());
create policy cocktail_component_curator_update on cocktail_component for update using (public.is_curator()) with check (public.is_curator());

create policy cer_curator_insert on cocktail_experiment_results for insert with check (public.is_curator());
create policy cer_curator_update on cocktail_experiment_results for update using (public.is_curator()) with check (public.is_curator());
