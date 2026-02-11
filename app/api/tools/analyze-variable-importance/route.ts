import { z } from "zod";
import { analyzeVariableImportance } from "@/lib/research-service";

const bodySchema = z.object({
  datasetSlice: z.array(z.record(z.unknown())).min(1)
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = analyzeVariableImportance(body.datasetSlice);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
