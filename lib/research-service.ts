import { createSupabaseServerClient } from "@/lib/supabase";
import { listCocktails } from "@/lib/cocktail-service";

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function firstRelatedRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return (value.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined) ?? {};
  }
  return (value as Record<string, unknown> | null) ?? {};
}

function inferPathogenFromText(value: string): string {
  if (/Stenotrophomonas\s+maltophilia|S\.\s*maltophilia/i.test(value)) return "S_maltophilia";
  if (/Staphylococcus\s+aureus|S\.\s*aureus|MRSA/i.test(value)) return "S_aureus";
  if (/Escherichia\s+coli|E\.\s*coli/i.test(value)) return "E_coli";
  if (/Pseudomonas\s+aeruginosa|P\.\s*aeruginosa/i.test(value)) return "P_aeruginosa";
  return "unknown";
}


export async function listCocktailOutcomes(cocktailId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cocktail_experiment_results")
    .select(
      "id,outcome_metrics,resistance_emerged,observed_synergy,notes,host_strains(id,species,strain_identifier),experiments(id,experiment_date,conditions,assays(type)),paper_publish_links(citation_source_id,citation_sources(title,doi,url,year))"
    )
    .eq("cocktail_id", cocktailId);
  if (error) throw new Error(`Failed to load cocktail outcomes: ${error.message}`);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const strain = (row.host_strains as Record<string, unknown> | null) ?? {};
    const experiment = (row.experiments as Record<string, unknown> | null) ?? {};
    const assay = (experiment.assays as Record<string, unknown> | null) ?? {};
    const publishLinks = (row.paper_publish_links as Array<Record<string, unknown>> | null) ?? [];
    const firstPublish = publishLinks[0] ?? null;
    const citation = (firstPublish?.citation_sources as Record<string, unknown> | null) ?? null;
    return {
      id: String(row.id),
      strain: {
        id: typeof strain.id === "string" ? strain.id : null,
        species: typeof strain.species === "string" ? strain.species : null,
        strainIdentifier: typeof strain.strain_identifier === "string" ? strain.strain_identifier : null
      },
      experiment: {
        id: typeof experiment.id === "string" ? experiment.id : null,
        assayType: typeof assay.type === "string" ? assay.type : null,
        date: typeof experiment.experiment_date === "string" ? experiment.experiment_date : null,
        conditions:
          (experiment.conditions as Record<string, unknown> | null) ?? {}
      },
      outcomeMetrics:
        (row.outcome_metrics as Record<string, unknown> | null) ?? {},
      resistanceEmerged:
        typeof row.resistance_emerged === "boolean" ? row.resistance_emerged : null,
      observedSynergy: toNumber(row.observed_synergy),
      notes: typeof row.notes === "string" ? row.notes : null,
      citation: citation
        ? {
            title: typeof citation.title === "string" ? citation.title : null,
            doi: typeof citation.doi === "string" ? citation.doi : null,
            url: typeof citation.url === "string" ? citation.url : null,
            year: typeof citation.year === "number" ? citation.year : null
          }
        : null
    };
  });
}

export async function getCocktailGeneticDistanceSummary(cocktailId: string) {
  const supabase = createSupabaseServerClient();
  const components = await supabase
    .from("cocktail_component")
    .select("phage_id")
    .eq("cocktail_id", cocktailId);
  if (components.error) throw new Error(components.error.message);
  const phageIds = uniqueStrings(
    ((components.data ?? []) as Array<Record<string, unknown>>).map((row) =>
      typeof row.phage_id === "string" ? row.phage_id : ""
    )
  );
  if (phageIds.length < 2) {
    return {
      pairCount: 0,
      meanDistance: null,
      minDistance: null,
      maxDistance: null,
      distanceMetricBreakdown: {}
    };
  }

  const { data, error } = await supabase
    .from("genetic_relatedness")
    .select("distance_metric,distance_value,phage_a_id,phage_b_id")
    .in("phage_a_id", phageIds)
    .in("phage_b_id", phageIds);
  if (error) throw new Error(error.message);

  const values = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => toNumber(row.distance_value))
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return {
      pairCount: 0,
      meanDistance: null,
      minDistance: null,
      maxDistance: null,
      distanceMetricBreakdown: {}
    };
  }

  const breakdown: Record<string, number[]> = {};
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const metric = typeof row.distance_metric === "string" ? row.distance_metric : "other";
    const value = toNumber(row.distance_value);
    if (value === null) continue;
    if (!breakdown[metric]) breakdown[metric] = [];
    breakdown[metric].push(value);
  }

  const metricSummary = Object.fromEntries(
    Object.entries(breakdown).map(([metric, metricValues]) => [
      metric,
      {
        count: metricValues.length,
        mean: Number((metricValues.reduce((sum, item) => sum + item, 0) / metricValues.length).toFixed(4)),
        min: Number(Math.min(...metricValues).toFixed(4)),
        max: Number(Math.max(...metricValues).toFixed(4))
      }
    ])
  );

  return {
    pairCount: values.length,
    meanDistance: Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(4)),
    minDistance: Number(Math.min(...values).toFixed(4)),
    maxDistance: Number(Math.max(...values).toFixed(4)),
    distanceMetricBreakdown: metricSummary
  };
}

