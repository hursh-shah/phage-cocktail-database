import { getCocktailGeneticDistanceSummary } from "@/lib/research-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const summary = await getCocktailGeneticDistanceSummary(id);
    return Response.json({ cocktailId: id, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
