import { z } from "zod";
import { listPublishedPaperOutcomes } from "@/lib/research-service";

const querySchema = z.object({
  pathogen: z.string().trim().optional(),
  assay: z.string().trim().optional(),
  requires_quant: z.enum(["true", "false"]).optional()
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const results = await listPublishedPaperOutcomes({
      pathogen: parsed.pathogen,
      assay: parsed.assay,
      requiresQuant: parsed.requires_quant === "true"
    });
    return Response.json({ total: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
