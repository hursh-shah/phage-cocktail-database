import Link from "next/link";
import { UploadForm } from "@/app/upload/upload-form";
import { GeneticDistanceForm } from "@/app/upload/genetic-distance-form";

export const dynamic = "force-dynamic";

export default function UploadPage() {
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
                Upload Phage Metadata
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                Import TSV/CSV files into the `phages` table and keep your accession metadata
                current.
              </p>
            </div>
            <Link href="/phages" className="btn-link btn-muted">
              View phage records
            </Link>
          </div>
          <div className="card card-body stack" style={{ gap: "0.45rem" }}>
            <strong>Supported header aliases</strong>
            <span className="muted">
              Required accession column: `Phage_ID`, `phage_id`, `accession`, or
              `genbank_accession`.
            </span>
            <span className="muted">
              Optional: `Length`, `GC_content`, `Taxonomy`, `Host`, `Lifestyle`,
              `Completeness`, `Cluster`, `Subcluster`.
            </span>
          </div>
        </div>
      </section>

      <UploadForm />
      <GeneticDistanceForm />
    </main>
  );
}
