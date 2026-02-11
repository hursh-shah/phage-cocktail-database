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
                {phage.name}
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                {phage.hostPrimaryTaxon ?? "Host unspecified"} •{" "}
                {phage.genomeAccession ?? "Genome accession pending"}
              </p>
            </div>
            <Link href="/phages" className="btn-link btn-muted">
              Back to collection
            </Link>
          </div>
          <div className="grid-4">
            <div className="card card-body metric">
              <strong>{phage.genomeLengthBp ?? "—"}</strong>
              <span>Genome length (bp)</span>
            </div>
            <div className="card card-body metric">
              <strong>{phage.gcContent ?? "—"}</strong>
              <span>GC content</span>
            </div>
            <div className="card card-body metric">
              <strong>{phage.hostRangeAssays.length}</strong>
              <span>Host-range assays</span>
            </div>
            <div className="card card-body metric">
              <strong>{phage.citations.length}</strong>
              <span>Field citations</span>
            </div>
          </div>
          <div className="stack" style={{ gridAutoFlow: "column", gap: "0.35rem" }}>
            {phage.tags.map((tag) => (
              <span key={tag} className="pill">
                {tag}
              </span>
            ))}
          </div>
          {phage.notes && (
            <p className="muted" style={{ margin: 0 }}>
              {phage.notes}
            </p>
          )}
        </div>
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="card-body stack" style={{ gap: "0.75rem" }}>
            <h2 className="section-title">Host-Range Assays</h2>
            {phage.hostRangeAssays.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No host-range assays recorded.
              </p>
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
          </div>
        </article>

        <article className="card">
          <div className="card-body stack" style={{ gap: "0.75rem" }}>
            <h2 className="section-title">Kinetics Observations</h2>
            {phage.kineticsObservations.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No kinetics observations recorded.
              </p>
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
                        {kinetics.metricValue ?? "—"}{" "}
                        {kinetics.metricUnit ? kinetics.metricUnit : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="card-body stack" style={{ gap: "0.75rem" }}>
            <h2 className="section-title">Cocktail Context</h2>
            {phage.cocktails.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No cocktail components linked.
              </p>
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
          </div>
        </article>

        <article className="card">
          <div className="card-body stack" style={{ gap: "0.75rem" }}>
            <h2 className="section-title">Field-Level Provenance</h2>
            {phage.citations.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No citations linked.
              </p>
            ) : (
              <div className="stack">
                {phage.citations.map((citation) => (
                  <div key={citation.id} className="card card-body">
                    <div className="split">
                      <strong>{citation.fieldName}</strong>
                      <span className="pill">{citation.source.sourceType}</span>
                    </div>
                    <p style={{ margin: "0.35rem 0" }}>{citation.source.title}</p>
                    <div className="split">
                      <span className="muted">
                        {citation.evidence
                          ? `${citation.evidence.level} (${citation.evidence.confidence})`
                          : "Evidence unlinked"}
                      </span>
                      {citation.source.url && (
                        <a
                          href={citation.source.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent)" }}
                        >
                          Source
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
