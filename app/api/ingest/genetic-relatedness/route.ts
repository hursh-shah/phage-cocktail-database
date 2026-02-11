import { z } from "zod";
import { canMutateWithToken } from "@/lib/api-auth";
import { ingestGeneticRelatednessFromDelimited } from "@/lib/paper-ingestion";

const bodySchema = z.object({
  delimiter: z.enum(["csv", "tsv"]).optional()
});

export async function POST(request: Request) {
  try {
    if (!canMutateWithToken(request)) {
      return Response.json({ error: "Unauthorized ingestion trigger." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const parsedBody = bodySchema.parse({
      delimiter:
        typeof formData.get("delimiter") === "string"
          ? formData.get("delimiter")
          : undefined
    });

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file field in multipart form data." }, { status: 400 });
    }

    const text = await file.text();
    const result = await ingestGeneticRelatednessFromDelimited(
      file.name,
      text,
      parsedBody.delimiter
    );
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