export async function getCocktailKineticsProfile(cocktailId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cocktail_component")
    .select("timing_role,phages(id,name)")
    .eq("cocktail_id", cocktailId);
  if (error) throw new Error(error.message);

  const roleCounts: Record<"early" | "semi_early" | "late" | "unknown", number> = {
    early: 0,
    semi_early: 0,
    late: 0,
    unknown: 0
  };
  const phagesByRole: Record<string, string[]> = {
    early: [],
    semi_early: [],
    late: [],
    unknown: []
  };

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const role =
      row.timing_role === "early" ||
      row.timing_role === "semi_early" ||
      row.timing_role === "late"
        ? row.timing_role
        : "unknown";
    roleCounts[role] += 1;
    const phage = (row.phages as Record<string, unknown> | null) ?? {};
    const name = typeof phage.name === "string" ? phage.name : "Unknown";
    phagesByRole[role].push(name);
  }

  return {
    roleCounts,
    phagesByRole
  };
}

export async function getStrainPhenotypes(strainId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("host_strains")
    .select("id,species,strain_name,strain_identifier,pigment,antibiotic_resistance_profile,lineage,metadata_json")
    .eq("id", strainId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id,
    species: data.species,
    strainName: data.strain_name,
    strainIdentifier: data.strain_identifier,
    lineage: data.lineage,
    pigment: data.pigment,
    antibioticResistanceProfile: data.antibiotic_resistance_profile ?? {},
    metadata: data.metadata_json ?? {}
  };
}

export async function getStrainMutations(strainId: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("strain_mutations")
    .select("id,parent_strain_id,mutation_calls,phenotype_changes,sequencing_meta,created_at")
    .eq("parent_strain_id", strainId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    parentStrainId: String(row.parent_strain_id),
    mutationCalls: row.mutation_calls ?? [],
    phenotypeChanges: row.phenotype_changes ?? {},
    sequencingMeta: row.sequencing_meta ?? {},
    createdAt: typeof row.created_at === "string" ? row.created_at : null
  }));
}

export async function getPhageHostRange(phageId: string, includeEvidence: boolean) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("host_range_assays")
    .select(
      "id,assay_method,outcome,moi,temperature_c,replicates,measurement_json,created_at,host_strains(id,species,strain_name,strain_identifier)"
    )
    .eq("phage_id", phageId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  let evidence: Array<Record<string, unknown>> = [];
  if (includeEvidence) {
    const evidenceQuery = await supabase
      .from("field_citations")
      .select("field_name,citation_sources(title,doi,url,year),evidence(level,confidence,comment)")
      .eq("entity_type", "phage")
      .eq("entity_id", phageId);
    if (!evidenceQuery.error) {
      evidence = (evidenceQuery.data ?? []) as Array<Record<string, unknown>>;
    }
  }

  return {
    assays: ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const strain = (row.host_strains as Record<string, unknown> | null) ?? {};
      return {
        id: String(row.id),
        assayMethod: typeof row.assay_method === "string" ? row.assay_method : "unknown",
        outcome: typeof row.outcome === "string" ? row.outcome : "unknown",
        moi: toNumber(row.moi),
        temperatureC: toNumber(row.temperature_c),
        replicates: toNumber(row.replicates),
        measurement: (row.measurement_json as Record<string, unknown> | null) ?? {},
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
        hostStrain: {
          id: typeof strain.id === "string" ? strain.id : null,
          species: typeof strain.species === "string" ? strain.species : null,
          strainName: typeof strain.strain_name === "string" ? strain.strain_name : null,
          strainIdentifier:
            typeof strain.strain_identifier === "string"
              ? strain.strain_identifier
              : null
        }
      };
    }),
    evidence: evidence.map((item) => {
      const citation = (item.citation_sources as Record<string, unknown> | null) ?? {};
      const evidenceItem = (item.evidence as Record<string, unknown> | null) ?? {};
      return {
        fieldName: typeof item.field_name === "string" ? item.field_name : "unknown",
        source: {
          title: typeof citation.title === "string" ? citation.title : null,
          doi: typeof citation.doi === "string" ? citation.doi : null,
          url: typeof citation.url === "string" ? citation.url : null,
          year: typeof citation.year === "number" ? citation.year : null
        },
        evidence: {
          level: typeof evidenceItem.level === "string" ? evidenceItem.level : null,
          confidence:
            typeof evidenceItem.confidence === "string" ? evidenceItem.confidence : null,
          comment: typeof evidenceItem.comment === "string" ? evidenceItem.comment : null
        }
      };
    })
  };
}

