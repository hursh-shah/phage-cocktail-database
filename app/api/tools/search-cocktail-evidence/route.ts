import { z } from "zod";
import { searchCocktailEvidence } from "@/lib/research-service";

const bodySchema = z.object({
  query: z.string().trim().min(1),
  filters: z
    .object({
      pathogen: z.string().trim().optional(),
      assay: z.string().trim().optional()
    })
    .optional()
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = await searchCocktailEvidence(body.query, body.filters ?? {});
    return Response.json({ query: body.query, results: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
