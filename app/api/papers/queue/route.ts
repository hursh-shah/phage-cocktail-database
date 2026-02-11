import { z } from "zod";
import { canMutateWithToken } from "@/lib/api-auth";
import { listPaperQueue } from "@/lib/paper-ingestion";

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional()
});

export async function GET(request: Request) {
  try {
    if (!canMutateWithToken(request)) {
      return Response.json({ error: "Unauthorized curation access." }, { status: 401 });
    }
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const papers = await listPaperQueue(parsed.limit ?? 100);
    return Response.json({ total: papers.length, papers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
