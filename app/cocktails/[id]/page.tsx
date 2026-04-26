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
    .join(" · ");
}

export default async function CocktailDetailPage({ params }: PageProps) {
  const { id } = await params;
  const cocktail = await getCocktailById(id);
  if (!cocktail) notFound();

  const timingRoles = [...new Set(cocktail.components.map((item) => item.timingRole))];
  const resistanceFlags = cocktail.results.filter((item) => item.resistanceEmerged).length;

  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="split">
          <div className="stack" style={{ gap: "0.4rem" }}>
            <span className="eyebrow">Cocktail record</span>
            <h1>{cocktail.name}</h1>
            <p className="page-summary">
              {cocktail.intent ?? "Intent unspecified"}
            </p>
          </div>
          <Link href="/cocktails" className="btn-link btn-muted">
            Back to cocktails
          </Link>
        </div>

        <p className="page-summary" style={{ marginTop: "0.4rem" }}>
          {cocktail.components.length} components
          <span className="sep">·</span>
          {cocktail.results.length} result rows
          <span className="sep">·</span>
          {timingRoles.length} timing classes
          <span className="sep">·</span>
          {resistanceFlags} resistance flags
        </p>

        {timingRoles.length > 0 && (
          <div className="tag-list" style={{ marginTop: "0.4rem" }}>
            <span className="muted">timing:</span>
            {timingRoles.map((role, idx) => (
              <span key={role}>
                {role}
                {idx < timingRoles.length - 1 && <span className="sep"> ·</span>}
              </span>
            ))}
          </div>
        )}

        {cocktail.designRationale && (
          <p className="muted" style={{ margin: "0.6rem 0 0", maxWidth: "70ch" }}>
            {cocktail.designRationale}
          </p>
        )}
      </header>

      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Components</h2>
          <span className="section-meta">{cocktail.components.length} entries</span>
        </header>
        {cocktail.components.length === 0 ? (
          <p className="muted">No components linked yet.</p>
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
                    <div className="stack" style={{ gap: "0.15rem" }}>
                      <Link href={`/phages/${component.phageId}`}>{component.phageName}</Link>
                      <span className="mono muted" style={{ fontSize: "0.8rem" }}>
                        {component.genomeAccession ?? "no accession"}
                      </span>
                    </div>
                  </td>
                  <td>{component.timingRole}</td>
                  <td>
                    <span className="mono">
                      ratio: {component.ratio ?? "—"} · dose: {component.dosePfu ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Experiment results</h2>
          <span className="section-meta">{cocktail.results.length} rows</span>
        </header>
        {cocktail.results.length === 0 ? (
          <p className="muted">No experiment results linked yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Strain</th>
                <th>Assay / date</th>
                <th>Outcome</th>
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
                    {result.experiment.date ? ` · ${result.experiment.date}` : ""}
                  </td>
                  <td>
                    <div className="stack" style={{ gap: "0.15rem" }}>
                      <span>{formatMetricPreview(result.outcomeMetrics)}</span>
                      <span className="muted" style={{ fontSize: "0.8rem" }}>
                        resistance:{" "}
                        {result.resistanceEmerged === null
                          ? "unknown"
                          : result.resistanceEmerged
                            ? "yes"
                            : "no"}
                        {result.observedSynergy !== null
                          ? ` · synergy: ${result.observedSynergy}`
                          : ""}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
