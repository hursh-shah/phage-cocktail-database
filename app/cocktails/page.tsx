import Link from "next/link";
import { listCocktails } from "@/lib/cocktail-service";

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

export default async function CocktailsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};

  const q = readParam(params, "q");
  const intent = readParam(params, "intent");
  const hostSpecies = readParam(params, "host_species");
  const pathogen = readParam(params, "pathogen");
  const assay = readParam(params, "assay");
  const resistanceRaw = readParam(params, "resistance_emerged");
  const sort =
    (readParam(params, "sort") as "name_asc" | "name_desc" | "created_desc" | undefined) ??
    "created_desc";
  const page = Number(readParam(params, "page") ?? "1");
  const limit = Number(readParam(params, "limit") ?? "20");

  const result = await listCocktails({
    q,
    intent,
    hostSpecies,
    pathogen,
    assay,
    resistanceEmerged:
      resistanceRaw === undefined ? undefined : resistanceRaw === "true",
    page: Number.isFinite(page) ? page : 1,
    limit: Number.isFinite(limit) ? limit : 20,
    sort
  });

  const pagePrev = Math.max(1, result.page - 1);
  const pageNext = Math.min(result.totalPages, result.page + 1);
  const baseParams = new URLSearchParams();
  if (q) baseParams.set("q", q);
  if (intent) baseParams.set("intent", intent);
  if (hostSpecies) baseParams.set("host_species", hostSpecies);
  if (pathogen) baseParams.set("pathogen", pathogen);
  if (assay) baseParams.set("assay", assay);
  if (resistanceRaw) baseParams.set("resistance_emerged", resistanceRaw);
  baseParams.set("sort", sort);
  baseParams.set("limit", String(result.limit));

  const prevParams = new URLSearchParams(baseParams);
  prevParams.set("page", String(pagePrev));
  const nextParams = new URLSearchParams(baseParams);
  nextParams.set("page", String(pageNext));

  const hasFilters = Boolean(
    q || intent || hostSpecies || pathogen || assay || resistanceRaw
  );

  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="split">
          <div className="stack" style={{ gap: "0.4rem" }}>
            <h1>Cocktails</h1>
            <p className="page-summary">
              {result.total.toLocaleString()} records
              <span className="sep">·</span>
              page {result.page} of {result.totalPages}
            </p>
          </div>
          <div className="row">
            <Link href="/cocktails/new" className="btn-link">
              New cocktail
            </Link>
          </div>
        </div>
      </header>

      <form method="get" className="filter-bar">
        <div className="field-row">
          <label htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="name, rationale, phage" />
        </div>
        <div className="field-row">
          <label htmlFor="intent">Intent</label>
          <input
            id="intent"
            name="intent"
            defaultValue={intent}
            placeholder="broad coverage, close..."
          />
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
          <label htmlFor="pathogen">Pathogen key</label>
          <input
            id="pathogen"
            name="pathogen"
            defaultValue={pathogen}
            placeholder="S_aureus"
          />
        </div>
        <div className="field-row">
          <label htmlFor="assay">Assay</label>
          <select id="assay" name="assay" defaultValue={assay ?? ""}>
            <option value="">Any</option>
            <option value="kill_curve">kill_curve</option>
            <option value="biofilm">biofilm</option>
            <option value="EOP">EOP</option>
            <option value="spot">spot</option>
            <option value="plaque">plaque</option>
            <option value="in_vivo">in_vivo</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="resistance_emerged">Resistance</label>
          <select
            id="resistance_emerged"
            name="resistance_emerged"
            defaultValue={resistanceRaw ?? ""}
          >
            <option value="">Any</option>
            <option value="true">Emerged</option>
            <option value="false">Did not emerge</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={sort}>
            <option value="created_desc">Recently updated</option>
            <option value="name_asc">Name A-Z</option>
            <option value="name_desc">Name Z-A</option>
          </select>
        </div>
        <div className="filter-actions">
          {hasFilters && (
            <Link href="/cocktails" className="link-reset">
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
              <th>Cocktail</th>
              <th>Phages</th>
              <th>Timing</th>
              <th>Results</th>
            </tr>
          </thead>
          <tbody>
            {result.data.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No cocktails match these filters.
                </td>
              </tr>
            )}
            {result.data.map((cocktail) => (
              <tr key={cocktail.id}>
                <td>
                  <div className="stack" style={{ gap: "0.15rem" }}>
                    <Link href={`/cocktails/${cocktail.id}`}>{cocktail.name}</Link>
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {cocktail.intent ?? "Intent not set"}
                    </span>
                  </div>
                </td>
                <td>
                  {cocktail.phageNames.length === 0 ? (
                    <span className="muted">no components</span>
                  ) : (
                    <span className="mono">
                      {cocktail.phageNames.slice(0, 4).join(", ")}
                      {cocktail.phageNames.length > 4 ? "…" : ""}
                    </span>
                  )}
                </td>
                <td>
                  {cocktail.timingRoles.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className="tag-list">
                      {cocktail.timingRoles.map((role, idx) => (
                        <span key={`${cocktail.id}-${role}`}>
                          {role}
                          {idx < cocktail.timingRoles.length - 1 && (
                            <span className="sep"> ·</span>
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td>
                  <div className="stack" style={{ gap: "0.15rem" }}>
                    <span>{cocktail.resultCount} result rows</span>
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      resistance flags: {cocktail.resistanceEmergenceSignals}
                    </span>
                  </div>
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
              href={`/cocktails?${prevParams.toString()}`}
            >
              Previous
            </Link>
            <Link
              className={`btn-link btn-muted ${
                result.page >= result.totalPages ? "disabled" : ""
              }`}
              aria-disabled={result.page >= result.totalPages}
              href={`/cocktails?${nextParams.toString()}`}
            >
              Next
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
