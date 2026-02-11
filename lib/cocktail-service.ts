import { createSupabaseServerClient } from "@/lib/supabase";
import type {
  CocktailDetail,
  CocktailListFilters,
  CocktailListItem,
  CocktailListResult,
  CocktailSummary
} from "@/types/cocktail";

const DEFAULT_LIMIT = 20;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizePathogenNeedle(value: string): string {
  const normalized = value.toLowerCase().replace(/_/g, " ").trim();
  if (normalized === "s aureus" || normalized === "s. aureus" || normalized === "s_aureus") {
    return "staphylococcus aureus";
  }
  return normalized;
}

function normalizeTimingRole(
  value: string
): "early" | "semi_early" | "late" | "unknown" {
  if (value === "early" || value === "semi_early" || value === "late") {
    return value;
  }
  return "unknown";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapCocktailListRow(row: Record<string, unknown>): CocktailListItem {
  const componentRows =
    (row.cocktail_component as Array<Record<string, unknown>> | null) ?? [];
  const resultRows =
    (row.cocktail_experiment_results as Array<Record<string, unknown>> | null) ?? [];

  const phageNames = uniqueStrings(
    componentRows
      .map((component) => {
        const phage = component.phages as Record<string, unknown> | null;
        return typeof phage?.name === "string" ? phage.name : "";
      })
      .filter(Boolean)
  );

  const timingRoles = uniqueStrings(
    componentRows.map((component) =>
      normalizeTimingRole(
        typeof component.timing_role === "string" ? component.timing_role : "unknown"
      )
    )
  ) as Array<"early" | "semi_early" | "late" | "unknown">;

  const targetSpecies = uniqueStrings(
    resultRows
      .map((result) => {
        const strain = result.host_strains as Record<string, unknown> | null;
        return typeof strain?.species === "string" ? strain.species : "";
      })
      .filter(Boolean)
  );

  const resistanceEmergenceSignals = resultRows.filter(
    (result) => result.resistance_emerged === true
  ).length;

  return {
    id: String(row.id),
    name: String(row.name),
    intent: typeof row.intent === "string" ? row.intent : null,
    designRationale:
      typeof row.design_rationale === "string" ? row.design_rationale : null,
    createdBy: typeof row.created_by === "string" ? row.created_by : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    componentCount: componentRows.length,
    phageNames,
    timingRoles,
    resultCount: resultRows.length,
    resistanceEmergenceSignals,
    targetSpecies
  };
}

export async function listCocktails(
  filters: CocktailListFilters = {}
): Promise<CocktailListResult> {
  const supabase = createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.max(1, Math.min(100, filters.limit ?? DEFAULT_LIMIT));
  const q = filters.q?.trim().toLowerCase() ?? "";
  const intent = filters.intent?.trim().toLowerCase() ?? "";
  const hostSpecies = filters.hostSpecies?.trim().toLowerCase() ?? "";
  const pathogen = normalizePathogenNeedle(filters.pathogen ?? "");
  const assay = filters.assay?.trim().toLowerCase() ?? "";

  const { data, error } = await supabase.from("cocktails").select(`
      id,
      name,
      intent,
      design_rationale,
      created_by,
      created_at,
      cocktail_component(
        timing_role,
        phages(name)
      ),
      cocktail_experiment_results(
        resistance_emerged,
        host_strains(species)
      )
    `);

  if (error) {
    throw new Error(`Failed to load cocktails: ${error.message}`);
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(mapCocktailListRow);
  let assayAllowedCocktailIds: Set<string> | null = null;

  if (assay) {
    const assayRows = await supabase
      .from("cocktail_experiment_results")
      .select("cocktail_id,experiments(assays(type))");
    if (assayRows.error) {
      throw new Error(`Failed to load assay filter context: ${assayRows.error.message}`);
    }
    assayAllowedCocktailIds = new Set(
      ((assayRows.data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => {
          const experiment = (row.experiments as Record<string, unknown> | null) ?? {};
          const assayRow = (experiment.assays as Record<string, unknown> | null) ?? {};
          const type = typeof assayRow.type === "string" ? assayRow.type.toLowerCase() : "";
          return type.includes(assay);
        })
        .map((row) => String(row.cocktail_id))
    );
  }

  const filtered = rows.filter((row) => {
    if (q) {
      const haystack = `${row.name} ${row.designRationale ?? ""} ${row.phageNames.join(" ")}`
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    if (intent && !(row.intent ?? "").toLowerCase().includes(intent)) {
      return false;
    }

    if (hostSpecies) {
      if (!row.targetSpecies.some((species) => species.toLowerCase().includes(hostSpecies))) {
        return false;
      }
    }

    if (pathogen) {
      if (!row.targetSpecies.some((species) => species.toLowerCase().includes(pathogen))) {
        return false;
      }
    }

    if (assayAllowedCocktailIds && !assayAllowedCocktailIds.has(row.id)) {
      return false;
    }

    if (typeof filters.resistanceEmerged === "boolean") {
      const hasResistance = row.resistanceEmergenceSignals > 0;
      if (hasResistance !== filters.resistanceEmerged) return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (filters.sort === "name_desc") return b.name.localeCompare(a.name);
    if (filters.sort === "created_desc") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return a.name.localeCompare(b.name);
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;

  return {
    data: sorted.slice(start, start + limit),
    total,
    page,
    limit,
    totalPages
  };
}

export async function getCocktailById(id: string): Promise<CocktailDetail | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cocktails")
    .select(
      "id,name,intent,design_rationale,created_by,created_at,updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load cocktail: ${error.message}`);
  }
  if (!data) return null;

  const [componentResult, resultResult] = await Promise.all([
    supabase
      .from("cocktail_component")
      .select(
        "id,ratio,dose_pfu,timing_role,component_notes,phages(id,name,genome_accession,host_primary_taxon)"
      )
      .eq("cocktail_id", id),
    supabase
      .from("cocktail_experiment_results")
      .select(
        "id,outcome_metrics,resistance_emerged,observed_synergy,notes,host_strains(id,species,strain_identifier),experiments(id,experiment_date,conditions,assays(type))"
      )
      .eq("cocktail_id", id)
  ]);

  if (componentResult.error) throw new Error(componentResult.error.message);
  if (resultResult.error) throw new Error(resultResult.error.message);

  const components = ((componentResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const phage = (row.phages as Record<string, unknown> | null) ?? {};
      return {
        id: String(row.id),
        phageId: typeof phage.id === "string" ? phage.id : "",
        phageName: typeof phage.name === "string" ? phage.name : "Unknown phage",
        genomeAccession:
          typeof phage.genome_accession === "string" ? phage.genome_accession : null,
        hostPrimaryTaxon:
          typeof phage.host_primary_taxon === "string"
            ? phage.host_primary_taxon
            : null,
        timingRole: normalizeTimingRole(
          typeof row.timing_role === "string" ? row.timing_role : "unknown"
        ),
        ratio: toNumber(row.ratio),
        dosePfu: toNumber(row.dose_pfu),
        componentNotes:
          typeof row.component_notes === "string" ? row.component_notes : null
      };
    }
  );

  const results = ((resultResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const strain = (row.host_strains as Record<string, unknown> | null) ?? {};
    const experiment = (row.experiments as Record<string, unknown> | null) ?? {};
    const assay = (experiment.assays as Record<string, unknown> | null) ?? {};
    return {
      id: String(row.id),
      strain: {
        id: typeof strain.id === "string" ? strain.id : null,
        species: typeof strain.species === "string" ? strain.species : null,
        strainIdentifier:
          typeof strain.strain_identifier === "string" ? strain.strain_identifier : null
      },
      experiment: {
        id: typeof experiment.id === "string" ? experiment.id : null,
        assayType: typeof assay.type === "string" ? assay.type : null,
        date:
          typeof experiment.experiment_date === "string"
            ? experiment.experiment_date
            : null,
        conditions:
          (experiment.conditions as Record<string, unknown> | null) ?? {}
      },
      outcomeMetrics:
        (row.outcome_metrics as Record<string, unknown> | null) ?? {},
      resistanceEmerged:
        typeof row.resistance_emerged === "boolean" ? row.resistance_emerged : null,
      observedSynergy: toNumber(row.observed_synergy),
      notes: typeof row.notes === "string" ? row.notes : null
    };
  });

  return {
    id: data.id,
    name: data.name,
    intent: data.intent,
    designRationale: data.design_rationale,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    components,
    results
  };
}

async function getCount(table: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase.from(table).select("*", {
    count: "exact",
    head: true
  });

  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return count ?? 0;
}

export async function getCocktailSummary(): Promise<CocktailSummary> {
  const [cocktailCount, componentCount, resultCount, assayCount] = await Promise.all([
    getCount("cocktails"),
    getCount("cocktail_component"),
    getCount("cocktail_experiment_results"),
    getCount("assays")
  ]);

  return {
    cocktailCount,
    componentCount,
    resultCount,
    assayCount
  };
}
