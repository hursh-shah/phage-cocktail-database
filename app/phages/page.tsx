import Link from "next/link";
import { listPhages } from "@/lib/phage-service";
import type { EvidenceLevel, StageLabel } from "@/types/phage";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function PhagesPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const q = readParam(params, "q");
  const hostSpecies = readParam(params, "host_species");
  const stageLabel = readParam(params, "stage_label") as StageLabel | undefined;
  const evidenceLevel = readParam(params, "evidence_level") as
    | EvidenceLevel
    | undefined;
  const tagString = readParam(params, "tags");
  const sort = (readParam(params, "sort") as
    | "name_asc"
    | "name_desc"
    | "created_desc"
    | undefined) ?? "name_asc";
  const hasCocktailRaw = readParam(params, "has_cocktail_data");
  const page = Number(readParam(params, "page") ?? "1");
  const limit = Number(readParam(params, "limit") ?? "20");
  const tags = tagString
    ? tagString
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  const result = await listPhages({
    q,
    hostSpecies,
    stageLabel,
    evidenceLevel,
    hasCocktailData:
      hasCocktailRaw === undefined ? undefined : hasCocktailRaw === "true",
    tags,
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 20,
    sort
  });

  const pagePrev = Math.max(1, result.page - 1);
  const pageNext = Math.min(result.totalPages, result.page + 1);
  const baseParams = new URLSearchParams();
  if (q) baseParams.set("q", q);
  if (hostSpecies) baseParams.set("host_species", hostSpecies);
  if (stageLabel) baseParams.set("stage_label", stageLabel);
  if (evidenceLevel) baseParams.set("evidence_level", evidenceLevel);
  if (tagString) baseParams.set("tags", tagString);
  if (hasCocktailRaw) baseParams.set("has_cocktail_data", hasCocktailRaw);
  if (sort) baseParams.set("sort", sort);
  baseParams.set("limit", String(result.limit));

  const prevParams = new URLSearchParams(baseParams);
  prevParams.set("page", String(pagePrev));
  const nextParams = new URLSearchParams(baseParams);
  nextParams.set("page", String(pageNext));

  return (
    <main className="page-shell stack">
      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <div className="split">
            <div className="stack" style={{ gap: "0.2rem" }}>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display), serif",
                  fontSize: "1.8rem"
                }}
              >
                Phage Collection
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                Search and filter curated phage records with host-range, kinetics, and evidence
                metadata.
              </p>
            </div>
            <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
              <Link href="/cocktails" className="btn-link btn-muted">
                Cocktails
              </Link>
              <Link href="/" className="btn-link btn-muted">
                Overview
              </Link>
            </div>
          </div>
          <form method="get" className="grid-2">
            <div className="field-row">
              <label htmlFor="q">Search (name, accession, notes)</label>
              <input id="q" name="q" defaultValue={q} placeholder="e.g. phiP68 or NC_005880.2" />
            </div>
            <div className="field-row">
              <label htmlFor="host_species">Host species</label>
              <input
                id="host_species"
                name="host_species"
                defaultValue={hostSpecies}
                placeholder="e.g. Staphylococcus aureus"
              />
            </div>
            <div className="field-row">
              <label htmlFor="stage_label">Kinetics stage</label>
              <select id="stage_label" name="stage_label" defaultValue={stageLabel ?? ""}>
                <option value="">Any</option>
                <option value="early">Early</option>
                <option value="semi_early">Semi-early</option>
                <option value="late">Late</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="evidence_level">Evidence level</label>
              <select id="evidence_level" name="evidence_level" defaultValue={evidenceLevel ?? ""}>
                <option value="">Any</option>
                <option value="peer_reviewed">Peer reviewed</option>
                <option value="preprint">Preprint</option>
                <option value="unpublished_comm">Unpublished communication</option>
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="tags">Tags (comma separated)</label>
              <input
                id="tags"
                name="tags"
                defaultValue={tagString}
                placeholder="staph_priority,has_genome_sequence"
              />
            </div>
            <div className="field-row">
              <label htmlFor="sort">Sort</label>
              <select id="sort" name="sort" defaultValue={sort}>
                <option value="name_asc">Name (A-Z)</option>
                <option value="name_desc">Name (Z-A)</option>
                <option value="created_desc">Recently added</option>
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="has_cocktail_data">Cocktail data</label>
              <select
                id="has_cocktail_data"
                name="has_cocktail_data"
                defaultValue={hasCocktailRaw ?? ""}
              >
                <option value="">Any</option>
                <option value="true">Has cocktail data</option>
                <option value="false">No cocktail data</option>
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="limit">Rows per page</label>
              <select id="limit" name="limit" defaultValue={String(result.limit)}>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </div>
            <div className="split" style={{ alignSelf: "end" }}>
              <button className="btn-link" type="submit">
                Apply filters
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <div className="split">
            <span className="muted">
              Showing {result.data.length} of {result.total} records
            </span>
            <span className="muted">
              Page {result.page} / {result.totalPages}
            </span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Phage</th>
                <th>Accession</th>
                <th>Host</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((phage) => (
                <tr key={phage.id}>
                  <td>
                    <div className="stack" style={{ gap: "0.25rem" }}>
                      <Link href={`/phages/${phage.id}`} style={{ color: "var(--accent)" }}>
                        {phage.name}
                      </Link>
                      <span className="muted" style={{ fontSize: "0.84rem" }}>
                        {phage.taxonomyFamily ?? "Family unknown"}
                      </span>
                    </div>
                  </td>
                  <td>{phage.genomeAccession ?? "Pending accession"}</td>
                  <td>{phage.hostPrimaryTaxon ?? "Unspecified"}</td>
                  <td>
                    <div className="stack" style={{ gridAutoFlow: "column", gap: "0.35rem" }}>
                      {phage.stageLabels.length > 0 && (
                        <span className="pill" data-tone="accent">
                          {phage.stageLabels.join(", ")}
                        </span>
                      )}
                      {phage.hasCocktailData && (
                        <span className="pill" data-tone="warn">
                          Cocktail
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="split">
            <Link
              className={`btn-link btn-muted ${result.page <= 1 ? "disabled" : ""}`}
              aria-disabled={result.page <= 1}
              href={`/phages?${prevParams.toString()}`}
            >
              Previous
            </Link>
            <Link
              className={`btn-link btn-muted ${result.page >= result.totalPages ? "disabled" : ""}`}
              aria-disabled={result.page >= result.totalPages}
              href={`/phages?${nextParams.toString()}`}
            >
              Next
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
