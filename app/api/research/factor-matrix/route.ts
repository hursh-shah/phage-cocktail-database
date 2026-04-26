import { z } from "zod";
import { listResearchFactorMatrix } from "@/lib/research-service";

const querySchema = z.object({
  pathogen: z.string().trim().optional(),
  factor_type: z.string().trim().optional(),
  include_unpublished: z.enum(["true", "false"]).optional()
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const rows = await listResearchFactorMatrix({
      pathogen: parsed.pathogen ?? "S_maltophilia",
      factorType: parsed.factor_type,
      includeUnpublished: parsed.include_unpublished === "true"
    });
    return Response.json({ total: rows.length, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
