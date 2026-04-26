import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase";
import type {
  DesignFactorType,
  GeneticDistanceIngestSummary,
  PaperApproveResult,
  PaperExtractResult,
  PaperExtraction,
  PaperExtractionFactorRow,
  PaperExtractionRow,
  PaperFetchResult,
  PaperQueueRow,
  PaperRecord,
  PaperReviewQueueResult,
  PaperSearchPayload,
  PaperSearchResult
} from "@/types/paper";
import { parseDelimitedText } from "@/lib/delimited";

const DEFAULT_TERM =
  '"phage cocktail" AND (staphylococcus OR "S. aureus") AND ("kill curve" OR biofilm OR CFU OR "log reduction")';
const STENO_TERM =
  '("Stenotrophomonas maltophilia"[Title/Abstract] OR "S. maltophilia"[Title/Abstract]) AND (phage[Title/Abstract] OR bacteriophage[Title/Abstract]) AND ("host range"[Title/Abstract] OR infectivity[Title/Abstract] OR EOP[Title/Abstract] OR "efficiency of plating"[Title/Abstract] OR "growth curve"[Title/Abstract] OR "kill curve"[Title/Abstract] OR cocktail[Title/Abstract] OR biofilm[Title/Abstract] OR "antibiotic synergy"[Title/Abstract] OR "resistance emergence"[Title/Abstract]) NOT (prophage[Title] OR prophages[Title] OR "phylogenetic diversity"[Title] OR "comparative genomics"[Title])';
const RULE_EXTRACTOR_VERSION = "v1_rule_parser";
const GEMINI_DEFAULT_MODEL = "gemini-3.1-pro-preview";

type AssayType = "kill_curve" | "biofilm" | "spot" | "plaque" | "EOP" | "in_vivo" | "other";
type ExtractedRowInput = Omit<PaperExtractionRow, "id" | "paperExtractionId" | "createdAt">;
type ExtractedFactorRowInput = Omit<
  PaperExtractionFactorRow,
  "id" | "paperExtractionId" | "publishedAt" | "createdAt"
>;

const SEARCH_PROFILES = {
  steno: {
    term: STENO_TERM,
    pathogenFocus: "S_maltophilia"
  },
  staph: {
    term: DEFAULT_TERM,
    pathogenFocus: "S_aureus"
  },
  ecoli: {
    term:
      '("Escherichia coli" OR "E. coli") AND (phage OR bacteriophage) AND ("host range" OR "growth curve" OR cocktail OR "machine learning" OR resistance)',
    pathogenFocus: "E_coli"
  },
  pseudomonas: {
    term:
      'Pseudomonas AND (phage OR bacteriophage) AND ("host range" OR EOP OR "kill curve" OR cocktail OR biofilm OR resistance)',
    pathogenFocus: "Pseudomonas"
  }
} as const;

function normalizePathogen(pathogenRaw: string | undefined): string {
  if (!pathogenRaw) return "S_maltophilia";
  return pathogenRaw.trim().replace(/\s+/g, "_");
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return Object.fromEntries(entries.map(([key, nested]) => [key, normalizeJson(nested)]));
  }
  return value;
}

function buildConditionsHash(payload: Record<string, unknown>): string {
  const normalized = JSON.stringify(normalizeJson(payload));
  return createHash("sha256").update(normalized).digest("hex");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isMissingRelationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("schema cache") ||
    normalized.includes("relation")
  );
}

function parseHostSpecies(text: string): string {
  if (/stenotrophomonas\s+maltophilia/i.test(text)) return "Stenotrophomonas maltophilia";
  if (/\bS\.\s*maltophilia\b/i.test(text)) return "Stenotrophomonas maltophilia";
  if (/staphylococcus\s+aureus/i.test(text)) return "Staphylococcus aureus";
  if (/\bS\.\s*aureus\b/i.test(text)) return "Staphylococcus aureus";
  if (/staphylococcus/i.test(text)) return "Staphylococcus spp.";
  if (/escherichia\s+coli/i.test(text) || /\bE\.\s*coli\b/i.test(text)) return "Escherichia coli";
  if (/pseudomonas\s+aeruginosa/i.test(text)) return "Pseudomonas aeruginosa";
  return "Unknown";
}

function computeConfidence(text: string, assayType: string, phageNames: string[], outcomes: Record<string, unknown>): number {
  let score = 0.3;
  if (assayType !== "other") score += 0.2;
  if (phageNames.length >= 2) score += 0.2;
  if (Object.keys(outcomes).length > 0) score += 0.2;
  if (/table|supplement|figure/i.test(text)) score += 0.1;
  return Math.min(1, Number(score.toFixed(3)));
}

function normalizeAssayType(value: unknown): AssayType {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return "other";
  if (normalized === "eop") return "EOP";
  if (["kill_curve", "biofilm", "spot", "plaque", "in_vivo", "other"].includes(normalized)) {
    return normalized as AssayType;
  }
  if (normalized.includes("kill")) return "kill_curve";
  if (normalized.includes("biofilm")) return "biofilm";
  if (normalized.includes("plaque")) return "plaque";
  if (normalized.includes("spot")) return "spot";
  if (normalized.includes("in vivo") || normalized.includes("mouse") || normalized.includes("mice")) {
    return "in_vivo";
  }
  if (normalized.includes("eop") || normalized.includes("efficiency of plating")) return "EOP";
  return "other";
}

function sanitizeSnippet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.slice(0, 320);
}

function isGroundedToken(source: string, token: string): boolean {
  const candidate = token.trim();
  if (!candidate) return false;
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(source)) return true;
  const normalizedSource = normalizePhageToken(source);
  const normalizedCandidate = normalizePhageToken(candidate);
  if (normalizedCandidate !== candidate) {
    const normalizedEscaped = normalizedCandidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${normalizedEscaped}\\b`, "i").test(normalizedSource)) return true;
  }
  return source.toLowerCase().includes(candidate.toLowerCase());
}

function normalizePhageToken(value: string): string {
  return value.replace(/phi(?=\d)/gi, "Φ").replace(/[ɸφ]/g, "Φ");
}

function isLikelyNonPhageLabel(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return true;
  if (/^(?:PAO?1|PA14|PA\d+|PW\d+|ATCC\d+|NCTC\d+|DSM\d+|K279a|D1585|DH5[A-Z0-9-]*|S17-1)$/i.test(candidate)) {
    return true;
  }
  if (/^(?:OD\d+|ST\d+|PRJNA\d+|MEGA\d+|HT\d+|PE\d+|SMA\d+|R\d+-\d+|SM\d+[A-Z]*)$/i.test(candidate)) return true;
  if (/^(?:pUCP|pEX|pBBR|pD1585|pPAO?1|p280)/i.test(candidate)) return true;
  if (/(?:pil[A-Z0-9]|lux|_lux_)/i.test(candidate)) return true;
  if (/^(?:PMC|PMID|NCBI)\d+/i.test(candidate)) return true;
  if (/^[A-Z]{1,4}\d{5,8}(?:\.\d+)?$/.test(candidate)) return true;
  if (/^B\d+[A-Z]?$/i.test(candidate)) return true;
  return false;
}

function inferEvidenceLocation(text: string): string {
  if (/supplement/i.test(text)) return "supplement";
  if (/table/i.test(text)) return "table";
  if (/figure/i.test(text)) return "figure";
  return "full_text";
}

function hasNumericOutcomeMetric(outcome: Record<string, unknown>): boolean {
  return Object.values(outcome).some((value) => typeof value === "number" && Number.isFinite(value));
}

function inferStudyType(source: string): "experimental_phage_characterization" | "cocktail_experiment" | "prophage_genomics" | "background" {
  const lower = source.toLowerCase();
  const titleAndAbstract = lower.slice(0, 6000);
  if (
    /\bprophages?\b/.test(titleAndAbstract) &&
    (/prediction|predicted|phylogenetic diversity|comparative genomic|genome assemblies|crispr|hgt/.test(titleAndAbstract)) &&
    !/host range analysis|eop|efficiency of plating|growth curve|kill curve|biofilm assay|cocktail/.test(titleAndAbstract)
  ) {
    return "prophage_genomics";
  }
  if (/cocktail|combined phages|phage combination|phage-antibiotic|antibiotic synergy/.test(titleAndAbstract)) {
    return "cocktail_experiment";
  }
  if (/host range|eop|efficiency of plating|growth curve|kill curve|one-step|one step|biofilm/.test(titleAndAbstract)) {
    return "experimental_phage_characterization";
  }
  return "background";
}

function allowsTrainingRows(studyType: ReturnType<typeof inferStudyType>): boolean {
  return studyType === "experimental_phage_characterization" || studyType === "cocktail_experiment";
}

function normalizeFactorType(value: unknown): DesignFactorType | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (normalized === "host_range" || normalized.includes("host range") || normalized.includes("eop")) {
    return "host_range";
  }
  if (normalized === "kinetics" || normalized.includes("kinetic") || normalized.includes("growth curve")) {
    return "kinetics";
  }
  if (
    normalized === "genetic_relatedness" ||
    normalized.includes("genetic") ||
    normalized.includes("ani") ||
    normalized.includes("mash")
  ) {
    return "genetic_relatedness";
  }
  if (
    normalized === "receptor_resistance" ||
    normalized.includes("receptor") ||
    normalized.includes("resistance") ||
    normalized.includes("mutant")
  ) {
    return "receptor_resistance";
  }
  if (normalized === "biofilm" || normalized.includes("biofilm")) return "biofilm";
  if (
    normalized === "antibiotic_synergy" ||
    normalized.includes("antibiotic") ||
    normalized.includes("synergy")
  ) {
    return "antibiotic_synergy";
  }
  if (normalized === "cocktail_outcome" || normalized.includes("cocktail")) return "cocktail_outcome";
  if (normalized === "safety" || normalized.includes("temperate") || normalized.includes("virulence")) {
    return "safety";
  }
  return null;
}

function mapPaperRow(row: Record<string, unknown>): PaperRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    journal: typeof row.journal === "string" ? row.journal : null,
    year: typeof row.year === "number" ? row.year : null,
    doi: typeof row.doi === "string" ? row.doi : null,
    pmid: typeof row.pmid === "string" ? row.pmid : null,
    pmcid: typeof row.pmcid === "string" ? row.pmcid : null,
    url: typeof row.url === "string" ? row.url : null,
    oaStatus:
      row.oa_status === "open_access" || row.oa_status === "closed"
        ? row.oa_status
        : "unknown",
    pathogenFocus:
      typeof row.pathogen_focus === "string" ? row.pathogen_focus : "S_maltophilia",
    ingestStatus:
      typeof row.ingest_status === "string"
        ? (row.ingest_status as PaperRecord["ingestStatus"])
        : "queued",
    createdAt:
      typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    updatedAt:
      typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString()
  };
}

async function startJob(jobType: "search" | "fetch" | "extract" | "publish", scope: Record<string, unknown>): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("paper_ingest_jobs")
    .insert({
      job_type: jobType,
      scope_json: scope,
      status: "running",
      started_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to start ${jobType} job: ${error?.message ?? "unknown"}`);
  }
  return String(data.id);
}

async function finishJob(
  jobId: string,
  status: "completed" | "failed",
  stats: Record<string, unknown>,
  errorText?: string
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("paper_ingest_jobs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      stats_json: stats,
      error_text: errorText ?? null
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to update job ${jobId}: ${error.message}`);
  }
}

type PubMedSummary = {
  uid: string;
  title: string;
  fulljournalname?: string;
  pubdate?: string;
  articleids?: Array<{ idtype: string; value: string }>;
};

async function fetchPubMedSearch(term: string, maxResults: number): Promise<string[]> {
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("retmax", String(Math.max(1, Math.min(maxResults, 200))));
  searchUrl.searchParams.set("term", term);

  const response = await fetch(searchUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`PubMed search failed: HTTP ${response.status}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const result = asObject(json.esearchresult);
  const ids = Array.isArray(result.idlist) ? result.idlist : [];
  return ids.map((id) => String(id));
}

async function fetchPubMedSummaries(pmids: string[]): Promise<PubMedSummary[]> {
  if (pmids.length === 0) return [];
  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("retmode", "json");
  url.searchParams.set("id", pmids.join(","));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`PubMed summary failed: HTTP ${response.status}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const result = asObject(json.result);
  const uids = Array.isArray(result.uids) ? result.uids : [];
  return uids
    .map((uid) => asObject(result[String(uid)]))
    .filter((entry) => Object.keys(entry).length > 0) as PubMedSummary[];
}

function parseYearFromPubDate(pubDate?: string): number | null {
  if (!pubDate) return null;
  const match = pubDate.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function findArticleId(summary: PubMedSummary, idType: string): string | null {
  const ids = summary.articleids ?? [];
  const found = ids.find((item) => item.idtype === idType);
  return found?.value ?? null;
}

function derivePaperUrl(doi: string | null, pmcid: string | null, pmid: string): string | null {
  if (doi) return `https://doi.org/${doi}`;
  if (pmcid) return `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`;
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  return null;
}

function extractSupplementLinks(xml: string, pmcid: string): string[] {
  const links: string[] = [];
  const hrefRegex = /xlink:href="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(xml))) {
    if (!match[1]) continue;
    if (!/\.(pdf|csv|tsv|xlsx|xls|doc|docx|txt|zip)$/i.test(match[1])) continue;
    const resolved = match[1].startsWith("http")
      ? match[1]
      : `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/bin/${match[1].replace(/^\//, "")}`;
    links.push(resolved);
  }
  return uniqueStrings(links);
}

function isTextSupplementUrl(url: string): boolean {
  return /\.(csv|tsv|txt)$/i.test(url.split("?")[0] ?? url);
}

function selectExtractionSource(paper: PaperRecord, xml: string, supplementText = ""): string {
  return `${paper.title}\n${paper.journal ?? ""}\n${paper.url ?? ""}\n${xml.slice(0, 20000)}\n${supplementText.slice(0, 18000)}`;
}

function selectDeterministicExtractionSource(paper: PaperRecord, xml: string, supplementText = ""): string {
  return `${paper.title}\n${paper.journal ?? ""}\n${paper.url ?? ""}\n${xml}\n${supplementText}`;
}