export async function searchCocktailEvidence(query: string, filters: { pathogen?: string; assay?: string }) {
  const supabase = createSupabaseServerClient();
  let sql = supabase
    .from("papers")
    .select("id,title,doi,pmid,pmcid,url,journal,year,pathogen_focus,paper_extractions(id,status,paper_extraction_rows(id,assay_type,outcome_metrics_json,evidence_location,confidence))")
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.pathogen) sql = sql.eq("pathogen_focus", filters.pathogen);
  const result = await sql;
  if (result.error) throw new Error(result.error.message);

  const q = query.trim().toLowerCase();
  const assayFilter = filters.assay?.trim().toLowerCase();

  return ((result.data ?? []) as Array<Record<string, unknown>>)
    .map((paper) => {
      const title = typeof paper.title === "string" ? paper.title : "";
      const extractions = (paper.paper_extractions as Array<Record<string, unknown>> | null) ?? [];
      const snippets: Array<Record<string, unknown>> = [];

      for (const extraction of extractions) {
        const rows =
          (extraction.paper_extraction_rows as Array<Record<string, unknown>> | null) ?? [];
        for (const row of rows) {
          const assay = typeof row.assay_type === "string" ? row.assay_type : "other";
          if (assayFilter && assay.toLowerCase() !== assayFilter) continue;
          const outcome = JSON.stringify(row.outcome_metrics_json ?? {}).toLowerCase();
          const evidence = typeof row.evidence_location === "string" ? row.evidence_location : "unknown";
          const hay = `${title} ${outcome} ${evidence}`.toLowerCase();
          if (q && !hay.includes(q)) continue;
          snippets.push({
            rowId: String(row.id),
            assayType: assay,
            outcomeMetrics: row.outcome_metrics_json ?? {},
            evidenceLocation: evidence,
            confidence: toNumber(row.confidence) ?? 0.5
          });
        }
      }

      const score = snippets.reduce((acc, item) => acc + (toNumber(item.confidence) ?? 0.5), 0);
      return {
        paperId: String(paper.id),
        title,
        doi: typeof paper.doi === "string" ? paper.doi : null,
        url: typeof paper.url === "string" ? paper.url : null,
        journal: typeof paper.journal === "string" ? paper.journal : null,
        year: typeof paper.year === "number" ? paper.year : null,
        score: Number(score.toFixed(3)),
        snippets
      };
    })
    .filter((item) => item.snippets.length > 0)
    .sort((a, b) => b.score - a.score);
}

