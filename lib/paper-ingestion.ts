import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase";
import type {
  GeneticDistanceIngestSummary,
  PaperApproveResult,
  PaperExtractResult,
  PaperExtraction,
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
const RULE_EXTRACTOR_VERSION = "v1_rule_parser";
const GEMINI_EXTRACTOR_VERSION = "v2_gemini_hybrid";
const GEMINI_DEFAULT_MODEL = "gemini-3-flash-preview";

type AssayType = "kill_curve" | "biofilm" | "spot" | "plaque" | "EOP" | "in_vivo" | "other";
type ExtractedRowInput = Omit<PaperExtractionRow, "id" | "paperExtractionId" | "createdAt">;

function normalizePathogen(pathogenRaw: string | undefined): string {
  if (!pathogenRaw) return "S_aureus";
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

function parseHostSpecies(text: string): string {
  if (/staphylococcus\s+aureus/i.test(text)) return "Staphylococcus aureus";
  if (/\bS\.\s*aureus\b/i.test(text)) return "Staphylococcus aureus";
  if (/staphylococcus/i.test(text)) return "Staphylococcus spp.";
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
  return source.toLowerCase().includes(candidate.toLowerCase());
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
      typeof row.pathogen_focus === "string" ? row.pathogen_focus : "S_aureus",
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

function selectExtractionSource(paper: PaperRecord, xml: string): string {
  return `${paper.title}\n${paper.journal ?? ""}\n${paper.url ?? ""}\n${xml.slice(0, 20000)}`;
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

  const phageNames = uniqueStrings(parsedPhageNames.filter((value) => isGroundedToken(source, value)));
  const phageAccessions = uniqueStrings(parsedPhageAccessions.filter((value) => isGroundedToken(source, value)));
  if (phageNames.length === 0 && phageAccessions.length === 0) {
    return null;
  }

  const rawHostSpecies = typeof raw.host_species === "string" ? raw.host_species.trim() : "";
  let hostSpecies = rawHostSpecies || parseHostSpecies(source);
  if (!hostSpecies || hostSpecies === "Unknown") {
    hostSpecies = paper.pathogenFocus === "S_aureus" ? "Staphylococcus aureus" : "Unknown";
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

async function extractRowsWithGemini(
  source: string,
  paper: PaperRecord
): Promise<{ rows: ExtractedRowInput[]; note: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = [
    "You are extracting phage cocktail experiment rows from one scientific paper.",
    "Return STRICT JSON with exactly this top-level shape:",
    '{"rows":[{"cocktail_name":string|null,"assay_type":"kill_curve"|"biofilm"|"spot"|"plaque"|"EOP"|"in_vivo"|"other","pathogen":string|null,"host_species":string|null,"host_strain_raw":string|null,"phage_names":string[],"phage_accessions":string[],"conditions":object,"outcome_metrics":object,"evidence_location":string|null,"supporting_snippet":string,"confidence":number}],"notes":string|null}',
    "Rules:",
    "1) Use ONLY entities explicitly present in the source text.",
    "2) Do NOT infer phage names, strain IDs, accessions, metrics, or assay types.",
    "3) Every row must have supporting_snippet copied verbatim from source (<=320 chars).",
    "4) If field is missing in source, set it to null or empty array/object.",
    "5) If no cocktail outcome is extractable, return rows as [].",
    "6) confidence range must be 0.0 to 1.0.",
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

  const note = typeof parsed.notes === "string" && parsed.notes.trim().length > 0 ? parsed.notes : null;
  return { rows: normalizedRows, note };
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
  const term = payload.term?.trim() || DEFAULT_TERM;
  const maxResults = Math.max(5, Math.min(payload.maxResults ?? 25, 100));
  const pathogenFocus = normalizePathogen(payload.pathogenFocus);
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
    for (const link of supplementLinks) {
      assetsToInsert.push({
        paper_id: paperId,
        asset_type: "supplement",
        source_url: link,
        storage_path: null,
        mime_type: null,
        fetch_status: "fetched",
        checksum: null
      });
    }

    const insertAssets = await supabase
      .from("paper_assets")
      .insert(assetsToInsert);
    if (insertAssets.error) {
      throw new Error(`Failed to insert paper assets: ${insertAssets.error.message}`);
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
      supplementLinks: supplementLinks.length
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
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("Gemini-only extraction is enabled, but GEMINI_API_KEY is not configured.");
  }
  const jobId = await startJob("extract", {
    paperId,
    extractorVersion: GEMINI_EXTRACTOR_VERSION
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
    const extractionSource = selectExtractionSource(paper, xml);
    const gemini = await extractRowsWithGemini(extractionSource, paper);
    const parsedRows = gemini.rows;
    const extractionNotes = gemini.note;
    if (parsedRows.length === 0) {
      throw new Error(
        "Gemini returned zero grounded extraction rows. Verify paper text quality or tighten scope."
      );
    }

    const extractionInsert = await supabase
      .from("paper_extractions")
      .insert({
        paper_id: paperId,
        extractor_version: GEMINI_EXTRACTOR_VERSION,
        status: "pending_review",
        confidence:
          parsedRows.length > 0
            ? Number((parsedRows.reduce((acc, row) => acc + row.confidence, 0) / parsedRows.length).toFixed(3))
            : 0.2,
        notes:
          parsedRows.length > 0
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
      rowCount: parsedRows.length,
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
    pathogen: typeof row.pathogen === "string" ? row.pathogen : "S_aureus",
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

function mapExtraction(row: Record<string, unknown>): Omit<PaperExtraction, "rows"> {
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
  const { data, error } = await supabase
    .from("paper_extractions")
    .select(`
      id,paper_id,extractor_version,status,confidence,notes,created_at,reviewed_at,reviewed_by,
      papers(*),
      paper_extraction_rows(*)
    `)
    .eq("status", status)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(`Failed to load paper review queue: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => {
    const paper = mapPaperRow((item.papers as Record<string, unknown> | null) ?? {});
    const extraction = mapExtraction(item);
    const rows = ((item.paper_extraction_rows as Array<Record<string, unknown>> | null) ?? []).map(
      mapExtractionRow
    );
    return {
      extractionId: extraction.id,
      paper,
      extraction,
      rows
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

    const citationSourceId = await findOrCreateCitationForPaper(paper);
    const evidenceId = await findOrCreateEvidence(citationSourceId);

    let publishedRows = 0;
    let skippedRows = 0;
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

      const hostSpecies = row.hostSpecies ?? "Staphylococcus aureus";
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
      skippedRows
    });

    return {
      extractionId,
      publishedRows,
      skippedRows,
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