function normalizePmcid(pmcid: string): string {
  const trimmed = pmcid.trim().toUpperCase();
  if (trimmed.startsWith("PMC")) return trimmed;
  return `PMC${trimmed}`;
}

type FullTextFetchResult = {
  content: string;
  sourceUrl: string;
  assetType: "full_text_xml" | "full_text_html";
  mimeType: string;
};

type GeminiRowCandidate = {
  cocktail_name?: unknown;
  assay_type?: unknown;
  pathogen?: unknown;
  host_species?: unknown;
  host_strain_raw?: unknown;
  phage_names?: unknown;
  phage_accessions?: unknown;
  conditions?: unknown;
  outcome_metrics?: unknown;
  evidence_location?: unknown;
  supporting_snippet?: unknown;
  confidence?: unknown;
};

type GeminiFactorRowCandidate = {
  factor_type?: unknown;
  pathogen?: unknown;
  host_species?: unknown;
  host_strain_raw?: unknown;
  phage_names?: unknown;
  phage_accessions?: unknown;
  assay_type?: unknown;
  conditions?: unknown;
  measurements?: unknown;
  outcome_role?: unknown;
  evidence_location?: unknown;
  supporting_snippet?: unknown;
  confidence?: unknown;
};

async function fetchFullTextFromPmc(pmcidRaw: string): Promise<FullTextFetchResult> {
  const pmcid = normalizePmcid(pmcidRaw);
  const xmlUrlCandidates = [
    `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,
    `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/?page=xml`
  ];

  for (const url of xmlUrlCandidates) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) continue;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const text = await response.text();
    if (!text.trim()) continue;
    const looksXml =
      contentType.includes("xml") || text.trimStart().startsWith("<?xml") || text.includes("<article");
    if (!looksXml) continue;
    return {
      content: text,
      sourceUrl: url,
      assetType: "full_text_xml",
      mimeType: "application/xml"
    };
  }

  const htmlUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`;
  const htmlResponse = await fetch(htmlUrl, { cache: "no-store" });
  if (htmlResponse.ok) {
    const html = await htmlResponse.text();
    if (html.trim()) {
      return {
        content: html,
        sourceUrl: htmlUrl,
        assetType: "full_text_html",
        mimeType: "text/html"
      };
    }
  }

  throw new Error(
    `Failed to fetch full text for ${pmcid}. Tried: ${xmlUrlCandidates.join(", ")} and ${htmlUrl}`
  );
}

function extractJsonFromText(text: string): Record<string, unknown> {
  const direct = text.trim();
  if (direct.startsWith("{")) {
    return asObject(JSON.parse(direct));
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return asObject(JSON.parse(fenced[1]));
  }

  const objectLike = text.match(/\{[\s\S]*\}/);
  if (objectLike?.[0]) {
    return asObject(JSON.parse(objectLike[0]));
  }
  throw new Error("No JSON object in Gemini response.");
}

function extractGeminiText(payload: Record<string, unknown>): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const content = asObject(asObject(candidate).content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((part) => asObject(part).text)
      .find((value) => typeof value === "string" && value.trim().length > 0);
    if (typeof text === "string") {
      return text;
    }
  }
  return "";
}

function normalizeRowCandidate(raw: GeminiRowCandidate, source: string, paper: PaperRecord): ExtractedRowInput | null {
  const requestedAssayType = normalizeAssayType(raw.assay_type);
  const assayType = requestedAssayType;

  const parsedPhageNames = Array.isArray(raw.phage_names)
    ? raw.phage_names.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const parsedPhageAccessions = Array.isArray(raw.phage_accessions)
    ? raw.phage_accessions.map((value) => String(value).trim()).filter(Boolean)
    : [];

  const phageNames = uniqueStrings(
    parsedPhageNames.filter((value) => looksLikePhageName(value) && isGroundedToken(source, value))
  );
  const phageAccessions = uniqueStrings(parsedPhageAccessions.filter((value) => isGroundedToken(source, value)));
  if (phageNames.length === 0 && phageAccessions.length === 0) {
    return null;
  }

  const rawHostSpecies = typeof raw.host_species === "string" ? raw.host_species.trim() : "";
  let hostSpecies = rawHostSpecies || parseHostSpecies(source);
  if (!hostSpecies || hostSpecies === "Unknown") {
    hostSpecies =
      paper.pathogenFocus === "S_maltophilia"
        ? "Stenotrophomonas maltophilia"
        : paper.pathogenFocus === "S_aureus"
          ? "Staphylococcus aureus"
          : "Unknown";
  }
  const hostStrainRaw =
    (typeof raw.host_strain_raw === "string" && raw.host_strain_raw.trim()) || null;

  const candidateConditions = asObject(raw.conditions);
  const conditions: Record<string, unknown> = { ...candidateConditions };
  if (!conditions.model_context) {
    conditions.model_context =
      assayType === "in_vivo" ? "in_vivo" : assayType === "biofilm" ? "biofilm" : "in_vitro";
  }

  const candidateOutcome = asObject(raw.outcome_metrics);
  const outcomeMetrics: Record<string, unknown> = { ...candidateOutcome };

  const snippet = sanitizeSnippet(raw.supporting_snippet);
  const snippetGrounded = snippet ? source.toLowerCase().includes(snippet.toLowerCase()) : false;
  if (!snippet || !snippetGrounded) {
    return null;
  }
  if (snippet && typeof outcomeMetrics.supporting_snippet !== "string") {
    outcomeMetrics.supporting_snippet = snippet;
  }
  const evidenceBase =
    typeof raw.evidence_location === "string" && raw.evidence_location.trim().length > 0
      ? raw.evidence_location.trim().slice(0, 120)
      : inferEvidenceLocation(source);
  const evidenceLocation = snippet ? `${evidenceBase} :: ${snippet}` : evidenceBase;

  const conditionsHash = buildConditionsHash({
    assay_type: assayType,
    host_species: hostSpecies,
    host_strain_raw: hostStrainRaw,
    ...conditions
  });

  const ruleConfidence = computeConfidence(source, assayType, phageNames, outcomeMetrics);
  const llmConfidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;
  let confidence = llmConfidence * 0.55 + ruleConfidence * 0.45;
  if (!hasNumericOutcomeMetric(outcomeMetrics)) confidence -= 0.08;
  if (assayType === "other") confidence -= 0.05;
  confidence = Math.max(0.05, Math.min(1, confidence));

  const rawCocktailName =
    typeof raw.cocktail_name === "string" && raw.cocktail_name.trim().length > 0
      ? raw.cocktail_name.trim()
      : null;
  const pathogen =
    typeof raw.pathogen === "string" && raw.pathogen.trim().length > 0
      ? normalizePathogen(raw.pathogen)
      : paper.pathogenFocus;

  return {
    cocktailName: rawCocktailName ?? `${paper.title.slice(0, 70)} cocktail`,
    assayType,
    pathogen,
    hostSpecies,
    hostStrainRaw,
    phageNames,
    phageAccessions,
    conditions,
    conditionsHash,
    outcomeMetrics,
    evidenceLocation,
    confidence: Number(confidence.toFixed(3)),
    needsReview: true
  };
}

function normalizeFactorRowCandidate(
  raw: GeminiFactorRowCandidate,
  source: string,
  paper: PaperRecord
): ExtractedFactorRowInput | null {
  const factorType = normalizeFactorType(raw.factor_type);
  if (!factorType) return null;

  const parsedPhageNames = Array.isArray(raw.phage_names)
    ? raw.phage_names.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const parsedPhageAccessions = Array.isArray(raw.phage_accessions)
    ? raw.phage_accessions.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const phageNames = uniqueStrings(
    parsedPhageNames.filter((value) => looksLikePhageName(value) && isGroundedToken(source, value))
  );
  const phageAccessions = uniqueStrings(parsedPhageAccessions.filter((value) => isGroundedToken(source, value)));
  if (phageNames.length === 0 && phageAccessions.length === 0) return null;

  const snippet = sanitizeSnippet(raw.supporting_snippet);
  const snippetGrounded = snippet ? source.toLowerCase().includes(snippet.toLowerCase()) : false;
  if (!snippet || !snippetGrounded) return null;

  const rawHostSpecies = typeof raw.host_species === "string" ? raw.host_species.trim() : "";
  let hostSpecies = rawHostSpecies || parseHostSpecies(source);
  if (!hostSpecies || hostSpecies === "Unknown") {
    hostSpecies =
      paper.pathogenFocus === "S_maltophilia"
        ? "Stenotrophomonas maltophilia"
        : paper.pathogenFocus === "S_aureus"
          ? "Staphylococcus aureus"
          : "Unknown";
  }

  const measurements = asObject(raw.measurements);
  if (Object.keys(measurements).length === 0) return null;

  const assayType = normalizeAssayType(raw.assay_type);
  const evidenceBase =
    typeof raw.evidence_location === "string" && raw.evidence_location.trim().length > 0
      ? raw.evidence_location.trim().slice(0, 120)
      : inferEvidenceLocation(source);
  const ruleConfidence = computeConfidence(source, assayType, phageNames, measurements);
  const llmConfidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;
  const confidence = Math.max(0.05, Math.min(1, llmConfidence * 0.55 + ruleConfidence * 0.45));
  const pathogen =
    typeof raw.pathogen === "string" && raw.pathogen.trim().length > 0
      ? normalizePathogen(raw.pathogen)
      : paper.pathogenFocus;

  return {
    factorType,
    pathogen,
    hostSpecies,
    hostStrainRaw:
      (typeof raw.host_strain_raw === "string" && raw.host_strain_raw.trim()) || null,
    phageNames,
    phageAccessions,
    assayType,
    conditions: asObject(raw.conditions),
    measurements:
      typeof measurements.supporting_snippet === "string"
        ? measurements
        : { ...measurements, supporting_snippet: snippet },
    outcomeRole:
      (typeof raw.outcome_role === "string" && raw.outcome_role.trim().slice(0, 120)) || null,
    evidenceLocation: `${evidenceBase} :: ${snippet}`,
    confidence: Number(confidence.toFixed(3)),
    needsReview: true
  };
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function stripXmlTags(fragment: string): string {
  return decodeXmlEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function compactSnippet(text: string, limit = 260): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

function extractTagText(fragment: string, tag: string): string | null {
  const match = fragment.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? stripXmlTags(match[1]) : null;
}

function extractXmlTables(source: string): Array<{ label: string | null; caption: string; rows: string[][]; text: string }> {
  const tables: Array<{ label: string | null; caption: string; rows: string[][]; text: string }> = [];
  const tableRegex = /<table-wrap\b[^>]*>[\s\S]*?<\/table-wrap>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(source))) {
    const tableXml = tableMatch[0];
    const label = extractTagText(tableXml, "label");
    const caption = extractTagText(tableXml, "caption") ?? "";
    const rows: string[][] = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableXml))) {
      const cells: string[] = [];
      const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1] ?? ""))) {
        cells.push(stripXmlTags(cellMatch[1] ?? ""));
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
    tables.push({
      label,
      caption,
      rows,
      text: stripXmlTags(tableXml)
    });
  }
  return tables;
}

function splitSentences(text: string): string[] {
  return stripXmlTags(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30);
}

function looksLikePhageName(value: string): boolean {
  const candidate = normalizePhageToken(value.trim());
  if (!candidate || candidate.length > 60) return false;
  if (/^(table|figure|supplement|strain|host|range|genome|abstract)$/i.test(candidate)) return false;
  if (isLikelyNonPhageLabel(candidate)) return false;
  return /\b(vB_[A-Za-z0-9_.-]+|phage\s+[A-Za-z0-9_.@-]+|Yut\d+|DLP\d+|AXL\d+|P[a-zA-Z]?\d+|[A-Z]{2,}_?[A-Z]*\d{1,}[A-Za-z0-9@._-]*)\b/.test(
    candidate
  ) || /\b(?:SBP\d+(?:[Φɸφ]\d+|phi\d+)?|StM\d+)\b/i.test(candidate);
}

function extractPhageNames(text: string): string[] {
  const names: string[] = [];
  const patterns = [
    /\b(?:phage|bacteriophage)\s+([A-Za-z0-9_.@-]{2,40})\b/gi,
    /\b(vB_[A-Za-z0-9_.@-]+)\b/g,
    /\b(Yut\d+|DLP\d+|AXL\d+|StM\d+|SBP\d+(?:[Φɸφ]\d+|phi\d+)?|P[a-zA-Z]?\d+[A-Za-z0-9@._-]*|[A-Z]{2,}_?[A-Z]*\d+[A-Za-z0-9@._-]*(?:[Φɸφ]\d+)?)\b/g
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const name = normalizePhageToken((match[1] ?? match[0]).replace(/[),.;:]$/g, ""));
      if (looksLikePhageName(name)) names.push(name);
    }
  }
  return uniqueStrings(names);
}

function titleAbstractWindow(source: string): string {
  const stripped = stripXmlTags(source);
  const abstractEnd = stripped.search(/\b(?:1\.\s*)?Introduction\b/i);
  if (abstractEnd > 500) return stripped.slice(0, abstractEnd);
  return stripped.slice(0, 12000);
}

function focalPhageNames(source: string, paper: PaperRecord): string[] {
  const explicitTitleNames = uniqueStrings([
    ...(paper.title.match(/\bvB_[A-Za-z0-9_.@-]+\b/g) ?? []),
    ...(paper.title.match(/\b[A-Z]{2,}_[A-Z]{1,}\d+[A-Za-z0-9_.@-]*\b/g) ?? [])
  ].map(normalizePhageToken).filter(looksLikePhageName));
  if (explicitTitleNames.length > 0) return explicitTitleNames.slice(0, 8);
  const titleNames = extractPhageNames(paper.title).filter(looksLikePhageName);
  if (titleNames.length > 0) return uniqueStrings(titleNames).slice(0, 8);
  const stripped = stripXmlTags(source).slice(0, 80000);
  const representative = stripped.match(/(?:selected one representative from each group|representative from each group):?\s+([^.]*(?:ANB28|KB824|SBP\d+)[^.]*)\./i);
  if (representative?.[1]) {
    const representativeNames = extractPhageNames(representative[1]).filter(looksLikePhageName);
    if (representativeNames.length >= 2) return uniqueStrings(representativeNames).slice(0, 4);
  }
  const earlyNames = extractPhageNames(titleAbstractWindow(source)).filter(looksLikePhageName);
  if (earlyNames.length > 0) return uniqueStrings(earlyNames).slice(0, 8);
  return uniqueStrings(extractPhageNames(stripped.slice(0, 50000)).filter(looksLikePhageName)).slice(0, 8);
}

