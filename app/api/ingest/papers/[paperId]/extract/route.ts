import { canMutateWithToken } from "@/lib/api-auth";
import { extractPaperRows } from "@/lib/paper-ingestion";

export async function POST(
  request: Request,
  context: { params: Promise<{ paperId: string }> }
) {
  try {
    if (!canMutateWithToken(request)) {
      return Response.json({ error: "Unauthorized ingestion trigger." }, { status: 401 });
    }
    const { paperId } = await context.params;
    const result = await extractPaperRows(paperId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
