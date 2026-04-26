// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type SearchResponse = {
  jobId: string;
  discovered: number;
  inserted: number;
  deduped: number;
};

const DEFAULT_TERM =
  '("Stenotrophomonas maltophilia"[Title/Abstract] OR "S. maltophilia"[Title/Abstract]) AND (phage[Title/Abstract] OR bacteriophage[Title/Abstract]) AND ("host range"[Title/Abstract] OR infectivity[Title/Abstract] OR EOP[Title/Abstract] OR "efficiency of plating"[Title/Abstract] OR "growth curve"[Title/Abstract] OR "kill curve"[Title/Abstract] OR cocktail[Title/Abstract] OR biofilm[Title/Abstract] OR "antibiotic synergy"[Title/Abstract] OR "resistance emergence"[Title/Abstract]) NOT (prophage[Title] OR prophages[Title] OR "phylogenetic diversity"[Title] OR "comparative genomics"[Title])';

async function runIngestion(baseUrl: string, token: string): Promise<SearchResponse> {
  const response = await fetch(`${baseUrl}/api/ingest/papers/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-upload-token": token
    },
    body: JSON.stringify({
      term: DEFAULT_TERM,
      maxResults: 25,
      pathogenFocus: "S_maltophilia",
      profile: "steno"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ingestion trigger failed: HTTP ${response.status} ${text}`);
  }
  return (await response.json()) as SearchResponse;
}

Deno.serve(async () => {
  try {
    const appBaseUrl = Deno.env.get("APP_BASE_URL");
    const uploadToken = Deno.env.get("UPLOAD_API_TOKEN");
    if (!appBaseUrl || !uploadToken) {
      return new Response(
        JSON.stringify({
          error: "Missing APP_BASE_URL or UPLOAD_API_TOKEN"
        }),
        { status: 500 }
      );
    }

    const search = await runIngestion(appBaseUrl, uploadToken);
    return new Response(
      JSON.stringify({
        ok: true,
        search
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
