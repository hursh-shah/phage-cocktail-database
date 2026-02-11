export type CocktailListItem = {
  id: string;
  name: string;
  intent: string | null;
  designRationale: string | null;
  createdBy: string | null;
  createdAt: string;
  componentCount: number;
  phageNames: string[];
  timingRoles: Array<"early" | "semi_early" | "late" | "unknown">;
  resultCount: number;
  resistanceEmergenceSignals: number;
  targetSpecies: string[];
};

export type CocktailListFilters = {
  q?: string;
  intent?: string;
  hostSpecies?: string;
  pathogen?: string;
  assay?: string;
  resistanceEmerged?: boolean;
  page?: number;
  limit?: number;
  sort?: "name_asc" | "name_desc" | "created_desc";
};

export type CocktailListResult = {
  data: CocktailListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type CocktailComponentDetail = {
  id: string;
  phageId: string;
  phageName: string;
  genomeAccession: string | null;
  hostPrimaryTaxon: string | null;
  timingRole: "early" | "semi_early" | "late" | "unknown";
  ratio: number | null;
  dosePfu: number | null;
  componentNotes: string | null;
};

export type CocktailResultDetail = {
  id: string;
  strain: {
    id: string | null;
    species: string | null;
    strainIdentifier: string | null;
  };
  experiment: {
    id: string | null;
    assayType: string | null;
    date: string | null;
    conditions: Record<string, unknown>;
  };
  outcomeMetrics: Record<string, unknown>;
  resistanceEmerged: boolean | null;
  observedSynergy: number | null;
  notes: string | null;
};

export type CocktailDetail = {
  id: string;
  name: string;
  intent: string | null;
  designRationale: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  components: CocktailComponentDetail[];
  results: CocktailResultDetail[];
};

export type CocktailSummary = {
  cocktailCount: number;
  componentCount: number;
  resultCount: number;
  assayCount: number;
};

export type UploadIngestSummary = {
  sourceFilename: string;
  delimiter: "csv" | "tsv";
  totalRows: number;
  validRows: number;
  upsertedRows: number;
  skippedRows: number;
  sampleWarnings: string[];
};
