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

  const hasFilters = Boolean(
    q || hostSpecies || stageLabel || evidenceLevel || tagString || hasCocktailRaw
  );
  const cocktailLinkedCount = result.data.filter((p) => p.hasCocktailData).length;

  return (
    <main className="page-shell">
      <header className="page-header">
        <h1>Phages</h1>
        <p className="page-summary">
          {result.total.toLocaleString()} records
          <span className="sep">·</span>
          {cocktailLinkedCount} on this page linked to cocktail data
          <span className="sep">·</span>
          page {result.page} of {result.totalPages}
        </p>
      </header>

      <form method="get" className="filter-bar">
        <div className="field-row">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="name, accession, notes" />
        </div>
        <div className="field-row">
          <label htmlFor="host_species">Host species</label>
          <input
            id="host_species"
            name="host_species"
            defaultValue={hostSpecies}
            placeholder="Staphylococcus aureus"
          />
        </div>
        <div className="field-row">
          <label htmlFor="stage_label">Stage</label>
          <select id="stage_label" name="stage_label" defaultValue={stageLabel ?? ""}>
            <option value="">Any</option>
            <option value="early">Early</option>
            <option value="semi_early">Semi-early</option>
            <option value="late">Late</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="evidence_level">Evidence</label>
          <select id="evidence_level" name="evidence_level" defaultValue={evidenceLevel ?? ""}>
            <option value="">Any</option>
            <option value="peer_reviewed">Peer reviewed</option>
            <option value="preprint">Preprint</option>
            <option value="unpublished_comm">Unpublished</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="tags">Tags</label>
          <input
            id="tags"
            name="tags"
            defaultValue={tagString}
            placeholder="staph_priority, has_genome_sequence"
          />
        </div>
        <div className="field-row">
          <label htmlFor="has_cocktail_data">Cocktail data</label>
          <select
            id="has_cocktail_data"
            name="has_cocktail_data"
            defaultValue={hasCocktailRaw ?? ""}
          >
            <option value="">Any</option>
            <option value="true">Linked</option>
            <option value="false">Not linked</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={sort}>
            <option value="name_asc">Name A-Z</option>
            <option value="name_desc">Name Z-A</option>
            <option value="created_desc">Recently added</option>
          </select>
        </div>
        <div className="filter-actions">
          {hasFilters && (
            <Link href="/phages" className="link-reset">
              Reset
            </Link>
          )}
          <button className="btn-link" type="submit">
            Apply
          </button>
        </div>
      </form>

      <section className="section">
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
            {result.data.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No phages match these filters.
                </td>
              </tr>
            )}
            {result.data.map((phage) => (
              <tr key={phage.id}>
                <td>
                  <div className="stack" style={{ gap: "0.15rem" }}>
                    <Link href={`/phages/${phage.id}`}>{phage.name}</Link>
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {phage.taxonomyFamily ?? "Family unknown"}
                    </span>
                  </div>
                </td>
                <td>
                  {phage.genomeAccession ? (
                    <span className="mono">{phage.genomeAccession}</span>
                  ) : (
                    <span className="muted">pending</span>
                  )}
                </td>
                <td>{phage.hostPrimaryTaxon ?? "Unspecified"}</td>
                <td>
                  <span className="tag-list">
                    {phage.stageLabels.length > 0 && (
                      <span>{phage.stageLabels.join(", ")}</span>
                    )}
                    {phage.stageLabels.length > 0 && phage.hasCocktailData && (
                      <span className="sep">·</span>
                    )}
                    {phage.hasCocktailData && <span>cocktail linked</span>}
                    {phage.stageLabels.length === 0 && !phage.hasCocktailData && (
                      <span className="muted">—</span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="split">
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            Showing {result.data.length} of {result.total.toLocaleString()}
          </span>
          <div className="row">
            <Link
              className={`btn-link btn-muted ${result.page <= 1 ? "disabled" : ""}`}
              aria-disabled={result.page <= 1}
              href={`/phages?${prevParams.toString()}`}
            >
              Previous
            </Link>
            <Link
              className={`btn-link btn-muted ${
                result.page >= result.totalPages ? "disabled" : ""
              }`}
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
