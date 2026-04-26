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
    <main className="page-shell">
      <header className="page-header">
        <div className="split">
          <div className="stack" style={{ gap: "0.4rem" }}>
            <span className="eyebrow">Tools</span>
            <h1>New cocktail</h1>
            <p className="page-summary">
              Write up a cocktail design and attach assay context plus result rows in one step.
              <span className="sep">·</span>
              {phages.length.toLocaleString()} phage options available.
            </p>
          </div>
          <Link href="/cocktails" className="btn-link btn-muted">
            Back to cocktails
          </Link>
        </div>
      </header>

      <NewCocktailForm phages={phages} />
    </main>
  );
}
