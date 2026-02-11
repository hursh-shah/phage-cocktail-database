import { z } from "zod";
import { suggestCocktail } from "@/lib/research-service";

const bodySchema = z.object({
  phagePool: z.array(z.string().trim()).min(2),
  constraints: z
    .object({
      pathogen: z.string().trim().optional(),
      assay: z.string().trim().optional(),
      minSize: z.coerce.number().int().positive().optional(),
      maxSize: z.coerce.number().int().positive().optional()
    })
    .optional()
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = await suggestCocktail(body.phagePool, body.constraints ?? {});
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
