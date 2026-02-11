import { z } from "zod";
import { canMutateWithToken } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase";

const bodySchema = z.object({
  cocktailName: z.string().trim().optional(),
  assayType: z
    .enum(["spot", "plaque", "EOP", "kill_curve", "biofilm", "in_vivo", "other"])
    .optional(),
  hostSpecies: z.string().trim().optional(),
  hostStrainRaw: z.string().trim().optional(),
  phageNames: z.array(z.string().trim()).optional(),
  phageAccessions: z.array(z.string().trim()).optional(),
  conditions: z.record(z.unknown()).optional(),
  outcomeMetrics: z.record(z.unknown()).optional(),
  evidenceLocation: z.string().trim().optional(),
  confidence: z.number().min(0).max(1).optional(),
  needsReview: z.boolean().optional()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ rowId: string }> }
) {
  try {
    if (!canMutateWithToken(request)) {
      return Response.json({ error: "Unauthorized review action." }, { status: 401 });
    }
    const { rowId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("paper_extraction_rows")
      .update({
        cocktail_name: body.cocktailName,
        assay_type: body.assayType,
        host_species: body.hostSpecies,
        host_strain_raw: body.hostStrainRaw,
        phage_names_json: body.phageNames,
        phage_accessions_json: body.phageAccessions,
        conditions_json: body.conditions,
        outcome_metrics_json: body.outcomeMetrics,
        evidence_location: body.evidenceLocation,
        confidence: body.confidence,
        needs_review: body.needsReview
      })
      .eq("id", rowId);
    if (error) throw new Error(error.message);
    return Response.json({ rowId, updated: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
