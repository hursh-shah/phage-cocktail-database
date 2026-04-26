export type PaperIngestStatus =
  | "queued"
  | "metadata_fetched"
  | "assets_fetched"
  | "extracted"
  | "pending_review"
  | "published"
  | "failed";

export type PaperExtractionStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "published";

export type PaperRecord = {
  id: string;
  title: string;
  journal: string | null;
  year: number | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  url: string | null;
  oaStatus: "unknown" | "open_access" | "closed";
  pathogenFocus: string;
  ingestStatus: PaperIngestStatus;
  createdAt: string;
  updatedAt: string;
};

export type PaperQueueRow = PaperRecord & {
  extractionCount: number;
  pendingExtractionCount: number;
};

export type PaperExtractionRow = {
  id: string;
  paperExtractionId: string;
  cocktailName: string | null;
  assayType: "spot" | "plaque" | "EOP" | "kill_curve" | "biofilm" | "in_vivo" | "other" | null;
  pathogen: string;
  hostSpecies: string | null;
  hostStrainRaw: string | null;
  phageNames: string[];
  phageAccessions: string[];
  conditions: Record<string, unknown>;
  conditionsHash: string | null;
  outcomeMetrics: Record<string, unknown>;
  evidenceLocation: string | null;
  confidence: number;
  needsReview: boolean;
  createdAt: string;
};

export type DesignFactorType =
  | "host_range"
  | "kinetics"
  | "genetic_relatedness"
  | "receptor_resistance"
  | "biofilm"
  | "antibiotic_synergy"
  | "cocktail_outcome"
  | "safety";

export type PaperExtractionFactorRow = {
  id: string;
  paperExtractionId: string;
  factorType: DesignFactorType;
  pathogen: string;
  hostSpecies: string | null;
  hostStrainRaw: string | null;
  phageNames: string[];
  phageAccessions: string[];
  assayType: "spot" | "plaque" | "EOP" | "kill_curve" | "biofilm" | "in_vivo" | "other" | null;
  conditions: Record<string, unknown>;
  measurements: Record<string, unknown>;
  outcomeRole: string | null;
  evidenceLocation: string | null;
  confidence: number;
  needsReview: boolean;
  publishedAt: string | null;
  createdAt: string;
};

export type PaperExtraction = {
  id: string;
  paperId: string;
  extractorVersion: string;
  status: PaperExtractionStatus;
  confidence: number;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rows: PaperExtractionRow[];
  factorRows: PaperExtractionFactorRow[];
};

export type PaperSearchPayload = {
  term?: string;
  maxResults?: number;
  pathogenFocus?: string;
  profile?: "steno" | "staph" | "ecoli" | "pseudomonas" | "custom";
};

export type PaperSearchResult = {
  jobId: string;
  discovered: number;
  inserted: number;
  deduped: number;
  papers: PaperRecord[];
};

export type PaperFetchResult = {
  jobId: string;
  paperId: string;
  fetchedAssets: number;
  supplementLinks: number;
  status: PaperIngestStatus;
};

export type PaperExtractResult = {
  jobId: string;
  paperId: string;
  extractionId: string;
  rowCount: number;
  status: PaperIngestStatus;
};

export type PaperReviewQueueResult = {
  extractionId: string;
  paper: PaperRecord;
  extraction: Omit<PaperExtraction, "rows" | "factorRows">;
  rows: PaperExtractionRow[];
  factorRows: PaperExtractionFactorRow[];
};

export type PaperApproveResult = {
  extractionId: string;
  publishedRows: number;
  publishedFactorRows: number;
  skippedRows: number;
  skippedFactorRows: number;
  cocktailIds: string[];
};

export type GeneticDistanceIngestSummary = {
  totalRows: number;
  validRows: number;
  insertedRows: number;
  skippedRows: number;
  warnings: string[];
};