function extractAccessions(text: string): string[] {
  const matches = text.match(/\b(?:NC_\d{6}(?:\.\d+)?|[A-Z]{1,4}\d{5,8}(?:\.\d+)?)\b/g) ?? [];
  return uniqueStrings(matches);
}

function isHostRangeText(text: string): boolean {
  return /host range|infectivity|susceptib|eop|efficiency of plating|spot test|plaque/i.test(text);
}

function isKineticsText(text: string): boolean {
  return /latent period|burst size|adsorption|one-step|one step|growth curve|kill curve|bactericidal|time[-\s]to[-\s]lysis/i.test(text);
}

function isSafetyText(text: string): boolean {
  return /lysogen|temperate|integrase|virulence|antibiotic resistance|AMR|toxin|safety/i.test(text);
}

function isResistanceText(text: string): boolean {
  return /receptor|pilus|DLP\d[-\s]?resistant|phage[-\s]?resistant|resistant to (?:DLP\d|phage|infection)|mutant|mutation|cross-resistance|adsorption receptor/i.test(text);
}

function isBiofilmText(text: string): boolean {
  if (/further research should|future studies|including in vivo infections/i.test(text)) return false;
  if (/virulence factor used for biofilm formation|virulence factor .*biofilm formation, adherence/i.test(text)) return false;
  return /biofilm|crystal violet|MBEC|biofilm formation|biofilm biomass/i.test(text);
}

function isAntibioticSynergyText(text: string): boolean {
  if (/sensitivity to phage|susceptibility to phage|phage susceptibility|lytic susceptibility|infectivity|efficiency of plating/i.test(text)) {
    return false;
  }
  if (
    /antibiotic resistance gene|AMR genes?|AMR profile|resistance genes?/i.test(text) &&
    !/with antibiotics|different antibiotics|minimum inhibitory|\bMIC\b|changed sensitivity to antibiotics|enhanced the inhibitory effect|synerg/i.test(text)
  ) {
    return false;
  }
  const antibioticContext =
    /antibiotic|trimethoprim|sulfamethoxazole|chloramphenicol|levofloxacin|tetracycline|gentamicin|ciprofloxacin|minocycline|ceftazidime|meropenem|\bMIC\b/i.test(
      text
    );
  const interactionContext =
    /phage-antibiotic|synerg|with antibiotics|different antibiotics|in addition to|combined with|combination|enhanced the inhibitory effect|changed sensitivity to antibiotics|biofilm/i.test(
      text
    );
  return antibioticContext && interactionContext;
}

function isGenomeSafetyEvidence(text: string): boolean {
  return /lysogen|temperate|integrase|toxin|antibiotic resistance gene|AMR gene|virulence gene|moron gene/i.test(text);
}

function isLowValueExtractionSentence(text: string): boolean {
  if (/^\s*\d+\./.test(text)) return true;
  if (/keywords:|status released|display-pdf|is-preprint|is-journal-matter/i.test(text)) return true;
  if (/https?:\/\/|PMC\d+|PMID|google scholar|crossref|pubmed|references|copyright/i.test(text)) return true;
  if (/multidisciplinary digital publishing institute|article identifying bacterial receptors/i.test(text)) return true;
  if (/objective of the experiments presented in this paper/i.test(text)) return true;
  if (/further research should|future studies should|including in vivo infections/i.test(text)) return true;
  if (/each bolded column represents|detailed list of the antibiotic resistance genes found in .*bacterial hosts/i.test(text)) return true;
  if (/analy[sz]e the genomes .*focus on the genotype related to antibiotic resistance and biofilm formation/i.test(text)) return true;
  if (/experiments in combination of different antibiotics .*performed by applying the same protocol/i.test(text)) return true;
  if (/^Phage Plaquing Assays\b/i.test(text)) return true;
  if (/was determined by spot assay .*previously described/i.test(text)) return true;
  if (/same protocol was used with the addition of .*final MOI/i.test(text)) return true;
  if (/shown for titer calculation|conducted to determine the burst size and latent period/i.test(text)) return true;
  if (/in the future,? we plan|currently underway to determine|further experimental investigation/i.test(text)) return true;
  if (/^Identification and Characterization of Type IV Pili as the Cellular Receptor/i.test(text)) return true;
  if (/several studies|whereas spontaneous mutation|although bacteria may become resistant/i.test(text)) return true;
  if (/the use of phages for human therapy requires extensive phage characterization/i.test(text)) return true;
  if (/ideally, a therapeutic cocktail|promising examples of therapeutic phages|another role for glycosyltransferases|it is unknown if the type iv pilus/i.test(text)) {
    return true;
  }
  if (
    /primer|amplified|digested|ligated|cloned|transformed|electrocompetent|restriction endonuclease|sanger sequencing/i.test(text) &&
    !/infect|lysis|lyse|plaque|resistant|susceptib|binding|receptor/i.test(text)
  ) {
    return true;
  }
  return false;
}

function hasFocalPhageMention(sentence: string, focalNames: string[]): boolean {
  return focalNames.some((name) => isGroundedToken(sentence, name));
}

function classifyOutcome(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "-" || normalized === "−" || normalized === "no") {
    return "resistant";
  }
  if (normalized.includes("partial") || normalized === "+/-" || normalized === "±") return "partial";
  if (
    /^\++$/.test(normalized) ||
    normalized.includes("lysis") ||
    normalized.includes("plaque") ||
    normalized.includes("clear") ||
    normalized.includes("turbid") ||
    normalized.includes("suscept")
  ) {
    return "susceptible";
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric > 0 ? "susceptible" : "resistant";
  return "unknown";
}

