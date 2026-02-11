import { getCocktailById } from "@/lib/cocktail-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const cocktail = await getCocktailById(id);

    if (!cocktail) {
      return Response.json({ error: "Cocktail not found" }, { status: 404 });
    }

    return Response.json(cocktail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
