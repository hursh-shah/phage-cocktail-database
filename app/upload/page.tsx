import Link from "next/link";
import { UploadForm } from "@/app/upload/upload-form";
import { GeneticDistanceForm } from "@/app/upload/genetic-distance-form";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <div className="split">
          <div className="stack" style={{ gap: "0.4rem" }}>
            <span className="eyebrow">Tools</span>
            <h1>Upload metadata</h1>
            <p className="page-summary">
              Import TSV/CSV files into the <span className="mono">phages</span> table and keep accession metadata current.
            </p>
          </div>
          <Link href="/phages" className="btn-link btn-muted">
            View phages
          </Link>
        </div>
        <p className="muted" style={{ margin: "0.4rem 0 0", maxWidth: "70ch", fontSize: "0.85rem" }}>
          Required accession column: <span className="mono">Phage_ID</span>,{" "}
          <span className="mono">phage_id</span>, <span className="mono">accession</span>, or{" "}
          <span className="mono">genbank_accession</span>. Optional:{" "}
          <span className="mono">Length</span>, <span className="mono">GC_content</span>,{" "}
          <span className="mono">Taxonomy</span>, <span className="mono">Host</span>,{" "}
          <span className="mono">Lifestyle</span>, <span className="mono">Completeness</span>,{" "}
          <span className="mono">Cluster</span>, <span className="mono">Subcluster</span>.
        </p>
      </header>

      <UploadForm />
      <GeneticDistanceForm />
    </main>
  );
}
