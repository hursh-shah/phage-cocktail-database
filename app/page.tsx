import Link from "next/link";
import { getCocktailSummary, listCocktails } from "@/lib/cocktail-service";
import { getDatasetSummary, listPhages } from "@/lib/phage-service";
import type { PhageListItem } from "@/types/phage";

export const dynamic = "force-dynamic";

type PriorityTarget = {
  name: string;
  stage: "early" | "semi_early" | "late";
  rationale: string;
};

const PRIORITY_TARGETS: PriorityTarget[] = [
  {
    name: "KB824",
    stage: "early",
    rationale: "Early-phase killer candidate for staged cocktail schedules."
  },
  {
    name: "SBP2@2",
    stage: "semi_early",
    rationale: "Bridge phage for mid-window activity in staged timing designs."
  },
  {
    name: "ANB28",
    stage: "late",
    rationale: "Late-phase activity candidate to suppress regrowth."
  }
];

type PriorityMatch = PriorityTarget & {
  record: PhageListItem | null;
};

async function findPriorityTargets(): Promise<PriorityMatch[]> {
  return Promise.all(
    PRIORITY_TARGETS.map(async (target) => {
      const result = await listPhages({ q: target.name, limit: 5, sort: "name_asc" });
      const exact = result.data.find(
        (item) => item.name.toLowerCase() === target.name.toLowerCase()
      );

      return {
        ...target,
        record: exact ?? result.data[0] ?? null
      };
    })
  );
}

export default async function HomePage() {
  const [cocktailSummary, phageSummary, recentCocktails, priorityTargets] =
    await Promise.all([
      getCocktailSummary(),
      getDatasetSummary(),
      listCocktails({ limit: 6, sort: "created_desc" }),
      findPriorityTargets()
    ]);

  const foundPriorityCount = priorityTargets.filter((item) => item.record !== null).length;

  return (
    <main className="page-shell stack" style={{ gap: "1.25rem" }}>
      <section className="card">
        <div className="card-body stack" style={{ gap: "0.95rem" }}>
          <div className="split">
            <div className="stack" style={{ gap: "0.4rem" }}>
              <p
                className="muted"
                style={{ textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}
              >
                Cocktail-First Research Workspace
              </p>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display), serif",
                  fontSize: "2rem",
                  lineHeight: 1.15
                }}
              >
                Build and test phage cocktail hypotheses with traceable evidence
              </h1>
              <p className="muted" style={{ margin: 0, maxWidth: "74ch" }}>
                Prioritize host-range observations, kinetics staging, resistance outcomes, and
                experiment conditions before model training. Genome metadata upload is ready from
                CSV/TSV.
              </p>
            </div>
            <div className="stack" style={{ gridAutoFlow: "column", gap: "0.55rem" }}>
              <Link className="btn-link" href="/cocktails">
                Browse cocktails
              </Link>
              <Link className="btn-link btn-muted" href="/papers">
                Paper console
              </Link>
              <Link className="btn-link btn-muted" href="/upload">
                Upload metadata
              </Link>
            </div>
          </div>
          <div className="grid-4">
            <div className="card card-body metric">
              <strong>{cocktailSummary.cocktailCount}</strong>
              <span>Cocktail designs</span>
            </div>
            <div className="card card-body metric">
              <strong>{cocktailSummary.componentCount}</strong>
              <span>Cocktail components</span>
            </div>
            <div className="card card-body metric">
              <strong>{cocktailSummary.resultCount}</strong>
              <span>Experiment results</span>
            </div>
            <div className="card card-body metric">
              <strong>{phageSummary.phageCount}</strong>
              <span>Tracked phage records</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <div className="split">
            <h2 className="section-title">Priority Targets From Your Collaboration Notes</h2>
            <span className="muted">
              {foundPriorityCount}/{priorityTargets.length} currently present in the dataset
            </span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Phage target</th>
                <th>Timing role to test</th>
                <th>Status in DB</th>
                <th>Why prioritize</th>
              </tr>
            </thead>
            <tbody>
              {priorityTargets.map((target) => (
                <tr key={target.name}>
                  <td>{target.name}</td>
                  <td>
                    <span className="pill" data-tone="accent">
                      {target.stage}
                    </span>
                  </td>
                  <td>
                    {target.record ? (
                      <Link href={`/phages/${target.record.id}`} style={{ color: "var(--accent)" }}>
                        {target.record.name}
                      </Link>
                    ) : (
                      <span className="muted">Not found yet (import needed)</span>
                    )}
                  </td>
                  <td>{target.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <div className="split">
            <h2 className="section-title">Recent Cocktail Records</h2>
            <Link className="btn-link btn-muted" href="/cocktails">
              Full cocktail index
            </Link>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Intent</th>
                <th>Components</th>
                <th>Result rows</th>
              </tr>
            </thead>
            <tbody>
              {recentCocktails.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No cocktail records yet. Start by uploading metadata and creating a first
                    cocktail entry.
                  </td>
                </tr>
              )}
              {recentCocktails.data.map((cocktail) => (
                <tr key={cocktail.id}>
                  <td>
                    <Link href={`/cocktails/${cocktail.id}`} style={{ color: "var(--accent)" }}>
                      {cocktail.name}
                    </Link>
                  </td>
                  <td>{cocktail.intent ?? "Unspecified"}</td>
                  <td>{cocktail.componentCount}</td>
                  <td>{cocktail.resultCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