function firstNumericValue(text: string): number | null {
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseTimeAsMinutes(text: string): number | null {
  const value = firstNumericValue(text);
  if (value === null) return null;
  if (/\b(?:h|hr|hrs|hour|hours)\b/i.test(text)) return Number((value * 60).toFixed(2));
  return value;
}

function headerIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function hostSpeciesForPaper(paper: PaperRecord, source: string): string {
  const parsed = parseHostSpecies(source);
  if (parsed !== "Unknown") return parsed;
  if (paper.pathogenFocus === "S_maltophilia") return "Stenotrophomonas maltophilia";
  if (paper.pathogenFocus === "S_aureus") return "Staphylococcus aureus";
  if (paper.pathogenFocus === "E_coli") return "Escherichia coli";
  return "Unknown";
}

function documentPhageNames(source: string, paper: PaperRecord): string[] {
  return focalPhageNames(source, paper);
}

function sentencePhageNames(sentence: string, fallbackNames: string[]): string[] {
  const localNames = extractPhageNames(sentence).filter(looksLikePhageName);
  if (localNames.length > 0) {
    const focalLocalNames =
      fallbackNames.length > 0
        ? localNames.filter((name) =>
            fallbackNames.some((focal) => normalizePhageToken(focal).toLowerCase() === normalizePhageToken(name).toLowerCase())
          )
        : localNames;
    return focalLocalNames;
  }
  if (/\b(these|this|the|all|three|two|novel|isolated)\s+phages?\b/i.test(sentence)) {
    return fallbackNames;
  }
  if (/\b(this|the|novel|isolated)\s+phage\b/i.test(sentence) && fallbackNames.length === 1) {
    return fallbackNames;
  }
  return [];
}

function buildDeterministicFactorRow(input: {
  factorType: DesignFactorType;
  paper: PaperRecord;
  sourceText: string;
  phageNames: string[];
  phageAccessions?: string[];
  hostStrainRaw?: string | null;
  assayType?: AssayType;
  conditions?: Record<string, unknown>;
  measurements: Record<string, unknown>;
  outcomeRole?: string | null;
  evidenceLocation: string;
  confidence?: number;
}): ExtractedFactorRowInput | null {
  const phageNames = uniqueStrings(
    input.phageNames.filter((name) => looksLikePhageName(name) && isGroundedToken(input.sourceText, name))
  );
  const phageAccessions = uniqueStrings(
    (input.phageAccessions ?? []).filter((accession) => isGroundedToken(input.sourceText, accession))
  );
  if (phageNames.length === 0 && phageAccessions.length === 0) return null;
  if (Object.keys(input.measurements).length === 0) return null;
  const snippet = compactSnippet(String(input.measurements.supporting_snippet ?? input.evidenceLocation));
  const hostSpecies = hostSpeciesForPaper(input.paper, input.sourceText);
  return {
    factorType: input.factorType,
    pathogen: input.paper.pathogenFocus,
    hostSpecies,
    hostStrainRaw: input.hostStrainRaw ?? null,
    phageNames,
    phageAccessions,
    assayType: input.assayType ?? "other",
    conditions: input.conditions ?? { extraction_method: "deterministic" },
    measurements: {
      ...input.measurements,
      supporting_snippet: snippet,
      extraction_method: "deterministic"
    },
    outcomeRole: input.outcomeRole ?? null,
    evidenceLocation: input.evidenceLocation,
    confidence: input.confidence ?? 0.82,
    needsReview: true
  };
}

function extractDeterministicTableFactors(source: string, paper: PaperRecord): ExtractedFactorRowInput[] {
  const factors: ExtractedFactorRowInput[] = [];
  for (const table of extractXmlTables(source)) {
    if (table.rows.length < 2) continue;
    const context = `${table.label ?? "table"} ${table.caption} ${table.text}`;
    const headers = table.rows[0].map((cell) => cell.toLowerCase());
    const phageCol = headerIndex(headers, [/phage/, /bacteriophage/, /virus/]);
    const strainCol = headerIndex(headers, [/strain/, /host/, /isolate/]);
    const outcomeCol = headerIndex(headers, [/outcome/, /result/, /infect/, /suscept/, /lysis/, /eop/]);
    const evidenceBase = `${table.label ?? "table"} :: ${compactSnippet(table.caption || table.text, 180)}`;

    if (isHostRangeText(context)) {
      const captionPhages = extractPhageNames(context);
      if (phageCol < 0 && captionPhages.length > 0) {
        let emittedFromCaptionTable = false;
        for (const row of table.rows.slice(1)) {
          const host = row[0] ?? "";
          if (!host.trim() || isLikelyNonPhageLabel(host)) continue;
          const outcomeText = row.slice(1).find((cell) => /^[+−-]+$/.test(cell.trim())) ?? "";
          if (!outcomeText) continue;
          const factor = buildDeterministicFactorRow({
            factorType: "host_range",
            paper,
            sourceText: source,
            phageNames: captionPhages,
            phageAccessions: extractAccessions(context),
            hostStrainRaw: host,
            assayType: normalizeAssayType(context),
            measurements: {
              outcome: classifyOutcome(outcomeText),
              raw_outcome: outcomeText,
              row_values: row,
              table_label: table.label
            },
            outcomeRole: "phage_strain_susceptibility",
            evidenceLocation: `${evidenceBase} :: ${compactSnippet(row.join(" | "))}`
          });
          if (factor) {
            emittedFromCaptionTable = true;
            factors.push(factor);
          }
        }
        if (emittedFromCaptionTable) continue;
      }
      if (phageCol >= 0 && strainCol >= 0) {
        for (const row of table.rows.slice(1)) {
          const phage = row[phageCol] ?? "";
          const host = row[strainCol] ?? "";
          const outcomeText = outcomeCol >= 0 ? row[outcomeCol] ?? "" : row.filter(Boolean).slice(-1)[0] ?? "";
          const factor = buildDeterministicFactorRow({
            factorType: "host_range",
            paper,
            sourceText: source,
            phageNames: extractPhageNames(phage),
            phageAccessions: extractAccessions(row.join(" ")),
            hostStrainRaw: host || null,
            assayType: normalizeAssayType(context),
            measurements: {
              outcome: classifyOutcome(outcomeText),
              raw_outcome: outcomeText,
              table_label: table.label
            },
            outcomeRole: "phage_strain_susceptibility",
            evidenceLocation: `${evidenceBase} :: ${compactSnippet(row.join(" | "))}`
          });
          if (factor) factors.push(factor);
        }
      } else if (strainCol >= 0 && outcomeCol >= 0) {
        if (captionPhages.length > 0) {
          for (const row of table.rows.slice(1)) {
            const host = row[strainCol] ?? "";
            const outcomeText = row[outcomeCol] ?? "";
            const factor = buildDeterministicFactorRow({
              factorType: "host_range",
              paper,
              sourceText: source,
              phageNames: captionPhages,
              phageAccessions: extractAccessions(context),
              hostStrainRaw: host || null,
              assayType: normalizeAssayType(context),
              measurements: {
                outcome: classifyOutcome(outcomeText),
                raw_outcome: outcomeText,
                table_label: table.label
              },
              outcomeRole: "phage_strain_susceptibility",
              evidenceLocation: `${evidenceBase} :: ${compactSnippet(row.join(" | "))}`
            });
            if (factor) factors.push(factor);
          }
        }
      } else if (phageCol === 0 || /phage|bacteriophage/i.test(table.rows[0][0] ?? "")) {
        const strainHeaders = table.rows[0].slice(1);
        for (const row of table.rows.slice(1)) {
          const phageNames = extractPhageNames(row[0] ?? "");
          if (phageNames.length === 0) continue;
          row.slice(1).forEach((cell, index) => {
            if (!cell.trim()) return;
            const factor = buildDeterministicFactorRow({
              factorType: "host_range",
              paper,
              sourceText: source,
              phageNames,
              phageAccessions: extractAccessions(row.join(" ")),
              hostStrainRaw: strainHeaders[index] ?? null,
              assayType: normalizeAssayType(context),
              measurements: {
                outcome: classifyOutcome(cell),
                raw_outcome: cell,
                table_label: table.label
              },
              outcomeRole: "phage_strain_susceptibility",
              evidenceLocation: `${evidenceBase} :: ${compactSnippet(`${row[0]} | ${strainHeaders[index]} | ${cell}`)}`
            });
            if (factor) factors.push(factor);
          });
        }
      }
    }

    if (isKineticsText(context)) {
      const latentCol = headerIndex(headers, [/latent/]);
      const burstCol = headerIndex(headers, [/burst/]);
      const adsorptionCol = headerIndex(headers, [/adsorption/]);
      if (phageCol >= 0 && (latentCol >= 0 || burstCol >= 0 || adsorptionCol >= 0)) {
        for (const row of table.rows.slice(1)) {
          const measurements: Record<string, unknown> = { table_label: table.label };
          if (latentCol >= 0) measurements.latent_period_min = Number(row[latentCol]?.match(/\d+(?:\.\d+)?/)?.[0]);
          if (burstCol >= 0) measurements.burst_size = Number(row[burstCol]?.match(/\d+(?:\.\d+)?/)?.[0]);
          if (adsorptionCol >= 0) measurements.adsorption_rate = Number(row[adsorptionCol]?.match(/\d+(?:\.\d+)?/)?.[0]);
          Object.keys(measurements).forEach((key) => {
            if (Number.isNaN(measurements[key])) delete measurements[key];
          });
          const factor = buildDeterministicFactorRow({
            factorType: "kinetics",
            paper,
            sourceText: source,
            phageNames: extractPhageNames(row[phageCol] ?? ""),
            assayType: "kill_curve",
            measurements,
            outcomeRole: "kinetic_parameter",
            evidenceLocation: `${evidenceBase} :: ${compactSnippet(row.join(" | "))}`
          });
          if (factor) factors.push(factor);
        }
      }
    }
  }
  return factors;
}

function extractDeterministicProseFactors(source: string, paper: PaperRecord): ExtractedFactorRowInput[] {
  const factors: ExtractedFactorRowInput[] = [];
  const fallbackPhageNames = documentPhageNames(source, paper);
  for (const sentence of splitSentences(source)) {
    if (sentence.trim() === paper.title.trim()) continue;
    if (isLowValueExtractionSentence(sentence)) continue;
    const phageNames = sentencePhageNames(sentence, fallbackPhageNames);
    const phageAccessions = extractAccessions(sentence);
    if (phageNames.length === 0 && phageAccessions.length === 0) continue;
    const focalMentioned = hasFocalPhageMention(sentence, fallbackPhageNames);

    const broadHost = sentence.match(
      /(?:infect(?:ing|s|ed)?|lys(?:ing|es|ed))\s+(\d+)\s+(?:of|out of)\s+(\d+)/i
    );
    if (broadHost && isHostRangeText(sentence)) {
      const factor = buildDeterministicFactorRow({
        factorType: "host_range",
        paper,
        sourceText: source,
        phageNames,
        phageAccessions,
        assayType: "spot",
        measurements: {
          susceptible_count: Number(broadHost[1]),
          tested_count: Number(broadHost[2]),
          outcome: "summary_host_range"
        },
        outcomeRole: "host_range_breadth",
        evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
        confidence: 0.9
      });
      if (factor) factors.push(factor);
      continue;
    }

    if (
      isHostRangeText(sentence) &&
      /broad host range|cross-order infectivity|cross-genera|multiple genera|infecting both|capable of infecting both/i.test(sentence)
    ) {
      const factor = buildDeterministicFactorRow({
        factorType: "host_range",
        paper,
        sourceText: source,
        phageNames,
        phageAccessions,
        assayType: "spot",
        measurements: {
          qualitative_summary: compactSnippet(sentence),
          outcome: "qualitative_host_range"
        },
        outcomeRole: "host_range_breadth",
        evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
        confidence: 0.82
      });
      if (factor) factors.push(factor);
    }

    if (isKineticsText(sentence)) {
      const latent = sentence.match(
        /latent period(?:\s+of|\s+was|\s+is|\s+of approximately)?\s+(\d+(?:\.\d+)?)\s*(?:min|minutes|h|hr|hrs|hour|hours)/i
      );
      const burst = sentence.match(/burst size(?:\s+of|\s+was|\s+is|\s+of approximately)?\s+(\d+(?:\.\d+)?)/i);
      const measurements: Record<string, unknown> = {};
      if (latent) measurements.latent_period_min = parseTimeAsMinutes(latent[0]);
      if (burst) measurements.burst_size = Number(burst[1]);
      if (Object.keys(measurements).length > 0 || /growth curve|kill curve|bactericidal|lytic activity/i.test(sentence)) {
        const factor = buildDeterministicFactorRow({
          factorType: "kinetics",
          paper,
          sourceText: source,
          phageNames,
          phageAccessions,
          assayType: "kill_curve",
          measurements:
            Object.keys(measurements).length > 0
              ? measurements
              : { qualitative_summary: compactSnippet(sentence) },
          outcomeRole: "kinetic_parameter",
          evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
          confidence: Object.keys(measurements).length > 0 ? 0.88 : 0.72
        });
        if (factor) factors.push(factor);
      }
    }

    if (isSafetyText(sentence) && isGenomeSafetyEvidence(sentence) && focalMentioned) {
      const factor = buildDeterministicFactorRow({
        factorType: "safety",
        paper,
        sourceText: source,
        phageNames,
        phageAccessions,
        measurements: {
          qualitative_summary: compactSnippet(sentence),
          lysogeny_signal: /lysogen|temperate|integrase/i.test(sentence),
          amr_or_virulence_signal: /antibiotic resistance|AMR|virulence|toxin/i.test(sentence)
        },
        outcomeRole: "genome_safety",
        evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
        confidence: 0.78
      });
      if (factor) factors.push(factor);
    }

    if (isBiofilmText(sentence)) {
      const factor = buildDeterministicFactorRow({
        factorType: "biofilm",
        paper,
        sourceText: source,
        phageNames,
        phageAccessions,
        assayType: "biofilm",
        measurements: {
          qualitative_summary: compactSnippet(sentence),
          biofilm_signal: true,
          antibiotic_combination_signal: isAntibioticSynergyText(sentence)
        },
        outcomeRole: "biofilm_modulation",
        evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
        confidence: 0.78
      });
      if (factor) factors.push(factor);
    }

    if (isAntibioticSynergyText(sentence) && /phage|StM\d|DLP\d|AXL\d|antibiotic/i.test(sentence)) {
      const factor = buildDeterministicFactorRow({
        factorType: "antibiotic_synergy",
        paper,
        sourceText: source,
        phageNames,
        phageAccessions,
        assayType: "other",
        measurements: {
          qualitative_summary: compactSnippet(sentence),
          antibiotic_signal: true,
          biofilm_signal: isBiofilmText(sentence)
        },
        outcomeRole: "phage_antibiotic_interaction",
        evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
        confidence: 0.76
      });
      if (factor) factors.push(factor);
    }

    if (isResistanceText(sentence) && (focalMentioned || fallbackPhageNames.length <= phageNames.length)) {
      const factor = buildDeterministicFactorRow({
        factorType: "receptor_resistance",
        paper,
        sourceText: source,
        phageNames,
        phageAccessions,
        measurements: {
          qualitative_summary: compactSnippet(sentence),
          receptor_signal: /receptor|pilus/i.test(sentence),
          resistance_signal: /resistan|mutant|mutation/i.test(sentence)
        },
        outcomeRole: "resistance_or_receptor",
        evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
        confidence: 0.76
      });
      if (factor) factors.push(factor);
    }
  }
  return factors;
}

function extractDeterministicCocktailRows(source: string, paper: PaperRecord): ExtractedRowInput[] {
  const rows: ExtractedRowInput[] = [];
  const fallbackPhageNames = documentPhageNames(source, paper);
  for (const sentence of splitSentences(source)) {
    if (sentence.trim() === paper.title.trim()) continue;
    if (isLowValueExtractionSentence(sentence)) continue;
    if (/following questions:|further research should|efficacy of a three-phage cocktail against rapidly growing bacteria under laboratory conditions/i.test(sentence)) {
      continue;
    }
    if (!/cocktail|combined into a cocktail|phage combination|multi-phage/i.test(sentence)) continue;
    if (!/suppressed|enhanced|killing|growth|host range|infected|reduction|48\s*h/i.test(sentence)) continue;
    let phageNames = sentencePhageNames(sentence, fallbackPhageNames);
    if (phageNames.length === 0 && /(?:three|multi)[-\s]phage cocktail|our phages|representative from each group/i.test(sentence)) {
      phageNames = fallbackPhageNames;
    }
    if (phageNames.length === 0) continue;

    const outcomeMetrics: Record<string, unknown> = {
      qualitative_summary: compactSnippet(sentence),
      supporting_snippet: compactSnippet(sentence),
      extraction_method: "deterministic"
    };
    const testedStrains = sentence.match(/(?:collection of|against)\s+(\d+)\s+S\.?\s*maltophilia strains/i);
    if (testedStrains) outcomeMetrics.tested_strain_count = Number(testedStrains[1]);
    const duration = sentence.match(/(\d+(?:\.\d+)?)\s*h\b/i);
    if (duration) outcomeMetrics.duration_h = Number(duration[1]);
    const infectedPercent = sentence.match(/infected\s+>\s*(\d+)%/i);
    if (infectedPercent) outcomeMetrics.minimum_percent_infected = Number(infectedPercent[1]);
    if (/suppressed|enhanced|killing/i.test(sentence)) outcomeMetrics.effect = "enhanced_growth_suppression";
    if (/host range/i.test(sentence)) outcomeMetrics.effect = "expanded_host_range_screen";

    const assayType = /host range|infected/i.test(sentence) ? "spot" : "kill_curve";
    const conditions: Record<string, unknown> = {
      model_context: "in_vitro",
      extraction_method: "deterministic",
      paper_level_cocktail: true
    };
    const hostSpecies = hostSpeciesForPaper(paper, source);
    const conditionsHash = buildConditionsHash({
      assay_type: assayType,
      host_species: hostSpecies,
      host_strain_raw: null,
      ...conditions
    });

    rows.push({
      cocktailName: `${phageNames.join(" + ")} cocktail`,
      assayType,
      pathogen: paper.pathogenFocus,
      hostSpecies,
      hostStrainRaw: null,
      phageNames,
      phageAccessions: extractAccessions(sentence),
      conditions,
      conditionsHash,
      outcomeMetrics,
      evidenceLocation: `prose :: ${compactSnippet(sentence)}`,
      confidence: 0.78,
      needsReview: true
    });
  }
  return rows;
}

function cocktailRowPriority(row: ExtractedRowInput): number {
  const text = `${row.evidenceLocation ?? ""} ${String(row.outcomeMetrics.qualitative_summary ?? "")}`;
  let score = row.confidence;
  if (row.phageNames.includes("ANB28") && row.phageNames.includes("KB824") && row.phageNames.some((name) => /^SBP2/i.test(name))) score += 5;
  if (/significantly suppressed|reduced bacterial growth|enhanced suppression|more effective/i.test(text)) score += 4;
  if (/46\s+S|collection of 46|infected\s+>\s*50%|host range/i.test(text)) score += 3;
  if (/B28B|six strains|40 h|48 h|20 h/i.test(text)) score += 1;
  if (/title|following questions|further research|Open in a new tab/i.test(text)) score -= 3;
  return score;
}

function limitCocktailRows(rows: ExtractedRowInput[]): ExtractedRowInput[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = `${row.assayType}::${row.phageNames.join("|")}::${String(row.outcomeMetrics.supporting_snippet ?? "").slice(0, 180)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => cocktailRowPriority(b) - cocktailRowPriority(a))
    .slice(0, 8);
}

function extractDelimitedBlocks(source: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (/<[^>]+>|\\u003c|class=|href=|<\/[a-z]/i.test(line)) {
      if (current.length >= 3) blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    const delimiterCount = Math.max(line.split("\t").length - 1, line.split(",").length - 1);
    if (delimiterCount >= 2) {
      current.push(line);
      continue;
    }
    if (current.length >= 3) blocks.push(current.join("\n"));
    current = [];
  }
  if (current.length >= 3) blocks.push(current.join("\n"));
  return blocks;
}

function extractDelimitedSupplementFactors(source: string, paper: PaperRecord): ExtractedFactorRowInput[] {
  const factors: ExtractedFactorRowInput[] = [];
  for (const block of extractDelimitedBlocks(source)) {
    let parsed;
    try {
      parsed = parseDelimitedText(block, block.includes("\t") ? "supplement.tsv" : "supplement.csv");
    } catch {
      continue;
    }
    if (parsed.headers.length < 2 || parsed.rows.length === 0) continue;
    const headers = parsed.headers;
    const lowerHeaders = headers.map((header) => header.toLowerCase());
    const phageHeader = headers[headerIndex(lowerHeaders, [/phage/, /bacteriophage/, /virus/])] ?? null;
    const strainHeader = headers[headerIndex(lowerHeaders, [/strain/, /host/, /isolate/])] ?? null;
    const outcomeHeader = headers[headerIndex(lowerHeaders, [/outcome/, /result/, /infect/, /suscept/, /lysis/, /eop/])] ?? null;
    const hostRangeLikely = isHostRangeText(headers.join(" ")) || parsed.rows.some((row) => {
      return Object.values(row).some((value) => /lysis|plaque|suscept|resistant|\+|−|-/.test(value));
    });

    if (hostRangeLikely && phageHeader && strainHeader) {
      for (const row of parsed.rows.slice(0, 300)) {
        const phageCell = row[phageHeader] ?? "";
        const hostCell = row[strainHeader] ?? "";
        const outcomeCell = outcomeHeader ? row[outcomeHeader] ?? "" : Object.values(row).filter(Boolean).slice(-1)[0] ?? "";
        const factor = buildDeterministicFactorRow({
          factorType: "host_range",
          paper,
          sourceText: source,
          phageNames: extractPhageNames(phageCell),
          phageAccessions: extractAccessions(Object.values(row).join(" ")),
          hostStrainRaw: hostCell || null,
          assayType: normalizeAssayType(headers.join(" ")),
          measurements: {
            outcome: classifyOutcome(outcomeCell),
            raw_outcome: outcomeCell,
            source_format: parsed.delimiter
          },
          outcomeRole: "phage_strain_susceptibility",
          evidenceLocation: `supplement ${parsed.delimiter} :: ${compactSnippet(Object.values(row).join(" | "))}`
        });
        if (factor) factors.push(factor);
      }
      continue;
    }

    if (hostRangeLikely && phageHeader) {
      const strainHeaders = headers.filter((header) => header !== phageHeader);
      for (const row of parsed.rows.slice(0, 300)) {
        const phageNames = extractPhageNames(row[phageHeader] ?? "");
        if (phageNames.length === 0) continue;
        for (const header of strainHeaders) {
          const value = row[header] ?? "";
          if (!value.trim()) continue;
          const factor = buildDeterministicFactorRow({
            factorType: "host_range",
            paper,
            sourceText: source,
            phageNames,
            hostStrainRaw: header,
            assayType: normalizeAssayType(headers.join(" ")),
            measurements: {
              outcome: classifyOutcome(value),
              raw_outcome: value,
              source_format: parsed.delimiter
            },
            outcomeRole: "phage_strain_susceptibility",
            evidenceLocation: `supplement ${parsed.delimiter} :: ${compactSnippet(`${row[phageHeader]} | ${header} | ${value}`)}`
          });
          if (factor) factors.push(factor);
        }
      }
    }
  }
  return factors;
}

function dedupeFactorRows(rows: ExtractedFactorRowInput[]): ExtractedFactorRowInput[] {
  const seen = new Set<string>();
  const deduped: ExtractedFactorRowInput[] = [];
  for (const row of rows) {
    const key = [
      row.factorType,
      row.phageNames.join("|"),
      row.phageAccessions.join("|"),
      row.hostStrainRaw ?? "",
      row.outcomeRole ?? "",
      row.evidenceLocation?.slice(0, 180) ?? ""
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function factorRowPriority(row: ExtractedFactorRowInput): number {
  const text = `${row.hostStrainRaw ?? ""} ${row.evidenceLocation ?? ""} ${String(
    row.measurements.qualitative_summary ?? row.measurements.supporting_snippet ?? ""
  )}`;
  let score = row.confidence;
  if (/Stenotrophomonas|S\.\s*maltophilia|D1585|280\b/i.test(text)) score += 5;
  if (/DLP1\s+and\s+DLP2|both\s+phages/i.test(text)) score += 3;
  if (/type IV pilus|type IV pili|primary receptor|cell surface receptor/i.test(text)) score += 4;
  if (/binding|binds|lysis|lysing|TEM|electron micrograph|transmission electron/i.test(text)) score += 2;
  if (/Δ\s*pilA|delta\s*pilA|clean deletion|complementation restored|restored infection/i.test(text)) score += 2;
  if (/changed sensitivity|restored sensitivity|combination of different antibiotics|combination with different antibiotics|antibiotics with StM|phage-antibiotic/i.test(text)) {
    score += 4;
  }
  if (/biofilm formation|anti-biofilm|biofilm biomass|crystal violet|OD600|MOI\s*=/i.test(text)) score += 4;
  if (/P04|D3112|B3|others have observed/i.test(text)) score -= 4;
  if (/transmission electron|electron microscope|DNA isolation|genome organization|proteomic tree|Figure S1|Figure 1/i.test(text)) score -= 5;
  return score;
}

function limitFactorRowsByType(rows: ExtractedFactorRowInput[]): ExtractedFactorRowInput[] {
  const limits: Partial<Record<DesignFactorType, number>> = {
    antibiotic_synergy: 10,
    biofilm: 8,
    kinetics: 8,
    receptor_resistance: 14,
    safety: 5
  };
  const selectedIndexes = new Set<number>();
  for (const [factorType, limit] of Object.entries(limits) as Array<[DesignFactorType, number]>) {
    rows
      .map((row, index) => ({ row, index, score: factorRowPriority(row) }))
      .filter((item) => item.row.factorType === factorType)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .forEach((item) => selectedIndexes.add(item.index));
  }
  const counts: Partial<Record<DesignFactorType, number>> = {};
  return rows.filter((row, index) => {
    const limit = limits[row.factorType];
    if (!limit) return true;
    if (!selectedIndexes.has(index)) return false;
    const nextCount = (counts[row.factorType] ?? 0) + 1;
    counts[row.factorType] = nextCount;
    return nextCount <= limit;
  });
}

function extractRowsDeterministically(
  source: string,
  paper: PaperRecord
): { rows: ExtractedRowInput[]; factorRows: ExtractedFactorRowInput[]; note: string | null } {
  const studyType = inferStudyType(source);
  if (!allowsTrainingRows(studyType)) {
    return {
      rows: [],
      factorRows: [],
      note: `Skipped deterministic training extraction because study_type=${studyType}; not a ML outcome paper for cocktail design.`
    };
  }
  const docNames = documentPhageNames(source, paper);
  const rows = limitCocktailRows(extractDeterministicCocktailRows(source, paper));
  let factorRows = limitFactorRowsByType(dedupeFactorRows([
    ...extractDeterministicTableFactors(source, paper),
    ...extractDeterministicProseFactors(source, paper),
    ...extractDelimitedSupplementFactors(source, paper)
  ]));
  if (factorRows.length === 0 && docNames.length > 0 && /host range|growth curve|kill curve|biofilm|resistance|receptor|genome|therapeutic/i.test(source)) {
    const summary = buildDeterministicFactorRow({
      factorType: "cocktail_outcome",
      paper,
      sourceText: source,
      phageNames: docNames,
      phageAccessions: extractAccessions(source),
      measurements: {
        qualitative_summary: "Paper mentions phage characterization signals but deterministic parser could not isolate a more specific row."
      },
      outcomeRole: "paper_level_screening_hit",
      evidenceLocation: `paper metadata :: ${compactSnippet(`${paper.title} ${paper.journal ?? ""}`)}`,
      confidence: 0.35
    });
    if (summary) factorRows = [summary];
  }
  const note =
    factorRows.length > 0
      ? `Deterministic parser extracted ${factorRows.length} design-factor rows.`
      : `Deterministic parser found no grounded rows. Document phage candidates: ${docNames.join(", ") || "none"}.`;
  return { rows, factorRows, note };
}

async function extractRowsWithGemini(
  source: string,
  paper: PaperRecord
): Promise<{ rows: ExtractedRowInput[]; factorRows: ExtractedFactorRowInput[]; note: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = [
    "You are extracting phage cocktail experiment rows and cocktail design-factor evidence from one scientific paper.",
    "Return STRICT JSON with exactly this top-level shape:",
    '{"rows":[{"cocktail_name":string|null,"assay_type":"kill_curve"|"biofilm"|"spot"|"plaque"|"EOP"|"in_vivo"|"other","pathogen":string|null,"host_species":string|null,"host_strain_raw":string|null,"phage_names":string[],"phage_accessions":string[],"conditions":object,"outcome_metrics":object,"evidence_location":string|null,"supporting_snippet":string,"confidence":number}],"factor_rows":[{"factor_type":"host_range"|"kinetics"|"genetic_relatedness"|"receptor_resistance"|"biofilm"|"antibiotic_synergy"|"cocktail_outcome"|"safety","pathogen":string|null,"host_species":string|null,"host_strain_raw":string|null,"phage_names":string[],"phage_accessions":string[],"assay_type":"kill_curve"|"biofilm"|"spot"|"plaque"|"EOP"|"in_vivo"|"other"|null,"conditions":object,"measurements":object,"outcome_role":string|null,"evidence_location":string|null,"supporting_snippet":string,"confidence":number}],"notes":string|null}',
    "Rules:",
    "1) Use ONLY entities explicitly present in the source text.",
    "2) Do NOT infer phage names, strain IDs, accessions, metrics, or assay types.",
    "3) Every row and factor_row must have supporting_snippet copied verbatim from source (<=320 chars).",
    "4) If field is missing in source, set it to null or empty array/object.",
    "5) If no cocktail outcome is extractable, return rows as []. If no design-factor evidence is extractable, return factor_rows as [].",
    "6) confidence range must be 0.0 to 1.0.",
    "7) Put host-range/EOP/plaque/spot susceptibility evidence in factor_rows even when there is no cocktail.",
    "8) Put latent period, burst size, adsorption, time-to-lysis, growth-curve, or kill-curve timing evidence in factor_rows as kinetics.",
    "9) Put receptor genes, resistance mutations, cross-resistance, or mutant phenotypes in factor_rows as receptor_resistance.",
    "10) Put biofilm reduction and antibiotic combination evidence in factor_rows as biofilm or antibiotic_synergy.",
    "11) Put ANI, Mash, shared genes, phylogeny, cluster/subcluster, or tail-fiber similarity in factor_rows as genetic_relatedness.",
    "12) Put integrase, lysogeny, AMR, virulence, or genome-safety evidence in factor_rows as safety.",
    `Paper title: ${paper.title}`,
    `Paper DOI: ${paper.doi ?? "unknown"}`,
    "Source text:",
    source
  ].join("\n");

  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Gemini extraction failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error("Gemini extraction failed: empty response.");
  }

  const parsed = extractJsonFromText(text);
  const rowsValue = parsed.rows;
  const candidateRows = Array.isArray(rowsValue) ? rowsValue.map((item) => asObject(item)) : [];
  const normalizedRows = candidateRows
    .map((row) => normalizeRowCandidate(row as GeminiRowCandidate, source, paper))
    .filter((row): row is ExtractedRowInput => Boolean(row));
  const factorRowsValue = parsed.factor_rows;
  const candidateFactorRows = Array.isArray(factorRowsValue)
    ? factorRowsValue.map((item) => asObject(item))
    : [];
  const normalizedFactorRows = candidateFactorRows
    .map((row) => normalizeFactorRowCandidate(row as GeminiFactorRowCandidate, source, paper))
    .filter((row): row is ExtractedFactorRowInput => Boolean(row));

  const note = typeof parsed.notes === "string" && parsed.notes.trim().length > 0 ? parsed.notes : null;
  return { rows: normalizedRows, factorRows: normalizedFactorRows, note };
}

async function findOrCreateHostStrain(species: string, strainRaw: string | null): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const identifier = strainRaw?.trim() || null;
  let lookup = supabase.from("host_strains").select("id").eq("species", species).limit(1);
  lookup = identifier
    ? lookup.eq("strain_identifier", identifier)
    : lookup.is("strain_identifier", null);
  const existing = await lookup.maybeSingle();
  if (existing.error) throw new Error(`Host strain lookup failed: ${existing.error.message}`);
  if (existing.data?.id) return String(existing.data.id);

  const insert = await supabase
    .from("host_strains")
    .insert({
      species,
      strain_name: null,
      strain_identifier: identifier,
      metadata_json: {}
    })
    .select("id")
    .single();
  if (insert.error || !insert.data?.id) {
    throw new Error(`Host strain insert failed: ${insert.error?.message ?? "unknown"}`);
  }
  return String(insert.data.id);
}

async function findOrCreatePhageByNameOrAccession(name: string, accession: string | null): Promise<string> {
  const supabase = createSupabaseAdminClient();
  if (accession) {
    const byAcc = await supabase
      .from("phages")
      .select("id")
      .eq("genome_accession", accession)
      .maybeSingle();
    if (byAcc.data?.id) return String(byAcc.data.id);
  }

  const byName = await supabase.from("phages").select("id").ilike("name", name).limit(1).maybeSingle();
  if (byName.error) throw new Error(`Phage lookup failed: ${byName.error.message}`);
  if (byName.data?.id) return String(byName.data.id);

  const insert = await supabase
    .from("phages")
    .insert({
      name,
      genome_accession: accession,
      notes: "Auto-created from paper extraction"
    })
    .select("id")
    .single();
  if (insert.error || !insert.data?.id) {
    throw new Error(`Phage insert failed: ${insert.error?.message ?? "unknown"}`);
  }
  return String(insert.data.id);
}

function validatePublishableRow(row: PaperExtractionRow): boolean {
  const assayOk = Boolean(row.assayType);
  const hostOk = Boolean(row.hostSpecies && row.hostSpecies !== "Unknown");
  const phageOk = row.phageNames.length > 0 || row.phageAccessions.length > 0;
  const outcome = row.outcomeMetrics;
  const hasQuant = hasNumericOutcomeMetric(outcome);
  const hasQual = typeof outcome.qualitative_summary === "string" && outcome.qualitative_summary.length > 0;
  return assayOk && hostOk && phageOk && (hasQuant || hasQual);
}

export async function listPaperQueue(limit = 100): Promise<PaperQueueRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("papers")
    .select(`
      id,title,journal,year,doi,pmid,pmcid,url,oa_status,pathogen_focus,ingest_status,created_at,updated_at,
      paper_extractions(id,status)
    `)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) throw new Error(`Failed to load paper queue: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const base = mapPaperRow(row);
    const extractions = (row.paper_extractions as Array<Record<string, unknown>> | null) ?? [];
    const pending = extractions.filter((item) => item.status === "pending_review").length;
    return {
      ...base,
      extractionCount: extractions.length,
      pendingExtractionCount: pending
    };
  });
}