export async function suggestCocktail(
  phagePool: string[],
  constraints: { pathogen?: string; assay?: string; minSize?: number; maxSize?: number }
) {
  const minSize = Math.max(2, constraints.minSize ?? 3);
  const maxSize = Math.max(minSize, constraints.maxSize ?? 5);
  const normalizedPool = uniqueStrings(phagePool);
  if (normalizedPool.length < minSize) {
    return {
      suggestions: [],
      warnings: ["Not enough phages in pool to build candidates."]
    };
  }

  const cocktails = await listCocktails({
    hostSpecies: constraints.pathogen ? constraints.pathogen.replace(/_/g, " ") : undefined,
    sort: "created_desc",
    limit: 200
  });
  const existingOutcomes = cocktails.data;
  const poolSet = new Set(normalizedPool.map((item) => item.toLowerCase()));
  const matched = existingOutcomes
    .filter((row) => row.phageNames.some((name) => poolSet.has(name.toLowerCase())))
    .slice(0, 20);

  const suggestions = matched.map((row) => {
    const inPool = row.phageNames.filter((name) => poolSet.has(name.toLowerCase()));
    const suggestedMembers = uniqueStrings(inPool).slice(0, maxSize);
    return {
      basedOnCocktailId: row.id,
      basedOnCocktailName: row.name,
      suggestedMembers,
      rationale: {
        overlapCount: inPool.length,
        timingRoles: row.timingRoles,
        resistanceEmergenceSignals: row.resistanceEmergenceSignals,
        targetSpecies: row.targetSpecies
      }
    };
  });

  return {
    suggestions,
    warnings:
      suggestions.length === 0
        ? ["No close historical cocktail overlap found for this phage pool."]
        : []
  };
}

export function analyzeVariableImportance(datasetSlice: Array<Record<string, unknown>>) {
  const numericMetrics: Record<string, number[]> = {};
  const categoricalMetrics: Record<string, Record<string, number>> = {};

  for (const row of datasetSlice) {
    for (const [key, value] of Object.entries(row)) {
      const numeric = toNumber(value);
      if (numeric !== null) {
        if (!numericMetrics[key]) numericMetrics[key] = [];
        numericMetrics[key].push(numeric);
        continue;
      }

      if (typeof value === "string") {
        if (!categoricalMetrics[key]) categoricalMetrics[key] = {};
        categoricalMetrics[key][value] = (categoricalMetrics[key][value] ?? 0) + 1;
      }
    }
  }

  const numericSummary = Object.fromEntries(
    Object.entries(numericMetrics).map(([key, values]) => {
      const count = values.length;
      const mean = values.reduce((sum, item) => sum + item, 0) / Math.max(1, count);
      const variance =
        values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / Math.max(1, count);
      return [
        key,
        {
          count,
          mean: Number(mean.toFixed(4)),
          stddev: Number(Math.sqrt(variance).toFixed(4)),
          min: Number(Math.min(...values).toFixed(4)),
          max: Number(Math.max(...values).toFixed(4))
        }
      ];
    })
  );

  const categoricalSummary = Object.fromEntries(
    Object.entries(categoricalMetrics).map(([key, valueMap]) => [
      key,
      Object.entries(valueMap)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count }))
    ])
  );

  return {
    rowCount: datasetSlice.length,
    numericSummary,
    categoricalSummary,
    warnings: [
      "Descriptive statistics only; no causal inference.",
      "Interpret feature importance with assay and condition context."
    ]
  };
}

export async function listPublishedPaperOutcomes(filters: {
  pathogen?: string;
  assay?: string;
  requiresQuant?: boolean;
}) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("paper_publish_links")
    .select(
      "id,paper_row_id,cocktail_id,experiment_id,result_id,citation_source_id,paper_extraction_rows(pathogen,assay_type,outcome_metrics_json,evidence_location),cocktails(name),experiments(assays(type),conditions),cocktail_experiment_results(outcome_metrics,resistance_emerged),citation_sources(title,doi,url,year)"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const pathogen = filters.pathogen?.trim().toLowerCase() ?? "";
  const assay = filters.assay?.trim().toLowerCase() ?? "";

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const paperRow = firstRelatedRecord(row.paper_extraction_rows);
      const cocktail = firstRelatedRecord(row.cocktails);
      const experiment = firstRelatedRecord(row.experiments);
      const assayRow = firstRelatedRecord(experiment.assays);
      const result = firstRelatedRecord(row.cocktail_experiment_results);
      const citation = firstRelatedRecord(row.citation_sources);
      const outcome =
        (result.outcome_metrics as Record<string, unknown> | null) ??
        (paperRow.outcome_metrics_json as Record<string, unknown> | null) ??
        {};
      const citationText = `${String(citation.title ?? "")} ${String(citation.url ?? "")} ${String(
        outcome.supporting_snippet ?? outcome.qualitative_summary ?? ""
      )}`;
      const inferredPathogen = inferPathogenFromText(citationText);

      return {
        publishLinkId: String(row.id),
        cocktailId: typeof row.cocktail_id === "string" ? row.cocktail_id : null,
        cocktailName: typeof cocktail.name === "string" ? cocktail.name : "Unknown cocktail",
        pathogen:
          typeof paperRow.pathogen === "string" ? paperRow.pathogen : inferredPathogen,
        assayType:
          typeof assayRow.type === "string"
            ? assayRow.type
            : typeof paperRow.assay_type === "string"
              ? paperRow.assay_type
              : "unknown",
        outcomeMetrics: outcome,
        resistanceEmerged:
          typeof result.resistance_emerged === "boolean"
            ? result.resistance_emerged
            : null,
        evidenceLocation:
          typeof paperRow.evidence_location === "string"
            ? paperRow.evidence_location
            : typeof outcome.supporting_snippet === "string"
              ? outcome.supporting_snippet
              : null,
        citation: {
          title: typeof citation.title === "string" ? citation.title : null,
          doi: typeof citation.doi === "string" ? citation.doi : null,
          url: typeof citation.url === "string" ? citation.url : null,
          year: typeof citation.year === "number" ? citation.year : null
        }
      };
    })
    .filter((row) => {
      if (pathogen && !row.pathogen.toLowerCase().includes(pathogen)) return false;
      if (assay && !row.assayType.toLowerCase().includes(assay)) return false;
      if (filters.requiresQuant) {
        const hasQuant = Object.values(row.outcomeMetrics).some((value) => toNumber(value) !== null);
        if (!hasQuant) return false;
      }
      return true;
    });
}

