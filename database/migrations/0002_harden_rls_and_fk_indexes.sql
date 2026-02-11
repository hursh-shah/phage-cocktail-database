create index if not exists idx_evidence_source_id on evidence(source_id);
create index if not exists idx_field_citations_citation_source_id on field_citations(citation_source_id);
create index if not exists idx_field_citations_evidence_id on field_citations(evidence_id);
create index if not exists idx_genetic_relatedness_phage_b_id on genetic_relatedness(phage_b_id);
create index if not exists idx_phages_isolation_source_id on phages(isolation_source_id);
create index if not exists idx_tag_aliases_tag_id on tag_aliases(tag_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_curator()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') in ('curator', 'admin');
$$;

alter table isolation_sources enable row level security;
alter table phages enable row level security;
alter table host_range_assays enable row level security;
alter table host_strains enable row level security;
alter table kinetics_observations enable row level security;
alter table cocktail_experiments enable row level security;
alter table cocktail_components enable row level security;
alter table genetic_relatedness enable row level security;
alter table tags enable row level security;
alter table tag_aliases enable row level security;
alter table phage_tags enable row level security;
alter table citation_sources enable row level security;
alter table evidence enable row level security;
alter table field_citations enable row level security;
alter table curation_submissions enable row level security;
alter table audit_logs enable row level security;

create policy isolation_sources_public_read on isolation_sources for select using (true);
create policy phages_public_read on phages for select using (true);
create policy host_range_assays_public_read on host_range_assays for select using (true);
create policy host_strains_public_read on host_strains for select using (true);
create policy kinetics_observations_public_read on kinetics_observations for select using (true);
create policy cocktail_experiments_public_read on cocktail_experiments for select using (true);
create policy cocktail_components_public_read on cocktail_components for select using (true);
create policy genetic_relatedness_public_read on genetic_relatedness for select using (true);
create policy tags_public_read on tags for select using (true);
create policy tag_aliases_public_read on tag_aliases for select using (true);
create policy phage_tags_public_read on phage_tags for select using (true);
create policy citation_sources_public_read on citation_sources for select using (true);
create policy evidence_public_read on evidence for select using (true);
create policy field_citations_public_read on field_citations for select using (true);

create policy curation_submissions_curator_read on curation_submissions for select using (public.is_curator());
create policy curation_submissions_curator_insert on curation_submissions for insert with check (public.is_curator());
create policy curation_submissions_curator_update on curation_submissions for update using (public.is_curator()) with check (public.is_curator());

create policy audit_logs_curator_read on audit_logs for select using (public.is_curator());
create policy audit_logs_curator_insert on audit_logs for insert with check (public.is_curator());
