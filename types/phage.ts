export type EvidenceLevel = "peer_reviewed" | "preprint" | "unpublished_comm";
export type StageLabel = "early" | "semi_early" | "late" | "unknown";

export type PhageListItem = {
  id: string;
  name: string;
  createdAt: string;
  genomeAccession: string | null;
  taxonomyFamily: string | null;
  taxonomyGenus: string | null;
  hostPrimaryTaxon: string | null;
  notes: string | null;
  tags: string[];
  hostSpecies: string[];
  stageLabels: StageLabel[];
  hasCocktailData: boolean;
  evidenceLevels: EvidenceLevel[];
};

export type PhageListResult = {
  data: PhageListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type ListFilters = {
  q?: string;
  hostSpecies?: string;
  stageLabel?: StageLabel;
  tags?: string[];
  hasCocktailData?: boolean;
  evidenceLevel?: EvidenceLevel;
  page?: number;
  limit?: number;
  sort?: "name_asc" | "name_desc" | "created_desc";
};

export type HostRangeDetail = {
  id: string;
  assayMethod: string;
  outcome: "susceptible" | "resistant" | "partial" | "unknown";
  moi: number | null;
  temperatureC: number | null;
  replicates: number | null;
  measurement: Record<string, unknown>;
  hostStrain: {
    species: string;
    strainName: string | null;
    strainIdentifier: string | null;
  };
};

export type KineticsDetail = {
  id: string;
  stageLabel: StageLabel;
  metricType: string;
  metricValue: number | null;
  metricUnit: string | null;
  context: string | null;
};

export type CocktailDetail = {
  experimentId: string;
  experimentName: string;
  targetBacterium: string | null;
  outcomeSummary: string | null;
  timingRole: "early" | "semi_early" | "late" | "unknown";
  componentNotes: string | null;
};

export type CitationDetail = {
  id: string;
  fieldName: string;
  source: {
    title: string;
    year: number | null;
    sourceType: string;
    url: string | null;
    doi: string | null;
  };
  evidence: {
    level: EvidenceLevel;
    confidence: "high" | "medium" | "low";
    comment: string | null;
  } | null;
};

export type PhageDetail = {
  id: string;
  name: string;
  genomeAccession: string | null;
  genomeLengthBp: number | null;
  gcContent: number | null;
  taxonomyFamily: string | null;
  taxonomyGenus: string | null;
  hostPrimaryTaxon: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  hostRangeAssays: HostRangeDetail[];
  kineticsObservations: KineticsDetail[];
  cocktails: CocktailDetail[];
  citations: CitationDetail[];
};

export type DatasetSummary = {
  phageCount: number;
  assayCount: number;
  kineticsCount: number;
  cocktailCount: number;
  citationCount: number;
};