export async function listResearchFactorMatrix(filters: {
  pathogen?: string;
  factorType?: string;
  includeUnpublished?: boolean;
}) {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("paper_extraction_factor_rows")
    .select(
      "id,factor_type,pathogen,host_species,host_strain_raw,phage_names_json,phage_accessions_json,assay_type,conditions_json,measurements_json,outcome_role,evidence_location,confidence,needs_review,published_at,created_at,paper_extractions(id,papers(title,doi,pmid,pmcid,url,journal,year))"
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (filters.pathogen) query = query.eq("pathogen", filters.pathogen);
  if (filters.factorType) query = query.eq("factor_type", filters.factorType);
  if (!filters.includeUnpublished) query = query.not("published_at", "is", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const extraction = firstRelatedRecord(row.paper_extractions);
    const paper = firstRelatedRecord(extraction.papers);
    const measurements = (row.measurements_json as Record<string, unknown> | null) ?? {};
    const conditions = (row.conditions_json as Record<string, unknown> | null) ?? {};
    const phageNames = Array.isArray(row.phage_names_json)
      ? row.phage_names_json.map((item) => String(item))
      : [];
    const phageAccessions = Array.isArray(row.phage_accessions_json)
      ? row.phage_accessions_json.map((item) => String(item))
      : [];

    return {
      factorRowId: String(row.id),
      factorType: typeof row.factor_type === "string" ? row.factor_type : "unknown",
      pathogen: typeof row.pathogen === "string" ? row.pathogen : "unknown",
      hostSpecies: typeof row.host_species === "string" ? row.host_species : null,
      hostStrainRaw: typeof row.host_strain_raw === "string" ? row.host_strain_raw : null,
      phageNames,
      phageAccessions,
      phageCount: phageNames.length || phageAccessions.length,
      assayType: typeof row.assay_type === "string" ? row.assay_type : null,
      outcomeRole: typeof row.outcome_role === "string" ? row.outcome_role : null,
      conditions,
      measurements,
      numericMeasurements: Object.fromEntries(
        Object.entries(measurements)
          .map(([key, value]) => [key, toNumber(value)])
          .filter((entry): entry is [string, number] => entry[1] !== null)
      ),
      evidenceLocation: typeof row.evidence_location === "string" ? row.evidence_location : null,
      confidence: toNumber(row.confidence) ?? 0.5,
      needsReview: row.needs_review !== false,
      publishedAt: typeof row.published_at === "string" ? row.published_at : null,
      citation: {
        title: typeof paper.title === "string" ? paper.title : null,
        doi: typeof paper.doi === "string" ? paper.doi : null,
        pmid: typeof paper.pmid === "string" ? paper.pmid : null,
        pmcid: typeof paper.pmcid === "string" ? paper.pmcid : null,
        url: typeof paper.url === "string" ? paper.url : null,
        journal: typeof paper.journal === "string" ? paper.journal : null,
        year: typeof paper.year === "number" ? paper.year : null
      }
    };
  });
}
