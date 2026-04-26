import { listPublishedPaperOutcomes } from "@/lib/research-service";
import { PapersConsole } from "@/app/papers/papers-console";

export const dynamic = "force-dynamic";

export default async function PapersPage() {
  const published = await listPublishedPaperOutcomes({ pathogen: "S_maltophilia" });

  return (
    <main className="page-shell">
      <header className="page-header">
        <span className="eyebrow">Tools</span>
        <h1>Paper ingestion</h1>
        <p className="page-summary">
          OA pipeline for Stenotrophomonas cocktail design factors with staged curator review.
          <span className="sep">·</span>
          {published.length} published outcomes
          <span className="sep">·</span>
          default scope: <span className="mono">S_maltophilia</span>
        </p>
      </header>

      <PapersConsole
        initialQueue={[]}
        initialReview={[]}
        initialPublished={published}
      />
    </main>
  );
}
