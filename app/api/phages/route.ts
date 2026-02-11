import { listPhages } from "@/lib/phage-service";
import { z } from "zod";

const querySchema = z.object({
  q: z.string().trim().optional(),
  host_species: z.string().trim().optional(),
  stage_label: z.enum(["early", "semi_early", "late", "unknown"]).optional(),
  tags: z.string().trim().optional(),
  has_cocktail_data: z.enum(["true", "false"]).optional(),
  evidence_level: z.enum(["peer_reviewed", "preprint", "unpublished_comm"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  sort: z.enum(["name_asc", "name_desc", "created_desc"]).optional()
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const tags = parsed.tags
      ? parsed.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

    const result = await listPhages({
      q: parsed.q,
      hostSpecies: parsed.host_species,
      stageLabel: parsed.stage_label,
      tags,
      hasCocktailData:
        parsed.has_cocktail_data === undefined
          ? undefined
          : parsed.has_cocktail_data === "true",
      evidenceLevel: parsed.evidence_level,
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
