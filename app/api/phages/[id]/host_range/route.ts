import { z } from "zod";
import { getPhageHostRange } from "@/lib/research-service";

const querySchema = z.object({
  include_evidence: z.enum(["true", "false"]).optional()
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const includeEvidence = parsed.include_evidence === "true";
    const result = await getPhageHostRange(id, includeEvidence);
    return Response.json({ phageId: id, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
