import { z } from "zod";
import { canMutateWithToken } from "@/lib/api-auth";
import { rejectPaperExtraction } from "@/lib/paper-ingestion";

const bodySchema = z.object({
  reviewer: z.string().trim().min(2).default("curator"),
  reason: z.string().trim().min(3).default("Insufficient structured evidence for V1 publishability.")
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
    await rejectPaperExtraction(extractionId, body.reviewer, body.reason);
    return Response.json({ extractionId, status: "rejected" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