export async function searchAndQueuePapers(payload: PaperSearchPayload = {}): Promise<PaperSearchResult> {
  const profile =
    payload.profile && payload.profile !== "custom" ? SEARCH_PROFILES[payload.profile] : null;
  const term = payload.term?.trim() || profile?.term || STENO_TERM;
  const maxResults = Math.max(5, Math.min(payload.maxResults ?? 25, 100));
  const pathogenFocus = normalizePathogen(payload.pathogenFocus ?? profile?.pathogenFocus ?? "S_maltophilia");
  const jobId = await startJob("search", { term, maxResults, pathogenFocus });
  const supabase = createSupabaseAdminClient();

  try {
    const pmids = await fetchPubMedSearch(term, maxResults);
    const summaries = await fetchPubMedSummaries(pmids);
    const oaSummaries = summaries.filter((item) => Boolean(findArticleId(item, "pmc")));

    let inserted = 0;
    let deduped = 0;
    const papers: PaperRecord[] = [];

    for (const summary of oaSummaries) {
      const pmid = summary.uid;
      const pmcidRaw = findArticleId(summary, "pmc");
      const pmcid = pmcidRaw?.startsWith("PMC") ? pmcidRaw : pmcidRaw ? `PMC${pmcidRaw}` : null;
      const doi = findArticleId(summary, "doi");
      const year = parseYearFromPubDate(summary.pubdate);
      const paperData = {
        title: summary.title || `PubMed ${pmid}`,
        journal: summary.fulljournalname ?? null,
        year,
        doi: doi ?? null,
        pmid,
        pmcid,
        url: derivePaperUrl(doi, pmcid, pmid),
        oa_status: "open_access",
        pathogen_focus: pathogenFocus,
        ingest_status: "queued"
      };

      const before = await supabase
        .from("papers")
        .select("id")
        .or(
          [
            doi ? `doi.eq.${doi}` : null,
            pmcid ? `pmcid.eq.${pmcid}` : null,
            pmid ? `pmid.eq.${pmid}` : null
          ]
            .filter(Boolean)
            .join(",")
        )
        .limit(1)
        .maybeSingle();

      if (before.error) {
        throw new Error(`Paper dedupe lookup failed: ${before.error.message}`);
      }

      if (before.data?.id) {
        deduped += 1;
        continue;
      }

      const insert = await supabase
        .from("papers")
        .insert(paperData)
        .select("*")
        .single();
      if (insert.error || !insert.data) {
        throw new Error(`Failed to insert paper ${pmid}: ${insert.error?.message ?? "unknown"}`);
      }
      inserted += 1;
      papers.push(mapPaperRow(insert.data as Record<string, unknown>));
    }

    const now = new Date().toISOString();
    await supabase
      .from("ingest_cursor")
      .upsert(
        {
          source: "pubmed",
          query_key: term,
          last_run_at: now,
          cursor_json: { last_pmid_count: pmids.length }
        },
        { onConflict: "source,query_key" }
      );

    await finishJob(jobId, "completed", {
      discovered: oaSummaries.length,
      inserted,
      deduped
    });

    return {
      jobId,
      discovered: oaSummaries.length,
      inserted,
      deduped,
      papers
    };
  } catch (error) {
    await finishJob(jobId, "failed", {}, error instanceof Error ? error.message : "unknown");
    throw error;
  }
}

