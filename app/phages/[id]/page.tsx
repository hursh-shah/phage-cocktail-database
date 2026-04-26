import Link from "next/link";
import { notFound } from "next/navigation";
import { getPhageById } from "@/lib/phage-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PhageDetailPage({ params }: PageProps) {
  const { id } = await params;
  const phage = await getPhageById(id);
  if (!phage) notFound();

  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="split">
          <div className="stack" style={{ gap: "0.4rem" }}>
            <span className="eyebrow">Phage record</span>
            <h1>{phage.name}</h1>
            <p className="page-summary">
              {phage.hostPrimaryTaxon ?? "Host unspecified"}
              <span className="sep">·</span>
              {phage.genomeAccession ? (
                <span className="mono">{phage.genomeAccession}</span>
              ) : (
                <span className="muted">accession pending</span>
              )}
              {phage.taxonomyFamily && (
                <>
                  <span className="sep">·</span>
                  {phage.taxonomyFamily}
                </>
              )}
            </p>
          </div>
          <Link href="/phages" className="btn-link btn-muted">
            Back to phages
          </Link>
        </div>

        <p className="page-summary" style={{ marginTop: "0.4rem" }}>
          genome length:{" "}
          <span className="mono">
            {phage.genomeLengthBp ? `${phage.genomeLengthBp.toLocaleString()} bp` : "—"}
          </span>
          <span className="sep">·</span>
          GC content: <span className="mono">{phage.gcContent ?? "—"}</span>
          <span className="sep">·</span>
          {phage.hostRangeAssays.length} host-range assays
          <span className="sep">·</span>
          {phage.kineticsObservations.length} kinetics observations
          <span className="sep">·</span>
          {phage.citations.length} citations
        </p>

        {phage.tags.length > 0 && (
          <div className="tag-list" style={{ marginTop: "0.5rem" }}>
            <span className="muted">tags:</span>
            {phage.tags.map((tag, idx) => (
              <span key={tag}>
                {tag}
                {idx < phage.tags.length - 1 && <span className="sep"> ·</span>}
              </span>
            ))}
          </div>
        )}

        {phage.notes && (
          <p className="muted" style={{ margin: "0.6rem 0 0", maxWidth: "70ch" }}>
            {phage.notes}
          </p>
        )}
      </header>

      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Host-range assays</h2>
          <span className="section-meta">{phage.hostRangeAssays.length} entries</span>
        </header>
        {phage.hostRangeAssays.length === 0 ? (
          <p className="muted">No host-range assays recorded.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Host strain</th>
                <th>Method</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {phage.hostRangeAssays.map((assay) => (
                <tr key={assay.id}>
                  <td>
                    {assay.hostStrain.species}
                    {assay.hostStrain.strainIdentifier
                      ? ` (${assay.hostStrain.strainIdentifier})`
                      : ""}
                  </td>
                  <td>{assay.assayMethod}</td>
                  <td>{assay.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Kinetics observations</h2>
          <span className="section-meta">{phage.kineticsObservations.length} entries</span>
        </header>
        {phage.kineticsObservations.length === 0 ? (
          <p className="muted">No kinetics observations recorded.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {phage.kineticsObservations.map((kinetics) => (
                <tr key={kinetics.id}>
                  <td>{kinetics.stageLabel}</td>
                  <td>{kinetics.metricType}</td>
                  <td>
                    <span className="mono">{kinetics.metricValue ?? "—"}</span>{" "}
                    {kinetics.metricUnit ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Cocktail context</h2>
          <span className="section-meta">{phage.cocktails.length} entries</span>
        </header>
        {phage.cocktails.length === 0 ? (
          <p className="muted">No cocktail components linked.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Timing role</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {phage.cocktails.map((item) => (
                <tr key={`${item.experimentId}-${item.timingRole}`}>
                  <td>{item.experimentName}</td>
                  <td>{item.timingRole}</td>
                  <td>{item.targetBacterium ?? "Unspecified"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Field-level provenance</h2>
          <span className="section-meta">{phage.citations.length} citations</span>
        </header>
        {phage.citations.length === 0 ? (
          <p className="muted">No citations linked.</p>
        ) : (
          <ul className="subtle-list">
            {phage.citations.map((citation) => (
              <li key={citation.id}>
                <div className="split" style={{ alignItems: "baseline" }}>
                  <strong>{citation.fieldName}</strong>
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    {citation.source.sourceType}
                  </span>
                </div>
                <p style={{ margin: "0.25rem 0" }}>{citation.source.title}</p>
                <div className="split" style={{ alignItems: "baseline" }}>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    {citation.evidence
                      ? `${citation.evidence.level} (${citation.evidence.confidence})`
                      : "Evidence unlinked"}
                  </span>
                  {citation.source.url && (
                    <a href={citation.source.url} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
