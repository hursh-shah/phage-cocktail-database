import { createSupabaseServerClient } from "@/lib/supabase";
import type {
  DatasetSummary,
  ListFilters,
  PhageDetail,
  PhageListItem,
  PhageListResult,
  StageLabel
} from "@/types/phage";

const DEFAULT_LIMIT = 20;
const QUERY_CHUNK_SIZE = 400;
const QUERY_RETRY_COUNT = 2;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toStage(value: string): StageLabel {
  if (value === "early" || value === "semi_early" || value === "late") {
    return value;
  }
  return "unknown";
}

function isMissingRelationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("relation")
  );
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function runQueryWithRetry<T>(
  run: () => Promise<{ data: T | null; error: { message: string } | null }>
): Promise<{ data: T | null; error: { message: string } | null }> {
  let attempt = 0;
  let last: { data: T | null; error: { message: string } | null } | null = null;

  while (attempt <= QUERY_RETRY_COUNT) {
    last = await run();
    const message = last.error?.message.toLowerCase() ?? "";
    if (!last.error || !message.includes("fetch failed")) {
      return last;
    }
    attempt += 1;
    if (attempt <= QUERY_RETRY_COUNT) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
  }

  return last ?? { data: null, error: { message: "Unknown query failure" } };
}

function mapListRow(row: Record<string, unknown>): PhageListItem {
  const tagRows = (row.phage_tags as Array<Record<string, unknown>> | null) ?? [];
  const kineticsRows =
    (row.kinetics_observations as Array<Record<string, unknown>> | null) ?? [];
  const assayRows =
    (row.host_range_assays as Array<Record<string, unknown>> | null) ?? [];

  const tags = uniqueStrings(
    tagRows
      .map((tagRow) => {
        const tag = tagRow.tags as Record<string, unknown> | null;
        return typeof tag?.value === "string" ? tag.value : "";
      })
      .filter(Boolean)
  );

  const hostSpecies = uniqueStrings(
    assayRows
      .map((assay) => {
        const host = assay.host_strains as Record<string, unknown> | null;
        return typeof host?.species === "string" ? host.species : "";
      })
      .filter(Boolean)
  );

  const stageLabels = uniqueStrings(
    kineticsRows.map((kinetics) =>
      toStage(typeof kinetics.stage_label === "string" ? kinetics.stage_label : "unknown")
    )
  ) as StageLabel[];

  const evidenceLevels =
    ((row._evidence_levels as string[] | undefined) ?? []) as Array<
      "peer_reviewed" | "preprint" | "unpublished_comm"
    >;

  return {
    id: String(row.id),
    name: String(row.name),
    createdAt:
      typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    genomeAccession:
      typeof row.genome_accession === "string" ? row.genome_accession : null,
    taxonomyFamily: typeof row.taxonomy_family === "string" ? row.taxonomy_family : null,
    taxonomyGenus: typeof row.taxonomy_genus === "string" ? row.taxonomy_genus : null,
    hostPrimaryTaxon:
      typeof row.host_primary_taxon === "string" ? row.host_primary_taxon : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    tags,
    hostSpecies,
    stageLabels,
    hasCocktailData: row._has_cocktail_data === true,
    evidenceLevels
  };
}

