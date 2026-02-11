import Link from "next/link";
import { listPublishedPaperOutcomes } from "@/lib/research-service";
import { PapersConsole } from "@/app/papers/papers-console";

export const dynamic = "force-dynamic";

export default async function PapersPage() {
  const published = await listPublishedPaperOutcomes({ pathogen: "S_aureus" });

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
                Paper Ingestion Console
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                OA pipeline for S. aureus cocktail outcomes with staged curator review.
              </p>
            </div>
            <Link href="/cocktails" className="btn-link btn-muted">
              Cocktails
            </Link>
          </div>
          <div className="grid-4">
            <div className="card card-body metric">
              <strong>token</strong>
              <span>Queue papers</span>
            </div>
            <div className="card card-body metric">
              <strong>token</strong>
              <span>Pending review sets</span>
            </div>
            <div className="card card-body metric">
              <strong>{published.length}</strong>
              <span>Published outcomes</span>
            </div>
            <div className="card card-body metric">
              <strong>S. aureus</strong>
              <span>Default pathogen scope</span>
            </div>
          </div>
        </div>
      </section>

      <PapersConsole
        initialQueue={[]}
        initialReview={[]}
        initialPublished={published}
      />
    </main>
  );
}
