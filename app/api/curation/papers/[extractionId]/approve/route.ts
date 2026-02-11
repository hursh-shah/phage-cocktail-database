import { z } from "zod";
import { canMutateWithToken } from "@/lib/api-auth";
import { approvePaperExtraction } from "@/lib/paper-ingestion";

const bodySchema = z.object({
  reviewer: z.string().trim().min(2).default("curator")
});

export async function POST(
  request: Request,
  context: { params: Promise<{ extractionId: string }> }
) {
  try {
    if (!canMutateWithToken(request)) {
      return Response.json({ error: "Unauthorized review action." }, { status: 401 });
    }
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const { extractionId } = await context.params;
    const result = await approvePaperExtraction(extractionId, body.reviewer);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
