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
                Cocktail Collection
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                Compare cocktail composition, timing strategy, and resistance outcomes.
              </p>
            </div>
            <div className="stack" style={{ gridAutoFlow: "column", gap: "0.5rem" }}>
              <Link href="/cocktails/new" className="btn-link">
                New cocktail
              </Link>
              <Link href="/upload" className="btn-link btn-muted">
                Upload metadata
              </Link>
            </div>
          </div>
          <form method="get" className="grid-2">
            <div className="field-row">
              <label htmlFor="q">Search (name, rationale, phage names)</label>
              <input id="q" name="q" defaultValue={q} placeholder="e.g. staged timing" />
            </div>
            <div className="field-row">
              <label htmlFor="intent">Intent</label>
              <input
                id="intent"
                name="intent"
                defaultValue={intent}
                placeholder="broad coverage, close genetic..."
              />
            </div>
            <div className="field-row">
              <label htmlFor="host_species">Target host species</label>
              <input
                id="host_species"
                name="host_species"
                defaultValue={hostSpecies}
                placeholder="e.g. Staphylococcus aureus"
              />
            </div>
            <div className="field-row">
              <label htmlFor="pathogen">Pathogen key</label>
              <input
                id="pathogen"
                name="pathogen"
                defaultValue={pathogen}
                placeholder="e.g. S_aureus"
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
              <label htmlFor="resistance_emerged">Resistance emerged</label>
              <select
                id="resistance_emerged"
                name="resistance_emerged"
                defaultValue={resistanceRaw ?? ""}
              >
                <option value="">Any</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="sort">Sort</label>
              <select id="sort" name="sort" defaultValue={sort}>
                <option value="created_desc">Recently updated</option>
                <option value="name_asc">Name (A-Z)</option>
                <option value="name_desc">Name (Z-A)</option>
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
              Showing {result.data.length} of {result.total} cocktail records
            </span>
            <span className="muted">
              Page {result.page} / {result.totalPages}
            </span>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Cocktail</th>
                <th>Phages</th>
                <th>Timing profile</th>
                <th>Results</th>
              </tr>
            </thead>
            <tbody>
              {result.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No cocktails match these filters yet.
                  </td>
                </tr>
              )}
              {result.data.map((cocktail) => (
                <tr key={cocktail.id}>
                  <td>
                    <div className="stack" style={{ gap: "0.25rem" }}>
                      <Link href={`/cocktails/${cocktail.id}`} style={{ color: "var(--accent)" }}>
                        {cocktail.name}
                      </Link>
                      <span className="muted" style={{ fontSize: "0.84rem" }}>
                        {cocktail.intent ?? "Intent not set"}
                      </span>
                    </div>
                  </td>
                  <td>{cocktail.phageNames.slice(0, 4).join(", ") || "No components linked"}</td>
                  <td>
                    <div className="stack" style={{ gridAutoFlow: "column", gap: "0.35rem" }}>
                      {cocktail.timingRoles.length === 0 && (
                        <span className="muted">No timing labels</span>
                      )}
                      {cocktail.timingRoles.map((role) => (
                        <span key={`${cocktail.id}-${role}`} className="pill" data-tone="accent">
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="stack" style={{ gap: "0.25rem" }}>
                      <span>{cocktail.resultCount} result rows</span>
                      <span className="muted" style={{ fontSize: "0.84rem" }}>
                        Resistance flags: {cocktail.resistanceEmergenceSignals}
                      </span>
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
              href={`/cocktails?${prevParams.toString()}`}
            >
              Previous
            </Link>
            <Link
              className={`btn-link btn-muted ${result.page >= result.totalPages ? "disabled" : ""}`}
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
