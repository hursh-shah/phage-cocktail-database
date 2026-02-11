import Link from "next/link";
import { NewCocktailForm } from "@/app/cocktails/new/new-cocktail-form";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function NewCocktailPage() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("phages")
    .select("id,name,genome_accession")
    .order("name", { ascending: true })
    .limit(5000);

  if (error) {
    throw new Error(`Failed to load phage options: ${error.message}`);
  }

  const phages = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "Unknown phage",
    genomeAccession:
      typeof row.genome_accession === "string" ? row.genome_accession : null
  }));

  return (
    <main className="page-shell stack">
      <section className="card">
        <div className="card-body stack" style={{ gap: "0.7rem" }}>
          <div className="split">
            <div className="stack" style={{ gap: "0.2rem" }}>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display), serif",
                  fontSize: "1.8rem"
                }}
              >
                New Cocktail Record
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                Write up a cocktail design and attach assay context plus result rows in one step.
              </p>
            </div>
            <Link href="/cocktails" className="btn-link btn-muted">
              Back to cocktails
            </Link>
          </div>
          <span className="muted">
            Loaded {phages.length} phage options from the current dataset.
          </span>
        </div>
      </section>

      <NewCocktailForm phages={phages} />
    </main>
  );
}
