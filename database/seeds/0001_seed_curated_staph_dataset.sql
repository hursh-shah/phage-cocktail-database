begin;

insert into tags (category, value, description)
values
  ('data_availability', 'has_genome_sequence', 'Genome accession is available'),
  ('data_availability', 'has_host_range_assay', 'Host-range assay data exists'),
  ('data_availability', 'has_kinetics_stage', 'Kinetics stage label is available'),
  ('data_availability', 'has_kinetics_numeric', 'Numeric kinetics metric is available'),
  ('data_availability', 'has_cocktail_experiment', 'Phage appears in a cocktail experiment'),
  ('data_availability', 'has_genetic_relatedness', 'Genetic relatedness metrics are available'),
  ('data_availability', 'has_isolation_source', 'Isolation source metadata is available'),
  ('data_availability', 'has_resistance_context', 'Resistance-evolution context is available'),
  ('research_focus', 'staph_priority', 'Staphylococcus-priority curation set'),
  ('research_focus', 'cocktail_timing_study', 'Used in timing-staggered cocktail analysis'),
  ('research_focus', 'genetically_close_cluster', 'Tagged for genetic-closeness cocktail hypothesis'),
  ('research_focus', 'genetically_distant_cluster', 'Tagged for genetic-distance cocktail hypothesis'),
  ('quality', 'high_confidence', 'High confidence structured source'),
  ('quality', 'needs_validation', 'Data included but needs additional verification'),
  ('quality', 'sparse_metadata', 'Record has limited phenotype metadata')
on conflict (value) do nothing;

insert into tag_aliases (tag_id, alias_value)
select t.id, v.alias_value
from (values
  ('staph_priority', 'staphylococcus-priority'),
  ('has_kinetics_stage', 'kinetics_stage_available'),
  ('has_cocktail_experiment', 'cocktail_data')
) as v(tag_value, alias_value)
join tags t on t.value = v.tag_value
where not exists (
  select 1 from tag_aliases ta where ta.alias_value = v.alias_value
);

with source_rows(title, authors, year, doi, url, source_type) as (
  values
    (
      'NCBI Nucleotide RefSeq records for Staphylococcus phages',
      array[]::text[],
      2026,
      null::text,
      'https://www.ncbi.nlm.nih.gov/nuccore/',
      'database'::source_type
    ),
    (
      'Virus-Host DB index for Staphylococcus phages',
      array[]::text[],
      2026,
      null::text,
      'https://www.genome.jp/virushostdb/1280',
      'database'::source_type
    ),
    (
      'NCBI taxonomy snapshot via MCP for Staphylococcus taxids',
      array[]::text[],
      2026,
      null::text,
      'https://www.ncbi.nlm.nih.gov/taxonomy',
      'dataset'::source_type
    ),
    (
      'Internal research partner email on staphylococcal cocktail kinetics and host-range strategy',
      array['Research partner']::text[],
      2026,
      null::text,
      null::text,
      'personal_comm'::source_type
    )
)
insert into citation_sources (title, authors, year, doi, url, source_type)
select s.title, s.authors, s.year, s.doi, s.url, s.source_type
from source_rows s
where not exists (
  select 1 from citation_sources c where c.title = s.title
);

insert into evidence (level, confidence, source_id, comment)
select
  'peer_reviewed'::evidence_level,
  'high'::confidence_level,
  c.id,
  'Public structured database source used for seed curation'
from citation_sources c
where c.title in (
  'NCBI Nucleotide RefSeq records for Staphylococcus phages',
  'Virus-Host DB index for Staphylococcus phages',
  'NCBI taxonomy snapshot via MCP for Staphylococcus taxids'
)
and not exists (
  select 1 from evidence e
  where e.source_id = c.id
    and e.level = 'peer_reviewed'::evidence_level
    and e.confidence = 'high'::confidence_level
);

insert into evidence (level, confidence, source_id, comment)
select
  'unpublished_comm'::evidence_level,
  'medium'::confidence_level,
  c.id,
  'Unpublished partner communication included for hypothesis generation'
from citation_sources c
where c.title = 'Internal research partner email on staphylococcal cocktail kinetics and host-range strategy'
and not exists (
  select 1 from evidence e
  where e.source_id = c.id
    and e.level = 'unpublished_comm'::evidence_level
    and e.confidence = 'medium'::confidence_level
);

with host_rows(species, strain_name, strain_identifier, metadata_json) as (
  values
    ('Staphylococcus aureus', 'ATCC 43300', 'ATCC_43300', '{"tax_id": 1280}'::jsonb),
    ('Staphylococcus aureus', 'USA300', 'USA300', '{"tax_id": 1280}'::jsonb),
    ('Staphylococcus epidermidis', 'ATCC 12228', 'ATCC_12228', '{"tax_id": 1282}'::jsonb)
)
insert into host_strains (species, strain_name, strain_identifier, metadata_json)
select h.species, h.strain_name, h.strain_identifier, h.metadata_json
from host_rows h
where not exists (
  select 1
  from host_strains hs
  where hs.species = h.species
    and coalesce(hs.strain_name, '') = coalesce(h.strain_name, '')
    and coalesce(hs.strain_identifier, '') = coalesce(h.strain_identifier, '')
);