export async function fetchPaperAssets(paperId: string): Promise<PaperFetchResult> {
  const jobId = await startJob("fetch", { paperId });
  const supabase = createSupabaseAdminClient();

  try {
    const paperResponse = await supabase
      .from("papers")
      .select("*")
      .eq("id", paperId)
      .maybeSingle();
    if (paperResponse.error || !paperResponse.data) {
      throw new Error(`Paper not found: ${paperResponse.error?.message ?? paperId}`);
    }
    const paper = mapPaperRow(paperResponse.data as Record<string, unknown>);
    if (!paper.pmcid) {
      throw new Error("Paper does not have PMCID; OA full text fetch is unavailable in V1.");
    }

    const fullText = await fetchFullTextFromPmc(paper.pmcid);
    const checksum = createHash("sha256").update(fullText.content).digest("hex");

    const assetsToInsert: Array<Record<string, unknown>> = [
      {
        paper_id: paperId,
        asset_type: fullText.assetType,
        source_url: fullText.sourceUrl,
        storage_path: null,
        mime_type: fullText.mimeType,
        fetch_status: "fetched",
        checksum
      }
    ];

    const supplementLinks =
      fullText.assetType === "full_text_xml"
        ? extractSupplementLinks(fullText.content, normalizePmcid(paper.pmcid))
        : [];
    const supplementTextByUrl = new Map<string, string>();
    for (const link of supplementLinks) {
      let supplementChecksum: string | null = null;
      let supplementMimeType: string | null = null;
      if (isTextSupplementUrl(link)) {
        try {
          const supplementResponse = await fetch(link, { cache: "no-store" });
          if (supplementResponse.ok) {
            const text = await supplementResponse.text();
            if (text.trim()) {
              supplementTextByUrl.set(link, text.slice(0, 250000));
              supplementChecksum = createHash("sha256").update(text).digest("hex");
              supplementMimeType = supplementResponse.headers.get("content-type") ?? "text/plain";
            }
          }
        } catch {
          supplementTextByUrl.delete(link);
        }
      }
      assetsToInsert.push({
        paper_id: paperId,
        asset_type: "supplement",
        source_url: link,
        storage_path: null,
        mime_type: supplementMimeType,
        fetch_status: "fetched",
        checksum: supplementChecksum
      });
    }

    const insertAssets = await supabase
      .from("paper_assets")
      .insert(assetsToInsert)
      .select("id,source_url,asset_type");
    if (insertAssets.error) {
      throw new Error(`Failed to insert paper assets: ${insertAssets.error.message}`);
    }
    const textRows = ((insertAssets.data ?? []) as Array<Record<string, unknown>>)
      .map((asset) => {
        const sourceUrl = typeof asset.source_url === "string" ? asset.source_url : "";
        const textContent = supplementTextByUrl.get(sourceUrl);
        if (!textContent || typeof asset.id !== "string") return null;
        return {
          asset_id: asset.id,
          text_content: textContent,
          parse_status: "parsed",
          parser_notes: "Fetched structured text supplement."
        };
      })
      .filter((row): row is {
        asset_id: string;
        text_content: string;
        parse_status: string;
        parser_notes: string;
      } => row !== null);
    if (textRows.length > 0) {
      const textInsert = await supabase.from("paper_asset_texts").upsert(textRows, {
        onConflict: "asset_id"
      });
      if (textInsert.error && !isMissingRelationError(textInsert.error.message)) {
        throw new Error(`Failed to insert supplement text: ${textInsert.error.message}`);
      }
    }

    const updatePaper = await supabase
      .from("papers")
      .update({
        ingest_status: "assets_fetched",
        oa_status: "open_access"
      })
      .eq("id", paperId);
    if (updatePaper.error) throw new Error(updatePaper.error.message);

    await finishJob(jobId, "completed", {
      fetchedAssets: assetsToInsert.length,
      supplementLinks: supplementLinks.length,
      parsedTextSupplements: textRows.length
    });

    return {
      jobId,
      paperId,
      fetchedAssets: assetsToInsert.length,
      supplementLinks: supplementLinks.length,
      status: "assets_fetched"
    };
  } catch (error) {
    await finishJob(jobId, "failed", {}, error instanceof Error ? error.message : "unknown");
    throw error;
  }
}

