import { z } from "zod";
import { canMutateWithToken } from "@/lib/api-auth";
import { listPaperReviewQueue } from "@/lib/paper-ingestion";

const querySchema = z.object({
  status: z.enum(["pending_review", "approved", "rejected"]).optional()
});

export async function GET(request: Request) {
  try {
    if (!canMutateWithToken(request)) {
      return Response.json({ error: "Unauthorized review access." }, { status: 401 });
    }
    const url = new URL(request.url);
    const parsed = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const status = parsed.status ?? "pending_review";
    const queue = await listPaperReviewQueue(status);
    return Response.json({ status, queue });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