insert into phages (
  name,
  genome_accession,
  taxonomy_family,
  taxonomy_genus,
  host_primary_taxon,
  notes
)
values
  ('Staphylococcus phage phiP68', 'NC_004679.1', 'Rountreeviridae', 'Rosenblumvirus', 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage 80alpha', 'NC_009526.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage Twort', 'NC_007021.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage K', 'NC_005880.2', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage 66', 'NC_007046.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage 47', 'NC_007054.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage StB27', 'NC_019914.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage phiSa119', 'NC_025460.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage P954', 'NC_013195.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage P630', 'NC_048635.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage 3AJ-2017', 'NC_048644.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records'),
  ('Staphylococcus phage phiETA', 'NC_003288.1', null, null, 'Staphylococcus aureus', 'Seeded from public RefSeq-linked records')
on conflict (genome_accession) do update
set
  name = excluded.name,
  taxonomy_family = excluded.taxonomy_family,
  taxonomy_genus = excluded.taxonomy_genus,
  host_primary_taxon = excluded.host_primary_taxon,
  notes = excluded.notes;

with unpublished(name, notes) as (
  values
    ('KB824', 'Unpublished partner report: early-acting phage in timing-staggered cocktail'),
    ('SBP2@2', 'Unpublished partner report: semi-early-acting phage in timing-staggered cocktail'),
    ('ANB28', 'Unpublished partner report: late-acting phage in timing-staggered cocktail')
)
insert into phages (name, host_primary_taxon, notes)
select u.name, 'Staphylococcus aureus', u.notes
from unpublished u
where not exists (
  select 1
  from phages p
  where p.name = u.name
    and p.genome_accession is null
);

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'staph_priority'
where p.host_primary_taxon = 'Staphylococcus aureus'
on conflict (phage_id, tag_id) do nothing;

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'has_genome_sequence'
where p.genome_accession is not null
on conflict (phage_id, tag_id) do nothing;

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'sparse_metadata'
where p.genome_accession is not null
on conflict (phage_id, tag_id) do nothing;

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'needs_validation'
where p.name in ('KB824', 'SBP2@2', 'ANB28')
on conflict (phage_id, tag_id) do nothing;

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'has_host_range_assay'
where p.name in ('KB824', 'SBP2@2', 'ANB28')
on conflict (phage_id, tag_id) do nothing;

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'has_kinetics_stage'
where p.name in ('KB824', 'SBP2@2', 'ANB28')
on conflict (phage_id, tag_id) do nothing;

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'has_cocktail_experiment'
where p.name in ('KB824', 'SBP2@2', 'ANB28')
on conflict (phage_id, tag_id) do nothing;

insert into phage_tags (phage_id, tag_id)
select p.id, t.id
from phages p
join tags t on t.value = 'cocktail_timing_study'
where p.name in ('KB824', 'SBP2@2', 'ANB28')
on conflict (phage_id, tag_id) do nothing;

insert into host_range_assays (
  phage_id,
  host_strain_id,
  assay_method,
  outcome,
  measurement_json
)
select
  p.id,
  hs.id,
  'in vitro plaque assay (reported)',
  r.outcome::assay_outcome,
  jsonb_build_object('source', 'partner_email_seed')
from (values
  ('KB824', 'ATCC_43300', 'susceptible'),
  ('SBP2@2', 'ATCC_43300', 'susceptible'),
  ('ANB28', 'ATCC_43300', 'partial')
) as r(phage_name, strain_identifier, outcome)
join phages p on p.name = r.phage_name
join host_strains hs on hs.strain_identifier = r.strain_identifier
where not exists (
  select 1
  from host_range_assays a
  where a.phage_id = p.id
    and a.host_strain_id = hs.id
    and a.assay_method = 'in vitro plaque assay (reported)'
);

insert into kinetics_observations (
  phage_id,
  stage_label,
  metric_type,
  context
)
select
  p.id,
  k.stage_label::stage_label,
  'other'::kinetics_metric_type,
  k.context
from (values
  ('KB824', 'early', 'Unpublished partner report: early activity in cocktail context'),
  ('SBP2@2', 'semi_early', 'Unpublished partner report: semi-early activity in cocktail context'),
  ('ANB28', 'late', 'Unpublished partner report: late activity in cocktail context')
) as k(phage_name, stage_label, context)
join phages p on p.name = k.phage_name
where not exists (
  select 1
  from kinetics_observations ko
  where ko.phage_id = p.id
    and ko.stage_label = k.stage_label::stage_label
);

