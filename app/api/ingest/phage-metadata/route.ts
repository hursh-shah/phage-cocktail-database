import { createSupabaseAdminClient } from "@/lib/supabase";
import { findFirstHeader, parseDelimitedText } from "@/lib/delimited";
import type { UploadIngestSummary } from "@/types/cocktail";

const ACCESSION_HEADERS = ["Phage_ID", "phage_id", "accession", "genbank_accession"];
const NAME_HEADERS = ["name", "Name", "phage_name"];
const LENGTH_HEADERS = ["Length", "length", "genome_length_bp", "genome_length"];
const GC_HEADERS = ["GC_content", "gc_content", "gc", "GC"];
const TAXONOMY_HEADERS = ["Taxonomy", "taxonomy", "family"];
const HOST_HEADERS = ["Host", "host", "host_primary_taxon"];
const LIFESTYLE_HEADERS = ["Lifestyle", "lifestyle"];
const COMPLETENESS_HEADERS = ["Completeness", "completeness"];
const CLUSTER_HEADERS = ["Cluster", "cluster"];
const SUBCLUSTER_HEADERS = ["Subcluster", "subcluster"];

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function getHeaderValue(row: Record<string, string>, header: string | null): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

function canIngestInCurrentEnv(request: Request): boolean {
  const requiredToken = process.env.UPLOAD_API_TOKEN;
  if (!requiredToken) {
    return process.env.NODE_ENV !== "production";
  }

  const tokenFromHeader = request.headers.get("x-upload-token");
  return tokenFromHeader === requiredToken;
}

export async function POST(request: Request) {
  try {
    if (!canIngestInCurrentEnv(request)) {
      return Response.json(
        {
          error:
            "Unauthorized upload. Provide x-upload-token or set NODE_ENV=development without UPLOAD_API_TOKEN."
        },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const sourceLabel =
      typeof formData.get("source_label") === "string"
        ? String(formData.get("source_label"))
        : "manual_upload";
    const delimiterRaw =
      typeof formData.get("delimiter") === "string"
        ? String(formData.get("delimiter")).toLowerCase()
        : "";
    const explicitDelimiter =
      delimiterRaw === "csv" || delimiterRaw === "tsv" ? delimiterRaw : undefined;

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file field in multipart form data." }, { status: 400 });
    }

    const text = await file.text();
    const parsed = parseDelimitedText(text, file.name, explicitDelimiter);

    if (parsed.rows.length === 0) {
      return Response.json({ error: "The uploaded file has no data rows." }, { status: 400 });
    }

    const accessionHeader = findFirstHeader(parsed.headers, ACCESSION_HEADERS);
    if (!accessionHeader) {
      return Response.json(
        {
          error:
            "Could not find accession column. Expected one of: Phage_ID, phage_id, accession, genbank_accession."
        },
        { status: 400 }
      );
    }

    const nameHeader = findFirstHeader(parsed.headers, NAME_HEADERS);
    const lengthHeader = findFirstHeader(parsed.headers, LENGTH_HEADERS);
    const gcHeader = findFirstHeader(parsed.headers, GC_HEADERS);
    const taxonomyHeader = findFirstHeader(parsed.headers, TAXONOMY_HEADERS);
    const hostHeader = findFirstHeader(parsed.headers, HOST_HEADERS);
    const lifestyleHeader = findFirstHeader(parsed.headers, LIFESTYLE_HEADERS);
    const completenessHeader = findFirstHeader(parsed.headers, COMPLETENESS_HEADERS);
    const clusterHeader = findFirstHeader(parsed.headers, CLUSTER_HEADERS);
    const subclusterHeader = findFirstHeader(parsed.headers, SUBCLUSTER_HEADERS);

    const warnings: string[] = [];
    const upsertRows: Array<Record<string, unknown>> = [];
    let skippedRows = 0;

    parsed.rows.forEach((row, index) => {
      const accession = getHeaderValue(row, accessionHeader);
      if (!accession) {
        skippedRows += 1;
        if (warnings.length < 8) warnings.push(`Row ${index + 2}: missing accession.`);
        return;
      }

      const rowName = getHeaderValue(row, nameHeader);
      const length = parseNumber(getHeaderValue(row, lengthHeader));
      const gc = parseNumber(getHeaderValue(row, gcHeader));
      const taxonomy = getHeaderValue(row, taxonomyHeader);
      const host = getHeaderValue(row, hostHeader);
      const lifecycle = getHeaderValue(row, lifestyleHeader);
      const completeness = getHeaderValue(row, completenessHeader);
      const cluster = getHeaderValue(row, clusterHeader);
      const subcluster = getHeaderValue(row, subclusterHeader);

      upsertRows.push({
        name: rowName || `Phage ${accession}`,
        genome_accession: accession,
        genome_length_bp: length,
        gc_content: gc,
        taxonomy_family: taxonomy || null,
        host_primary_taxon: host || null,
        lifecycle: lifecycle || null,
        completeness: completeness || null,
        phage_cluster: cluster || null,
        phage_subcluster: subcluster || null,
        phage_metadata: {
          source_label: sourceLabel,
          source_filename: file.name,
          imported_at: new Date().toISOString(),
          completeness: completeness || null,
          lifestyle: lifecycle || null,
          cluster: cluster || null,
          subcluster: subcluster || null
        }
      });
    });

    if (upsertRows.length === 0) {
      return Response.json(
        { error: "No valid rows found. Every row is missing accession values." },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();
    const CHUNK_SIZE = 500;
    let upsertedRows = 0;

    for (let start = 0; start < upsertRows.length; start += CHUNK_SIZE) {
      const chunk = upsertRows.slice(start, start + CHUNK_SIZE);
      const { error } = await supabase
        .from("phages")
        .upsert(chunk, { onConflict: "genome_accession" });

      if (error) {
        throw new Error(`Upload failed near row ${start + 1}: ${error.message}`);
      }
      upsertedRows += chunk.length;
    }

    const summary: UploadIngestSummary = {
      sourceFilename: file.name,
      delimiter: parsed.delimiter,
      totalRows: parsed.rows.length,
      validRows: upsertRows.length,
      upsertedRows,
      skippedRows,
      sampleWarnings: warnings
    };

    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload failure";
    return Response.json({ error: message }, { status: 400 });
  }
}
