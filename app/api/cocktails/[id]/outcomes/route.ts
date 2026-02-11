import { listCocktailOutcomes } from "@/lib/research-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const outcomes = await listCocktailOutcomes(id);
    return Response.json({ cocktailId: id, outcomes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
