import { getStrainPhenotypes } from "@/lib/research-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const phenotypes = await getStrainPhenotypes(id);
    if (!phenotypes) {
      return Response.json({ error: "Strain not found" }, { status: 404 });
    }
    return Response.json(phenotypes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 400 });
  }
}
