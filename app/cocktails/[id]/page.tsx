import Link from "next/link";
import { notFound } from "next/navigation";
import { getCocktailById } from "@/lib/cocktail-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatMetricPreview(metrics: Record<string, unknown>): string {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return "No outcome metrics";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" • ");
}

export default async function CocktailDetailPage({ params }: PageProps) {
  const { id } = await params;
  const cocktail = await getCocktailById(id);
  if (!cocktail) notFound();

  const timingRoles = [...new Set(cocktail.components.map((item) => item.timingRole))];

  return (
    <main className="page-shell stack">
      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <div className="split">
            <div className="stack" style={{ gap: "0.25rem" }}>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display), serif",
                  fontSize: "1.9rem"
                }}
              >
                {cocktail.name}
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                {cocktail.intent ?? "Intent unspecified"}
              </p>
            </div>
            <Link href="/cocktails" className="btn-link btn-muted">
              Back to cocktails
            </Link>
          </div>

          {cocktail.designRationale && (
            <p className="muted" style={{ margin: 0 }}>
              {cocktail.designRationale}
            </p>
          )}

          <div className="grid-4">
            <div className="card card-body metric">
              <strong>{cocktail.components.length}</strong>
              <span>Components</span>
            </div>
            <div className="card card-body metric">
              <strong>{cocktail.results.length}</strong>
              <span>Result rows</span>
            </div>
            <div className="card card-body metric">
              <strong>{timingRoles.length}</strong>
              <span>Timing classes</span>
            </div>
            <div className="card card-body metric">
              <strong>{cocktail.results.filter((item) => item.resistanceEmerged).length}</strong>
              <span>Resistance emergence flags</span>
            </div>
          </div>
          <div className="stack" style={{ gridAutoFlow: "column", gap: "0.35rem" }}>
            {timingRoles.map((role) => (
              <span key={role} className="pill" data-tone="accent">
                {role}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="card-body stack" style={{ gap: "0.75rem" }}>
            <h2 className="section-title">Components</h2>
            {cocktail.components.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No components linked yet.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Phage</th>
                    <th>Timing role</th>
                    <th>Ratio / dose</th>
                  </tr>
                </thead>
                <tbody>
                  {cocktail.components.map((component) => (
                    <tr key={component.id}>
                      <td>
                        <div className="stack" style={{ gap: "0.25rem" }}>
                          <Link href={`/phages/${component.phageId}`} style={{ color: "var(--accent)" }}>
                            {component.phageName}
                          </Link>
                          <span className="muted" style={{ fontSize: "0.84rem" }}>
                            {component.genomeAccession ?? "No accession"}
                          </span>
                        </div>
                      </td>
                      <td>{component.timingRole}</td>
                      <td>
                        ratio: {component.ratio ?? "—"} • dose: {component.dosePfu ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>

        <article className="card">
          <div className="card-body stack" style={{ gap: "0.75rem" }}>
            <h2 className="section-title">Experiment Results</h2>
            {cocktail.results.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No experiment results linked yet.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Strain</th>
                    <th>Assay / date</th>
                    <th>Outcome summary</th>
                  </tr>
                </thead>
                <tbody>
                  {cocktail.results.map((result) => (
                    <tr key={result.id}>
                      <td>
                        {result.strain.species ?? "Unknown strain"}
                        {result.strain.strainIdentifier
                          ? ` (${result.strain.strainIdentifier})`
                          : ""}
                      </td>
                      <td>
                        {result.experiment.assayType ?? "unknown assay"}
                        {result.experiment.date ? ` • ${result.experiment.date}` : ""}
                      </td>
                      <td>
                        <div className="stack" style={{ gap: "0.25rem" }}>
                          <span>{formatMetricPreview(result.outcomeMetrics)}</span>
                          <span className="muted" style={{ fontSize: "0.84rem" }}>
                            Resistance emerged:{" "}
                            {result.resistanceEmerged === null
                              ? "unknown"
                              : result.resistanceEmerged
                                ? "yes"
                                : "no"}
                            {result.observedSynergy !== null
                              ? ` • synergy: ${result.observedSynergy}`
                              : ""}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
