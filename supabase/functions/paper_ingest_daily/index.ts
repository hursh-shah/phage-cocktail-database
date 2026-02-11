// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type SearchResponse = {
  jobId: string;
  discovered: number;
  inserted: number;
  deduped: number;
};

const DEFAULT_TERM =
  '"phage cocktail" AND (staphylococcus OR "S. aureus") AND ("kill curve" OR biofilm OR CFU OR "log reduction")';

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
      pathogenFocus: "S_aureus"
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