export async function listPhages(filters: ListFilters = {}): Promise<PhageListResult> {
  const supabase = createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.max(1, Math.min(100, filters.limit ?? DEFAULT_LIMIT));
  const normalizedQuery = filters.q?.trim().toLowerCase() ?? "";
  const normalizedTags = (filters.tags ?? []).map((tag) => tag.toLowerCase());

  const { data, error } = await supabase.from("phages").select(`
      id,
      name,
      genome_accession,
      taxonomy_family,
      taxonomy_genus,
      host_primary_taxon,
      notes,
      created_at,
      phage_tags(tags(value)),
      kinetics_observations(stage_label),
      host_range_assays(outcome,host_strains(species))
    `);

  if (error) {
    throw new Error(`Failed to load phages: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const phageIds = rows.map((row) => String(row.id));
  const evidenceByPhageId = new Map<string, Array<"peer_reviewed" | "preprint" | "unpublished_comm">>();
  const cocktailPhageIds = new Set<string>();
  const shouldLoadEvidence = Boolean(filters.evidenceLevel);
  const shouldLoadCocktailFlags = typeof filters.hasCocktailData === "boolean" || rows.length <= 1200;
  let evidenceLoadFailed = false;

  if (phageIds.length > 0) {
    if (shouldLoadEvidence) {
      for (const idChunk of chunkValues(phageIds, QUERY_CHUNK_SIZE)) {
        const { data: citationRows, error: citationError } = await runQueryWithRetry(
          async () =>
            await supabase
              .from("field_citations")
              .select("entity_id,evidence(level)")
              .eq("entity_type", "phage")
              .in("entity_id", idChunk)
        );

        if (citationError) {
          evidenceLoadFailed = true;
          break;
        }

        for (const citationRow of (citationRows ?? []) as Array<Record<string, unknown>>) {
          const phageId =
            typeof citationRow.entity_id === "string" ? citationRow.entity_id : "";
          if (!phageId) continue;

          const evidence = citationRow.evidence as Record<string, unknown> | null;
          const level = typeof evidence?.level === "string" ? evidence.level : "";
          if (!level) continue;

          const existing = evidenceByPhageId.get(phageId) ?? [];
          if (!existing.includes(level as "peer_reviewed" | "preprint" | "unpublished_comm")) {
            existing.push(level as "peer_reviewed" | "preprint" | "unpublished_comm");
          }
          evidenceByPhageId.set(phageId, existing);
        }
      }
    }

    const loadCocktailPhageIds = async (table: string) => {
      for (const idChunk of chunkValues(phageIds, QUERY_CHUNK_SIZE)) {
        const { data: cocktailRows, error: cocktailError } = await runQueryWithRetry(
          async () =>
            await supabase
              .from(table)
              .select("phage_id")
              .in("phage_id", idChunk)
        );

        if (cocktailError) {
          if (isMissingRelationError(cocktailError.message)) {
            return;
          }
          if (cocktailError.message.toLowerCase().includes("fetch failed")) {
            return;
          }
          throw new Error(`Failed to load ${table}: ${cocktailError.message}`);
        }

        for (const row of (cocktailRows ?? []) as Array<Record<string, unknown>>) {
          const phageId = typeof row.phage_id === "string" ? row.phage_id : "";
          if (phageId) cocktailPhageIds.add(phageId);
        }
      }
    };

    if (shouldLoadCocktailFlags) {
      await Promise.all([
        loadCocktailPhageIds("cocktail_components"),
        loadCocktailPhageIds("cocktail_component")
      ]);
    }
  }

  const mapped = rows.map((row) =>
    mapListRow({
      ...row,
      _evidence_levels: evidenceByPhageId.get(String(row.id)) ?? [],
      _has_cocktail_data: cocktailPhageIds.has(String(row.id))
    })
  );

  if (shouldLoadEvidence && evidenceLoadFailed) {
    return {
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 1
    };
  }

  const filtered = mapped.filter((row) => {
    if (normalizedQuery) {
      const content = `${row.name} ${row.genomeAccession ?? ""} ${row.notes ?? ""}`.toLowerCase();
      if (!content.includes(normalizedQuery)) {
        return false;
      }
    }

    if (filters.hostSpecies) {
      const hostNeedle = filters.hostSpecies.toLowerCase();
      if (!row.hostSpecies.some((species) => species.toLowerCase().includes(hostNeedle))) {
        return false;
      }
    }

    if (filters.stageLabel && !row.stageLabels.includes(filters.stageLabel)) {
      return false;
    }

    if (normalizedTags.length > 0) {
      const rowTags = row.tags.map((tag) => tag.toLowerCase());
      if (!normalizedTags.every((tag) => rowTags.includes(tag))) {
        return false;
      }
    }

    if (typeof filters.hasCocktailData === "boolean" && row.hasCocktailData !== filters.hasCocktailData) {
      return false;
    }

    if (filters.evidenceLevel && !row.evidenceLevels.includes(filters.evidenceLevel)) {
      return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (filters.sort === "name_desc") {
      return b.name.localeCompare(a.name);
    }
    if (filters.sort === "created_desc") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return a.name.localeCompare(b.name);
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startIndex = (page - 1) * limit;
  const paginated = sorted.slice(startIndex, startIndex + limit);

  return {
    data: paginated,
    total,
    page,
    limit,
    totalPages
  };
}

export async function getPhageById(id: string): Promise<PhageDetail | null> {
  const supabase = createSupabaseServerClient();

  const { data: phageRow, error: phageError } = await supabase
    .from("phages")
    .select(
      "id,name,genome_accession,genome_length_bp,gc_content,taxonomy_family,taxonomy_genus,host_primary_taxon,notes,created_at,updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (phageError) {
    throw new Error(`Failed to load phage: ${phageError.message}`);
  }

  if (!phageRow) {
    return null;
  }

  const [
    tagResult,
    assayResult,
    kineticsResult,
    cocktailLegacyResult,
    cocktailResult,
    citationResult
  ] = await Promise.all([
    supabase.from("phage_tags").select("tags(value)").eq("phage_id", id),
    supabase
      .from("host_range_assays")
      .select(
        "id,assay_method,outcome,moi,temperature_c,replicates,measurement_json,host_strains(species,strain_name,strain_identifier)"
      )
      .eq("phage_id", id),
    supabase
      .from("kinetics_observations")
      .select("id,stage_label,metric_type,metric_value,metric_unit,context")
      .eq("phage_id", id),
    supabase
      .from("cocktail_components")
      .select(
        "cocktail_experiment_id,timing_role,component_notes,cocktail_experiments(id,name,target_bacterium,outcome_summary)"
      )
      .eq("phage_id", id),
    supabase
      .from("cocktail_component")
      .select("cocktail_id,timing_role,component_notes,cocktails(id,name,intent,design_rationale)")
      .eq("phage_id", id),
    supabase
      .from("field_citations")
      .select(
        "id,field_name,citation_sources(title,year,source_type,url,doi),evidence(level,confidence,comment)"
      )
      .eq("entity_type", "phage")
      .eq("entity_id", id)
  ]);

  if (tagResult.error) throw new Error(tagResult.error.message);
  if (assayResult.error) throw new Error(assayResult.error.message);
  if (kineticsResult.error) throw new Error(kineticsResult.error.message);
  if (cocktailLegacyResult.error && !isMissingRelationError(cocktailLegacyResult.error.message)) {
    throw new Error(cocktailLegacyResult.error.message);
  }
  if (cocktailResult.error && !isMissingRelationError(cocktailResult.error.message)) {
    throw new Error(cocktailResult.error.message);
  }
  if (citationResult.error) throw new Error(citationResult.error.message);

  const tags = uniqueStrings(
    ((tagResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const tag = row.tags as Record<string, unknown> | null;
      return typeof tag?.value === "string" ? tag.value : "";
    })
  );

  const hostRangeAssays = ((assayResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const host = (row.host_strains as Record<string, unknown> | null) ?? {};
      return {
        id: String(row.id),
        assayMethod: String(row.assay_method),
        outcome: String(row.outcome) as "susceptible" | "resistant" | "partial" | "unknown",
        moi: typeof row.moi === "number" ? row.moi : null,
        temperatureC: typeof row.temperature_c === "number" ? row.temperature_c : null,
        replicates: typeof row.replicates === "number" ? row.replicates : null,
        measurement: (row.measurement_json as Record<string, unknown> | null) ?? {},
        hostStrain: {
          species: typeof host.species === "string" ? host.species : "Unknown host",
          strainName: typeof host.strain_name === "string" ? host.strain_name : null,
          strainIdentifier:
            typeof host.strain_identifier === "string" ? host.strain_identifier : null
        }
      };
    }
  );

  const kineticsObservations = (
    (kineticsResult.data ?? []) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    stageLabel: toStage(typeof row.stage_label === "string" ? row.stage_label : "unknown"),
    metricType: String(row.metric_type),
    metricValue: typeof row.metric_value === "number" ? row.metric_value : null,
    metricUnit: typeof row.metric_unit === "string" ? row.metric_unit : null,
    context: typeof row.context === "string" ? row.context : null
  }));

  const legacyCocktails = ((cocktailLegacyResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const experiment =
        (row.cocktail_experiments as Record<string, unknown> | null) ?? {};
      return {
        experimentId:
          typeof experiment.id === "string"
            ? experiment.id
            : String(row.cocktail_experiment_id),
        experimentName:
          typeof experiment.name === "string" ? experiment.name : "Unknown experiment",
        targetBacterium:
          typeof experiment.target_bacterium === "string"
            ? experiment.target_bacterium
            : null,
        outcomeSummary:
          typeof experiment.outcome_summary === "string"
            ? experiment.outcome_summary
            : null,
        timingRole: String(row.timing_role) as
          | "early"
          | "semi_early"
          | "late"
          | "unknown",
        componentNotes:
          typeof row.component_notes === "string" ? row.component_notes : null
      };
    });

  const newCocktails = ((cocktailResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const cocktail = (row.cocktails as Record<string, unknown> | null) ?? {};
      const designRationale =
        typeof cocktail.design_rationale === "string"
          ? cocktail.design_rationale
          : null;
      const intent = typeof cocktail.intent === "string" ? cocktail.intent : null;
      return {
        experimentId:
          typeof cocktail.id === "string" ? cocktail.id : String(row.cocktail_id),
        experimentName:
          typeof cocktail.name === "string" ? cocktail.name : "Unknown cocktail",
        targetBacterium: null,
        outcomeSummary: designRationale ?? intent,
        timingRole: String(row.timing_role) as
          | "early"
          | "semi_early"
          | "late"
          | "unknown",
        componentNotes:
          typeof row.component_notes === "string" ? row.component_notes : null
      };
    }
  );

  const cocktails = [...legacyCocktails, ...newCocktails].filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.experimentId === item.experimentId &&
          candidate.timingRole === item.timingRole
      ) === index
  );

  const citations = ((citationResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const source =
        (row.citation_sources as Record<string, unknown> | null) ?? {};
      const evidence = (row.evidence as Record<string, unknown> | null) ?? null;
      return {
        id: String(row.id),
        fieldName: String(row.field_name),
        source: {
          title: typeof source.title === "string" ? source.title : "Untitled source",
          year: typeof source.year === "number" ? source.year : null,
          sourceType: typeof source.source_type === "string" ? source.source_type : "dataset",
          url: typeof source.url === "string" ? source.url : null,
          doi: typeof source.doi === "string" ? source.doi : null
        },
        evidence: evidence
          ? {
              level:
                (typeof evidence.level === "string"
                  ? evidence.level
                  : "peer_reviewed") as "peer_reviewed" | "preprint" | "unpublished_comm",
              confidence:
                (typeof evidence.confidence === "string"
                  ? evidence.confidence
                  : "medium") as "high" | "medium" | "low",
              comment: typeof evidence.comment === "string" ? evidence.comment : null
            }
          : null
      };
    }
  );

  return {
    id: phageRow.id,
    name: phageRow.name,
    genomeAccession: phageRow.genome_accession,
    genomeLengthBp: phageRow.genome_length_bp,
    gcContent:
      typeof phageRow.gc_content === "number" ? phageRow.gc_content : null,
    taxonomyFamily: phageRow.taxonomy_family,
    taxonomyGenus: phageRow.taxonomy_genus,
    hostPrimaryTaxon: phageRow.host_primary_taxon,
    notes: phageRow.notes,
    createdAt: phageRow.created_at,
    updatedAt: phageRow.updated_at,
    tags,
    hostRangeAssays,
    kineticsObservations,
    cocktails,
    citations
  };
}

async function getTableCount(table: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase.from(table).select("*", {
    count: "exact",
    head: true
  });

  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

export async function getDatasetSummary(): Promise<DatasetSummary> {
  const [phageCount, assayCount, kineticsCount, citationCount] = await Promise.all([
    getTableCount("phages"),
    getTableCount("host_range_assays"),
    getTableCount("kinetics_observations"),
    getTableCount("citation_sources")
  ]);

  let cocktailCount = 0;
  try {
    cocktailCount = await getTableCount("cocktails");
  } catch (error) {
    if (error instanceof Error && isMissingRelationError(error.message)) {
      cocktailCount = await getTableCount("cocktail_experiments");
    } else {
      throw error;
    }
  }

  return {
    phageCount,
    assayCount,
    kineticsCount,
    cocktailCount,
    citationCount
  };
}
