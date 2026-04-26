import { z } from "zod";
import { canMutateWithToken } from "@/lib/api-auth";
import { searchAndQueuePapers } from "@/lib/paper-ingestion";

const bodySchema = z.object({
  term: z.string().trim().optional(),
  maxResults: z.coerce.number().int().positive().max(100).optional(),
  pathogenFocus: z.string().trim().optional(),
  profile: z.enum(["steno", "staph", "ecoli", "pseudomonas", "custom"]).optional()
});

export async function POST(request: Request) {
  try {
    if (!canMutateWithToken(request)) {
      return Response.json(
        { error: "Unauthorized ingestion trigger." },
        { status: 401 }
      );
    }

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await searchAndQueuePapers(body);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
