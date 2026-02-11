import { listCocktails } from "@/lib/cocktail-service";
import { z } from "zod";

const querySchema = z.object({
  q: z.string().trim().optional(),
  intent: z.string().trim().optional(),
  host_species: z.string().trim().optional(),
  pathogen: z.string().trim().optional(),
  assay: z.string().trim().optional(),
  resistance_emerged: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  sort: z.enum(["name_asc", "name_desc", "created_desc"]).optional()
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));

    const result = await listCocktails({
      q: parsed.q,
      intent: parsed.intent,
      hostSpecies: parsed.host_species,
      pathogen: parsed.pathogen,
      assay: parsed.assay,
      resistanceEmerged:
        parsed.resistance_emerged === undefined
          ? undefined
          : parsed.resistance_emerged === "true",
      page: parsed.page,
      limit: parsed.limit,
      sort: parsed.sort
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