insert into cocktail_experiments (
  name,
  target_bacterium,
  design_notes,
  outcome_summary,
  study_context
)
select
  'Staph timing-staggered cocktail pilot (KB824 + SBP2@2 + ANB28)',
  'Staphylococcus aureus',
  'Seeded from unpublished partner communication; early/semi-early/late phage combination',
  'Reported as highly effective in unpublished partner communication',
  'unpublished_comm'
where not exists (
  select 1
  from cocktail_experiments ce
  where ce.name = 'Staph timing-staggered cocktail pilot (KB824 + SBP2@2 + ANB28)'
);

insert into cocktail_components (
  cocktail_experiment_id,
  phage_id,
  timing_role,
  component_notes
)
select
  ce.id,
  p.id,
  c.timing_role::timing_role,
  c.component_notes
from cocktail_experiments ce
join (values
  ('KB824', 'early', 'Seed component from partner email'),
  ('SBP2@2', 'semi_early', 'Seed component from partner email'),
  ('ANB28', 'late', 'Seed component from partner email')
) as c(phage_name, timing_role, component_notes)
  on true
join phages p on p.name = c.phage_name
where ce.name = 'Staph timing-staggered cocktail pilot (KB824 + SBP2@2 + ANB28)'
on conflict (cocktail_experiment_id, phage_id) do nothing;

with ncbi_src as (
  select id from citation_sources
  where title = 'NCBI Nucleotide RefSeq records for Staphylococcus phages'
),
ncbi_ev as (
  select e.id
  from evidence e
  join ncbi_src s on s.id = e.source_id
  where e.level = 'peer_reviewed'::evidence_level
  order by e.created_at
  limit 1
)
insert into field_citations (entity_type, entity_id, field_name, citation_source_id, evidence_id)
select
  'phage',
  p.id,
  'genome_accession',
  s.id,
  ev.id
from phages p
cross join ncbi_src s
cross join ncbi_ev ev
where p.genome_accession is not null
on conflict (entity_type, entity_id, field_name, citation_source_id) do nothing;

with partner_src as (
  select id from citation_sources
  where title = 'Internal research partner email on staphylococcal cocktail kinetics and host-range strategy'
),
partner_ev as (
  select e.id
  from evidence e
  join partner_src s on s.id = e.source_id
  where e.level = 'unpublished_comm'::evidence_level
  order by e.created_at
  limit 1
)
insert into field_citations (entity_type, entity_id, field_name, citation_source_id, evidence_id)
select
  'phage',
  p.id,
  'stage_label',
  s.id,
  ev.id
from phages p
cross join partner_src s
cross join partner_ev ev
where p.name in ('KB824', 'SBP2@2', 'ANB28')
on conflict (entity_type, entity_id, field_name, citation_source_id) do nothing;

with partner_src as (
  select id from citation_sources
  where title = 'Internal research partner email on staphylococcal cocktail kinetics and host-range strategy'
),
partner_ev as (
  select e.id
  from evidence e
  join partner_src s on s.id = e.source_id
  where e.level = 'unpublished_comm'::evidence_level
  order by e.created_at
  limit 1
)
insert into field_citations (entity_type, entity_id, field_name, citation_source_id, evidence_id)
select
  'cocktail_experiment',
  ce.id,
  'outcome_summary',
  s.id,
  ev.id
from cocktail_experiments ce
cross join partner_src s
cross join partner_ev ev
where ce.name = 'Staph timing-staggered cocktail pilot (KB824 + SBP2@2 + ANB28)'
on conflict (entity_type, entity_id, field_name, citation_source_id) do nothing;

insert into curation_submissions (
  submission_type,
  status,
  submitted_by,
  reviewed_by,
  payload_json,
  review_notes
)
select
  'manual'::submission_type,
  'approved'::submission_status,
  'codex_seed',
  'codex_seed',
  jsonb_build_object(
    'batch', 'seed_curated_staph_v1',
    'record_count', 15,
    'notes', 'Staph-priority starter curation including unpublished kinetics/cocktail observations'
  ),
  'Initial curated dataset loaded via MCP-assisted setup'
where not exists (
  select 1
  from curation_submissions cs
  where cs.payload_json ->> 'batch' = 'seed_curated_staph_v1'
);

insert into audit_logs (
  actor_id,
  action,
  entity_type,
  diff_json
)
select
  'codex_seed',
  'seed_dataset_load',
  'curation_batch',
  jsonb_build_object(
    'batch', 'seed_curated_staph_v1',
    'source_count', 4,
    'phage_count', 15
  )
where not exists (
  select 1
  from audit_logs a
  where a.actor_id = 'codex_seed'
    and a.action = 'seed_dataset_load'
    and a.entity_type = 'curation_batch'
    and a.diff_json ->> 'batch' = 'seed_curated_staph_v1'
);

commit;