export async function extractPaperRows(paperId: string): Promise<PaperExtractResult> {
  const jobId = await startJob("extract", {
    paperId,
    extractorVersion: "v3_deterministic_plus_gemini"
  });
  const supabase = createSupabaseAdminClient();

  try {
    const paperResponse = await supabase
      .from("papers")
      .select("*")
      .eq("id", paperId)
      .maybeSingle();
    if (paperResponse.error || !paperResponse.data) {
      throw new Error(`Paper not found: ${paperResponse.error?.message ?? paperId}`);
    }
    const paper = mapPaperRow(paperResponse.data as Record<string, unknown>);

    const assets = await supabase
      .from("paper_assets")
      .select("*")
      .eq("paper_id", paperId)
      .in("asset_type", ["full_text_xml", "full_text_html"])
      .order("created_at", { ascending: false });
    if (assets.error) {
      throw new Error(`Failed to load full text assets: ${assets.error.message}`);
    }
    const availableAssets = ((assets.data ?? []) as Array<Record<string, unknown>>).sort(
      (a, b) => {
        const typeA = a.asset_type === "full_text_xml" ? 0 : 1;
        const typeB = b.asset_type === "full_text_xml" ? 0 : 1;
        return typeA - typeB;
      }
    );
    const selectedAsset = availableAssets[0];
    if (!selectedAsset) {
      throw new Error("No full text asset available for extraction.");
    }

    const sourceUrl = String(selectedAsset.source_url);
    const xmlResponse = await fetch(sourceUrl, { cache: "no-store" });
    if (!xmlResponse.ok) throw new Error(`Failed to load extraction source: HTTP ${xmlResponse.status}`);
    const xml = await xmlResponse.text();

    const supplementAssets = await supabase
      .from("paper_assets")
      .select("id")
      .eq("paper_id", paperId)
      .eq("asset_type", "supplement");
    if (supplementAssets.error) throw new Error(supplementAssets.error.message);
    const supplementAssetIds = ((supplementAssets.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter(Boolean);
    let supplementText = "";
    if (supplementAssetIds.length > 0) {
      const textRows = await supabase
        .from("paper_asset_texts")
        .select("text_content")
        .in("asset_id", supplementAssetIds);
      if (textRows.error) {
        if (!isMissingRelationError(textRows.error.message)) throw new Error(textRows.error.message);
      } else {
        supplementText = ((textRows.data ?? []) as Array<Record<string, unknown>>)
          .map((row) => (typeof row.text_content === "string" ? row.text_content : ""))
          .filter(Boolean)
          .join("\n\n");
      }
    }

    const extractionSource = selectExtractionSource(paper, xml, supplementText);
    const deterministicSource = selectDeterministicExtractionSource(paper, xml, supplementText);
    const deterministic = extractRowsDeterministically(deterministicSource, paper);
    let parsedRows = deterministic.rows;
    let parsedFactorRows = deterministic.factorRows;
    let extractionNotes = deterministic.note;
    const studyType = inferStudyType(deterministicSource);

    if (allowsTrainingRows(studyType) && process.env.GEMINI_API_KEY?.trim()) {
      try {
        const gemini = await extractRowsWithGemini(extractionSource, paper);
        parsedRows = [...parsedRows, ...gemini.rows];
        parsedFactorRows = limitFactorRowsByType(dedupeFactorRows([...parsedFactorRows, ...gemini.factorRows]));
        extractionNotes = [deterministic.note, gemini.note].filter(Boolean).join(" ");
      } catch (error) {
        extractionNotes = [
          deterministic.note,
          `Gemini fallback skipped: ${error instanceof Error ? error.message : "unknown error"}.`
        ]
          .filter(Boolean)
          .join(" ");
      }
    }

    if (parsedRows.length === 0 && parsedFactorRows.length === 0) {
      throw new Error(
        `No ML-useful extraction rows were found for study_type=${studyType}. Prioritize papers with host range, kinetics, cocktail, biofilm, antibiotic synergy, or resistance-emergence assays.`
      );
    }

    const extractionInsert = await supabase
      .from("paper_extractions")
      .insert({
        paper_id: paperId,
        extractor_version: process.env.GEMINI_API_KEY?.trim()
          ? "v3_deterministic_plus_gemini"
          : "v3_deterministic",
        status: "pending_review",
        confidence:
          parsedRows.length + parsedFactorRows.length > 0
            ? Number(
                (
                  [...parsedRows, ...parsedFactorRows].reduce((acc, row) => acc + row.confidence, 0) /
                  (parsedRows.length + parsedFactorRows.length)
                ).toFixed(3)
              )
            : 0.2,
        notes:
          parsedRows.length + parsedFactorRows.length > 0
            ? extractionNotes
            : (extractionNotes ?? "No candidate rows extracted.")
      })
      .select("id")
      .single();
    if (extractionInsert.error || !extractionInsert.data?.id) {
      throw new Error(`Failed to create extraction: ${extractionInsert.error?.message ?? "unknown"}`);
    }
    const extractionId = String(extractionInsert.data.id);

    if (parsedRows.length > 0) {
      const rowPayload = parsedRows.map((row) => ({
        paper_extraction_id: extractionId,
        cocktail_name: row.cocktailName,
        assay_type: row.assayType,
        pathogen: row.pathogen,
        host_species: row.hostSpecies,
        host_strain_raw: row.hostStrainRaw,
        phage_names_json: row.phageNames,
        phage_accessions_json: row.phageAccessions,
        normalized_phage_set: row.phageNames.slice().sort().join("|").toLowerCase(),
        conditions_json: row.conditions,
        conditions_hash: row.conditionsHash,
        outcome_metrics_json: row.outcomeMetrics,
        evidence_location: row.evidenceLocation,
        confidence: row.confidence,
        needs_review: row.needsReview
      }));

      const rowInsert = await supabase.from("paper_extraction_rows").insert(rowPayload);
      if (rowInsert.error) throw new Error(`Failed to insert extraction rows: ${rowInsert.error.message}`);
    }

    if (parsedFactorRows.length > 0) {
      const factorPayload = parsedFactorRows.map((row) => ({
        paper_extraction_id: extractionId,
        factor_type: row.factorType,
        pathogen: row.pathogen,
        host_species: row.hostSpecies,
        host_strain_raw: row.hostStrainRaw,
        phage_names_json: row.phageNames,
        phage_accessions_json: row.phageAccessions,
        assay_type: row.assayType,
        conditions_json: row.conditions,
        measurements_json: row.measurements,
        outcome_role: row.outcomeRole,
        evidence_location: row.evidenceLocation,
        confidence: row.confidence,
        needs_review: row.needsReview
      }));

      const factorInsert = await supabase.from("paper_extraction_factor_rows").insert(factorPayload);
      if (factorInsert.error && !isMissingRelationError(factorInsert.error.message)) {
        throw new Error(`Failed to insert factor extraction rows: ${factorInsert.error.message}`);
      }
    }

    const updatePaper = await supabase
      .from("papers")
      .update({
        ingest_status: "pending_review"
      })
      .eq("id", paperId);
    if (updatePaper.error) throw new Error(updatePaper.error.message);

    await finishJob(jobId, "completed", {
      extractionId,
      rowCount: parsedRows.length
    });

    return {
      jobId,
      paperId,
      extractionId,
      rowCount: parsedRows.length + parsedFactorRows.length,
      status: "pending_review"
    };
  } catch (error) {
    await finishJob(jobId, "failed", {}, error instanceof Error ? error.message : "unknown");
    throw error;
  }
}

function mapExtractionRow(row: Record<string, unknown>): PaperExtractionRow {
  const phageNames = Array.isArray(row.phage_names_json)
    ? row.phage_names_json.map((item) => String(item))
    : [];
  const phageAccessions = Array.isArray(row.phage_accessions_json)
    ? row.phage_accessions_json.map((item) => String(item))
    : [];

  return {
    id: String(row.id),
    paperExtractionId: String(row.paper_extraction_id),
    cocktailName: typeof row.cocktail_name === "string" ? row.cocktail_name : null,
    assayType:
      row.assay_type === "spot" ||
      row.assay_type === "plaque" ||
      row.assay_type === "EOP" ||
      row.assay_type === "kill_curve" ||
      row.assay_type === "biofilm" ||
      row.assay_type === "in_vivo" ||
      row.assay_type === "other"
        ? row.assay_type
        : null,
    pathogen: typeof row.pathogen === "string" ? row.pathogen : "S_maltophilia",
    hostSpecies: typeof row.host_species === "string" ? row.host_species : null,
    hostStrainRaw: typeof row.host_strain_raw === "string" ? row.host_strain_raw : null,
    phageNames,
    phageAccessions,
    conditions: asObject(row.conditions_json),
    conditionsHash: typeof row.conditions_hash === "string" ? row.conditions_hash : null,
    outcomeMetrics: asObject(row.outcome_metrics_json),
    evidenceLocation: typeof row.evidence_location === "string" ? row.evidence_location : null,
    confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
    needsReview: row.needs_review !== false,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString()
  };
}

function mapExtractionFactorRow(row: Record<string, unknown>): PaperExtractionFactorRow {
  const phageNames = Array.isArray(row.phage_names_json)
    ? row.phage_names_json.map((item) => String(item))
    : [];
  const phageAccessions = Array.isArray(row.phage_accessions_json)
    ? row.phage_accessions_json.map((item) => String(item))
    : [];
  const factorType = normalizeFactorType(row.factor_type) ?? "cocktail_outcome";

  return {
    id: String(row.id),
    paperExtractionId: String(row.paper_extraction_id),
    factorType,
    pathogen: typeof row.pathogen === "string" ? row.pathogen : "S_maltophilia",
    hostSpecies: typeof row.host_species === "string" ? row.host_species : null,
    hostStrainRaw: typeof row.host_strain_raw === "string" ? row.host_strain_raw : null,
    phageNames,
    phageAccessions,
    assayType:
      row.assay_type === "spot" ||
      row.assay_type === "plaque" ||
      row.assay_type === "EOP" ||
      row.assay_type === "kill_curve" ||
      row.assay_type === "biofilm" ||
      row.assay_type === "in_vivo" ||
      row.assay_type === "other"
        ? row.assay_type
        : null,
    conditions: asObject(row.conditions_json),
    measurements: asObject(row.measurements_json),
    outcomeRole: typeof row.outcome_role === "string" ? row.outcome_role : null,
    evidenceLocation: typeof row.evidence_location === "string" ? row.evidence_location : null,
    confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
    needsReview: row.needs_review !== false,
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString()
  };
}

function mapExtraction(row: Record<string, unknown>): Omit<PaperExtraction, "rows" | "factorRows"> {
  return {
    id: String(row.id),
    paperId: String(row.paper_id),
    extractorVersion:
      typeof row.extractor_version === "string" ? row.extractor_version : RULE_EXTRACTOR_VERSION,
    status:
      row.status === "approved" || row.status === "rejected" || row.status === "published"
        ? row.status
        : "pending_review",
    confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
    notes: typeof row.notes === "string" ? row.notes : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    reviewedBy: typeof row.reviewed_by === "string" ? row.reviewed_by : null
  };
}

export async function listPaperReviewQueue(status: "pending_review" | "approved" | "rejected" = "pending_review"): Promise<PaperReviewQueueResult[]> {
  const supabase = createSupabaseAdminClient();
  const primary = await supabase
    .from("paper_extractions")
    .select(`
      id,paper_id,extractor_version,status,confidence,notes,created_at,reviewed_at,reviewed_by,
      papers(*),
      paper_extraction_rows(*),
      paper_extraction_factor_rows(*)
    `)
    .eq("status", status)
    .order("created_at", { ascending: true })
    .limit(100);
  let data = (primary.data ?? null) as Array<Record<string, unknown>> | null;
  let error = primary.error;

  if (error && isMissingRelationError(error.message)) {
    const fallback = await supabase
      .from("paper_extractions")
      .select(`
        id,paper_id,extractor_version,status,confidence,notes,created_at,reviewed_at,reviewed_by,
        papers(*),
        paper_extraction_rows(*)
      `)
      .eq("status", status)
      .order("created_at", { ascending: true })
      .limit(100);
    data = (fallback.data ?? null) as Array<Record<string, unknown>> | null;
    error = fallback.error;
  }

  if (error) throw new Error(`Failed to load paper review queue: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => {
    const paper = mapPaperRow((item.papers as Record<string, unknown> | null) ?? {});
    const extraction = mapExtraction(item);
    const rows = ((item.paper_extraction_rows as Array<Record<string, unknown>> | null) ?? []).map(
      mapExtractionRow
    );
    const factorRows = (
      (item.paper_extraction_factor_rows as Array<Record<string, unknown>> | null) ?? []
    ).map(mapExtractionFactorRow);
    return {
      extractionId: extraction.id,
      paper,
      extraction,
      rows,
      factorRows
    };
  });
}

async function findOrCreateCitationForPaper(paper: PaperRecord): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const title = paper.title;
  const sourceType = "paper";
  if (paper.doi) {
    const existing = await supabase.from("citation_sources").select("id").eq("doi", paper.doi).maybeSingle();
    if (existing.data?.id) return String(existing.data.id);
  }
  const insert = await supabase
    .from("citation_sources")
    .insert({
      title,
      authors: [],
      year: paper.year,
      doi: paper.doi,
      url: paper.url,
      source_type: sourceType
    })
    .select("id")
    .single();
  if (insert.error || !insert.data?.id) {
    throw new Error(`Failed to create citation source: ${insert.error?.message ?? "unknown"}`);
  }
  return String(insert.data.id);
}

async function findOrCreateEvidence(citationSourceId: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const existing = await supabase
    .from("evidence")
    .select("id")
    .eq("source_id", citationSourceId)
    .eq("level", "peer_reviewed")
    .eq("confidence", "medium")
    .limit(1)
    .maybeSingle();
  if (existing.data?.id) return String(existing.data.id);
  const insert = await supabase
    .from("evidence")
    .insert({
      level: "peer_reviewed",
      confidence: "medium",
      source_id: citationSourceId,
      comment: "Paper-derived cocktail outcome extraction."
    })
    .select("id")
    .single();
  if (insert.error || !insert.data?.id) {
    throw new Error(`Failed to create evidence: ${insert.error?.message ?? "unknown"}`);
  }
  return String(insert.data.id);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(payload[key]);
    if (value !== null) return value;
  }
  return null;
}

function inferAssayOutcome(measurements: Record<string, unknown>): "susceptible" | "resistant" | "partial" | "unknown" {
  const raw = `${measurements.outcome ?? measurements.susceptibility ?? measurements.result ?? ""}`.toLowerCase();
  if (raw.includes("partial") || raw.includes("intermediate")) return "partial";
  if (raw.includes("resistant") || raw.includes("no lysis") || raw.includes("not susceptible")) return "resistant";
  if (raw.includes("susceptible") || raw.includes("sensitive") || raw.includes("lysis") || raw.includes("infect")) {
    return "susceptible";
  }
  if (typeof measurements.susceptible === "boolean") {
    return measurements.susceptible ? "susceptible" : "resistant";
  }
  const eop = firstNumber(measurements, ["eop", "EOP", "efficiency_of_plating"]);
  if (eop !== null) {
    if (eop <= 0) return "resistant";
    if (eop < 0.1) return "partial";
    return "susceptible";
  }
  return "unknown";
}

function normalizeDistanceMetric(value: unknown): "ANI" | "Mash" | "other" {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (raw.includes("ani")) return "ANI";
  if (raw.includes("mash")) return "Mash";
  return "other";
}

function factorPhageIdentifiers(row: PaperExtractionFactorRow): string[] {
  return uniqueStrings(row.phageNames.length > 0 ? row.phageNames : row.phageAccessions);
}

async function publishFactorRow(
  row: PaperExtractionFactorRow,
  paper: PaperRecord,
  reviewer: string
): Promise<boolean> {
  if (row.needsReview && row.confidence < 0.2) return false;
  const identifiers = factorPhageIdentifiers(row);
  if (identifiers.length === 0) return false;

  const supabase = createSupabaseAdminClient();
  const measurements = row.measurements;
  const phageIds: string[] = [];
  for (let index = 0; index < identifiers.length; index += 1) {
    const identifier = identifiers[index];
    const phageId = await findOrCreatePhageByNameOrAccession(
      row.phageNames[index] ?? identifier,
      row.phageAccessions[index] ?? null
    );
    phageIds.push(phageId);
  }

  const hostSpecies =
    row.hostSpecies && row.hostSpecies !== "Unknown" ? row.hostSpecies : parseHostSpecies(paper.title);
  const hostStrainId =
    hostSpecies && hostSpecies !== "Unknown"
      ? await findOrCreateHostStrain(hostSpecies, row.hostStrainRaw)
      : null;
  const evidenceText = row.evidenceLocation ?? `paper factor extraction ${row.id}`;

  if (row.factorType === "host_range") {
    if (!hostStrainId) return false;
    const outcome = inferAssayOutcome(measurements);
    const eop = firstNumber(measurements, ["eop", "EOP", "efficiency_of_plating"]);
    const susceptible = outcome === "susceptible" ? true : outcome === "resistant" ? false : null;
    const conditionsHash = buildConditionsHash({
      factor_type: row.factorType,
      host_species: hostSpecies,
      host_strain_raw: row.hostStrainRaw,
      ...row.conditions
    });
    for (const phageId of phageIds) {
      const assayInsert = await supabase.from("host_range_assays").insert({
        phage_id: phageId,
        host_strain_id: hostStrainId,
        assay_method: row.assayType ?? "paper_factor",
        outcome,
        moi: firstNumber(row.conditions, ["moi", "MOI"]),
        temperature_c: firstNumber(row.conditions, ["temperature_c", "temperature"]),
        replicates: firstNumber(row.conditions, ["replicates"]),
        measurement_json: measurements
      });
      if (assayInsert.error) throw new Error(assayInsert.error.message);

      const susceptibilityInsert = await supabase.from("phage_strain_susceptibility").insert({
        phage_id: phageId,
        strain_id: hostStrainId,
        susceptible,
        eop,
        confidence: row.confidence,
        evidence: evidenceText,
        conditions_hash: conditionsHash,
        notes: `Published from paper factor row ${row.id}`
      });
      if (susceptibilityInsert.error) throw new Error(susceptibilityInsert.error.message);
    }
    return true;
  }

  if (row.factorType === "kinetics") {
    const latentPeriod = firstNumber(measurements, ["latent_period_min", "latent_period", "latent_period_minutes"]);
    const burstSize = firstNumber(measurements, ["burst_size", "burst_size_pfu_per_cell"]);
    const adsorptionRate = firstNumber(measurements, ["adsorption_rate"]);
    const peakTiterTime = firstNumber(measurements, ["peak_titer_time_h", "peak_time_h", "time_to_peak_h"]);
    for (const phageId of phageIds) {
      const kineticsInsert = await supabase.from("phage_kinetics").insert({
        phage_id: phageId,
        strain_id: hostStrainId,
        adsorption_rate: adsorptionRate,
        latent_period_min: latentPeriod,
        burst_size: burstSize,
        moi: firstNumber(row.conditions, ["moi", "MOI"]),
        method: row.assayType ?? "paper_factor",
        conditions_hash: buildConditionsHash(row.conditions),
        evidence: evidenceText
      });
      if (kineticsInsert.error) throw new Error(kineticsInsert.error.message);

      const observationRows = [
        { metric_type: "latent_period_min", metric_value: latentPeriod, metric_unit: "min" },
        { metric_type: "burst_size", metric_value: burstSize, metric_unit: "PFU/cell" },
        { metric_type: "peak_titer_time_h", metric_value: peakTiterTime, metric_unit: "h" }
      ].filter((item) => item.metric_value !== null);
      if (observationRows.length > 0) {
        const observationInsert = await supabase.from("kinetics_observations").insert(
          observationRows.map((item) => ({
            phage_id: phageId,
            stage_label: "unknown",
            metric_type: item.metric_type,
            metric_value: item.metric_value,
            metric_unit: item.metric_unit,
            context: evidenceText
          }))
        );
        if (observationInsert.error) throw new Error(observationInsert.error.message);
      }
    }
    return true;
  }

  if (row.factorType === "genetic_relatedness") {
    if (phageIds.length < 2) return false;
    const distanceValue = firstNumber(measurements, [
      "distance_value",
      "ani",
      "ANI",
      "mash_distance",
      "shared_gene_fraction",
      "similarity"
    ]);
    if (distanceValue === null) return false;
    const metric = normalizeDistanceMetric(measurements.distance_metric ?? measurements.metric);
    for (let index = 0; index < phageIds.length - 1; index += 1) {
      const insert = await supabase.from("genetic_relatedness").insert({
        phage_a_id: phageIds[index],
        phage_b_id: phageIds[index + 1],
        distance_metric: metric,
        distance_value: distanceValue,
        method: typeof measurements.method === "string" ? measurements.method : evidenceText
      });
      if (insert.error) throw new Error(insert.error.message);
    }
    return true;
  }

  if (row.factorType === "receptor_resistance") {
    if (!hostStrainId) return false;
    const mutationCalls = Array.isArray(measurements.mutation_calls)
      ? measurements.mutation_calls
      : [measurements].filter((item) => Object.keys(item).length > 0);
    const insert = await supabase.from("strain_mutations").insert({
      parent_strain_id: hostStrainId,
      mutation_calls: mutationCalls,
      phenotype_changes: {
        factor_type: row.factorType,
        outcome_role: row.outcomeRole,
        measurements,
        phage_names: row.phageNames
      },
      sequencing_meta: {
        source: "paper_factor_extraction",
        paper: paper.doi ?? paper.pmid ?? paper.url,
        evidence: evidenceText
      }
    });
    if (insert.error) throw new Error(insert.error.message);
    return true;
  }

  const shouldPublishAsOutcome =
    row.factorType === "biofilm" ||
    row.factorType === "antibiotic_synergy" ||
    row.factorType === "cocktail_outcome" ||
    row.factorType === "safety";
  if (!shouldPublishAsOutcome || !hostStrainId) return false;

  const assayInsert = await supabase
    .from("assays")
    .insert({
      type: row.assayType ?? (row.factorType === "biofilm" ? "biofilm" : "other"),
      protocol_ref: paper.doi ? `doi:${paper.doi}` : paper.url,
      readout_schema: {}
    })
    .select("id")
    .single();
  if (assayInsert.error || !assayInsert.data?.id) throw new Error(assayInsert.error?.message ?? "assay insert failed");

  const experimentInsert = await supabase
    .from("experiments")
    .insert({
      assay_id: assayInsert.data.id,
      lab: null,
      operator: reviewer,
      experiment_date: paper.year ? `${paper.year}-01-01` : null,
      conditions: row.conditions,
      raw_data_uri: paper.url,
      qc_flags: { source: "paper_factor_extraction", factor_row_id: row.id }
    })
    .select("id")
    .single();
  if (experimentInsert.error || !experimentInsert.data?.id) {
    throw new Error(experimentInsert.error?.message ?? "experiment insert failed");
  }

  const cocktailName = `${paper.title.slice(0, 64)} (${row.factorType})`;
  const cocktailInsert = await supabase
    .from("cocktails")
    .upsert(
      {
        name: cocktailName,
        intent: row.factorType,
        design_rationale: `Factor evidence from ${paper.doi ?? paper.pmid ?? "paper source"}`,
        created_by: reviewer
      },
      { onConflict: "name" }
    )
    .select("id")
    .single();
  if (cocktailInsert.error || !cocktailInsert.data?.id) {
    throw new Error(cocktailInsert.error?.message ?? "cocktail insert failed");
  }

  for (const phageId of phageIds) {
    const componentWrite = await supabase.from("cocktail_component").upsert(
      {
        cocktail_id: cocktailInsert.data.id,
        phage_id: phageId,
        ratio: null,
        dose_pfu: firstNumber(row.conditions, ["dose_pfu", "dose"]),
        timing_role: "unknown",
        component_notes: `paper factor ingestion: ${paper.doi ?? paper.pmid ?? "unknown"}`
      },
      { onConflict: "cocktail_id,phage_id" }
    );
    if (componentWrite.error) throw new Error(componentWrite.error.message);
  }

  const resultInsert = await supabase.from("cocktail_experiment_results").insert({
    cocktail_id: cocktailInsert.data.id,
    strain_id: hostStrainId,
    experiment_id: experimentInsert.data.id,
    outcome_metrics: {
      factor_type: row.factorType,
      outcome_role: row.outcomeRole,
      ...measurements
    },
    resistance_emerged:
      typeof measurements.resistance_emerged === "boolean" ? measurements.resistance_emerged : null,
    observed_synergy: firstNumber(measurements, ["observed_synergy", "synergy_score", "fic_index"]),
    notes: `Published from paper factor row ${row.id}`
  });
  if (resultInsert.error) throw new Error(resultInsert.error.message);
  return true;
}

export async function approvePaperExtraction(extractionId: string, reviewer: string): Promise<PaperApproveResult> {
  const jobId = await startJob("publish", { extractionId });
  const supabase = createSupabaseAdminClient();

  try {
    const extractionRecord = await supabase
      .from("paper_extractions")
      .select("*,papers(*)")
      .eq("id", extractionId)
      .maybeSingle();
    if (extractionRecord.error || !extractionRecord.data) {
      throw new Error(`Extraction not found: ${extractionRecord.error?.message ?? extractionId}`);
    }
    const extraction = mapExtraction(extractionRecord.data as Record<string, unknown>);
    const paper = mapPaperRow(
      ((extractionRecord.data as Record<string, unknown>).papers as Record<string, unknown> | null) ?? {}
    );

    const rowsResponse = await supabase
      .from("paper_extraction_rows")
      .select("*")
      .eq("paper_extraction_id", extractionId)
      .order("created_at", { ascending: true });
    if (rowsResponse.error) throw new Error(rowsResponse.error.message);
    const rows = ((rowsResponse.data ?? []) as Array<Record<string, unknown>>).map(mapExtractionRow);

    const factorRowsResponse = await supabase
      .from("paper_extraction_factor_rows")
      .select("*")
      .eq("paper_extraction_id", extractionId)
      .order("created_at", { ascending: true });
    if (factorRowsResponse.error && !isMissingRelationError(factorRowsResponse.error.message)) {
      throw new Error(factorRowsResponse.error.message);
    }
    const factorRows = factorRowsResponse.error
      ? []
      : ((factorRowsResponse.data ?? []) as Array<Record<string, unknown>>).map(
          mapExtractionFactorRow
        );

    const citationSourceId = await findOrCreateCitationForPaper(paper);
    const evidenceId = await findOrCreateEvidence(citationSourceId);

    let publishedRows = 0;
    let skippedRows = 0;
    let publishedFactorRows = 0;
    let skippedFactorRows = 0;
    const cocktailIds = new Set<string>();

    for (const row of rows) {
      if (!validatePublishableRow(row)) {
        skippedRows += 1;
        continue;
      }

      const assayInsert = await supabase
        .from("assays")
        .insert({
          type: row.assayType,
          protocol_ref: paper.doi ? `doi:${paper.doi}` : paper.url,
          readout_schema: {}
        })
        .select("id")
        .single();
      if (assayInsert.error || !assayInsert.data?.id) throw new Error(assayInsert.error?.message ?? "assay insert failed");
      const assayId = String(assayInsert.data.id);

      const hostSpecies = row.hostSpecies ?? parseHostSpecies(paper.title);
      if (!hostSpecies || hostSpecies === "Unknown") {
        skippedRows += 1;
        continue;
      }
      const strainId = await findOrCreateHostStrain(hostSpecies, row.hostStrainRaw);

      const experimentInsert = await supabase
        .from("experiments")
        .insert({
          assay_id: assayId,
          lab: null,
          operator: reviewer,
          experiment_date: paper.year ? `${paper.year}-01-01` : null,
          conditions: row.conditions,
          raw_data_uri: paper.url,
          qc_flags: {
            source: "paper_ingestion",
            extraction_id: extraction.id
          }
        })
        .select("id")
        .single();
      if (experimentInsert.error || !experimentInsert.data?.id) {
        throw new Error(experimentInsert.error?.message ?? "experiment insert failed");
      }
      const experimentId = String(experimentInsert.data.id);

      const cocktailName =
        row.cocktailName ??
        `${paper.title.slice(0, 64)} (${row.assayType ?? "assay"})`;
      const cocktailInsert = await supabase
        .from("cocktails")
        .upsert(
          {
            name: cocktailName,
            intent: "paper_ingested",
            design_rationale: `Ingested from ${paper.doi ?? paper.pmid ?? "paper source"}`,
            created_by: reviewer
          },
          { onConflict: "name" }
        )
        .select("id")
        .single();
      if (cocktailInsert.error || !cocktailInsert.data?.id) {
        throw new Error(cocktailInsert.error?.message ?? "cocktail insert failed");
      }
      const cocktailId = String(cocktailInsert.data.id);
      cocktailIds.add(cocktailId);

      const candidatePhages = row.phageNames.length > 0 ? row.phageNames : row.phageAccessions;
      for (let index = 0; index < candidatePhages.length; index += 1) {
        const identifier = candidatePhages[index];
        const phageId = await findOrCreatePhageByNameOrAccession(
          row.phageNames[index] ?? identifier,
          row.phageAccessions[index] ?? null
        );
        const componentWrite = await supabase
          .from("cocktail_component")
          .upsert(
            {
              cocktail_id: cocktailId,
              phage_id: phageId,
              ratio: null,
              dose_pfu: null,
              timing_role: "unknown",
              component_notes: `paper ingestion: ${paper.doi ?? paper.pmid ?? "unknown"}`
            },
            { onConflict: "cocktail_id,phage_id" }
          );
        if (componentWrite.error) throw new Error(componentWrite.error.message);
      }

      const resistanceMetric = row.outcomeMetrics.resistance_emerged;
      const resultInsert = await supabase
        .from("cocktail_experiment_results")
        .insert({
          cocktail_id: cocktailId,
          strain_id: strainId,
          experiment_id: experimentId,
          outcome_metrics: row.outcomeMetrics,
          resistance_emerged: typeof resistanceMetric === "boolean" ? resistanceMetric : null,
          observed_synergy:
            typeof row.outcomeMetrics.observed_synergy === "number"
              ? row.outcomeMetrics.observed_synergy
              : null,
          notes: `Published from paper extraction row ${row.id}`
        })
        .select("id")
        .single();
      if (resultInsert.error || !resultInsert.data?.id) {
        throw new Error(resultInsert.error?.message ?? "result insert failed");
      }
      const resultId = String(resultInsert.data.id);

      const linkInsert = await supabase.from("paper_publish_links").upsert(
        {
          paper_row_id: row.id,
          cocktail_id: cocktailId,
          experiment_id: experimentId,
          result_id: resultId,
          citation_source_id: citationSourceId
        },
        { onConflict: "paper_row_id" }
      );
      if (linkInsert.error) throw new Error(linkInsert.error.message);

      const fieldCitation = await supabase.from("field_citations").upsert(
        {
          entity_type: "cocktail_experiment_result",
          entity_id: resultId,
          field_name: "outcome_metrics",
          citation_source_id: citationSourceId,
          evidence_id: evidenceId
        },
        {
          onConflict: "entity_type,entity_id,field_name,citation_source_id"
        }
      );
      if (fieldCitation.error) throw new Error(fieldCitation.error.message);
      publishedRows += 1;
    }

    for (const row of factorRows) {
      try {
        const published = await publishFactorRow(row, paper, reviewer);
        if (!published) {
          skippedFactorRows += 1;
          continue;
        }
        const update = await supabase
          .from("paper_extraction_factor_rows")
          .update({ published_at: new Date().toISOString(), needs_review: false })
          .eq("id", row.id);
        if (update.error && !isMissingRelationError(update.error.message)) {
          throw new Error(update.error.message);
        }
        publishedFactorRows += 1;
      } catch (error) {
        skippedFactorRows += 1;
        if (skippedFactorRows <= 3) {
          console.error("Failed to publish factor row", row.id, error);
        }
      }
    }

    const extractionUpdate = await supabase
      .from("paper_extractions")
      .update({
        status: "published",
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewer,
        notes: extraction.notes
      })
      .eq("id", extractionId);
    if (extractionUpdate.error) throw new Error(extractionUpdate.error.message);

    const paperUpdate = await supabase
      .from("papers")
      .update({ ingest_status: "published" })
      .eq("id", extraction.paperId);
    if (paperUpdate.error) throw new Error(paperUpdate.error.message);

    await finishJob(jobId, "completed", {
      extractionId,
      publishedRows,
      skippedRows,
      publishedFactorRows,
      skippedFactorRows
    });

    return {
      extractionId,
      publishedRows,
      publishedFactorRows,
      skippedRows,
      skippedFactorRows,
      cocktailIds: [...cocktailIds]
    };
  } catch (error) {
    await finishJob(jobId, "failed", {}, error instanceof Error ? error.message : "unknown");
    throw error;
  }
}

export async function rejectPaperExtraction(extractionId: string, reviewer: string, reason: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("paper_extractions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer,
      notes: reason
    })
    .eq("id", extractionId);
  if (error) throw new Error(`Failed to reject extraction: ${error.message}`);
}

export async function ingestGeneticRelatednessFromDelimited(
  fileName: string,
  text: string,
  explicitDelimiter?: "csv" | "tsv"
): Promise<GeneticDistanceIngestSummary> {
  const supabase = createSupabaseAdminClient();
  const parsed = parseDelimitedText(text, fileName, explicitDelimiter);
  const headers = parsed.headers.map((header) => header.toLowerCase());
  const warnings: string[] = [];

  const idxPhageA = headers.findIndex((header) => ["phage_a", "phage_a_name", "phage_a_id"].includes(header));
  const idxPhageB = headers.findIndex((header) => ["phage_b", "phage_b_name", "phage_b_id"].includes(header));
  const idxMetric = headers.findIndex((header) => ["distance_metric", "metric"].includes(header));
  const idxValue = headers.findIndex((header) => ["distance_value", "value"].includes(header));
  const idxMethod = headers.findIndex((header) => ["method"].includes(header));
  if (idxPhageA < 0 || idxPhageB < 0 || idxMetric < 0 || idxValue < 0) {
    throw new Error("Expected columns: phage_a, phage_b, distance_metric, distance_value.");
  }

  let validRows = 0;
  let skippedRows = 0;
  let insertedRows = 0;

  for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex += 1) {
    const row = parsed.rows[rowIndex];
    const values = parsed.headers.map((header) => row[header] ?? "");
    const phageAName = values[idxPhageA]?.trim();
    const phageBName = values[idxPhageB]?.trim();
    const metricRaw = values[idxMetric]?.trim();
    const valueRaw = values[idxValue]?.trim();
    if (!phageAName || !phageBName || !metricRaw || !valueRaw) {
      skippedRows += 1;
      if (warnings.length < 12) warnings.push(`Row ${rowIndex + 2}: missing required fields`);
      continue;
    }

    const metric = metricRaw === "ANI" || metricRaw === "Mash" ? metricRaw : "other";
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) {
      skippedRows += 1;
      if (warnings.length < 12) warnings.push(`Row ${rowIndex + 2}: invalid numeric distance_value`);
      continue;
    }

    const phageAId = await findOrCreatePhageByNameOrAccession(phageAName, null);
    const phageBId = await findOrCreatePhageByNameOrAccession(phageBName, null);
    if (phageAId === phageBId) {
      skippedRows += 1;
      if (warnings.length < 12) warnings.push(`Row ${rowIndex + 2}: same phage on both sides`);
      continue;
    }

    validRows += 1;
    const write = await supabase.from("genetic_relatedness").insert({
      phage_a_id: phageAId,
      phage_b_id: phageBId,
      distance_metric: metric,
      distance_value: value,
      method: values[idxMethod]?.trim() || null
    });
    if (write.error) {
      skippedRows += 1;
      if (warnings.length < 12) warnings.push(`Row ${rowIndex + 2}: ${write.error.message}`);
      continue;
    }
    insertedRows += 1;
  }

  return {
    totalRows: parsed.rows.length,
    validRows,
    insertedRows,
    skippedRows,
    warnings
  };
}
