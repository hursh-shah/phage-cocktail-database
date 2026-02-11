import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase";

function canWriteInCurrentEnv(request: Request): boolean {
  const requiredToken = process.env.UPLOAD_API_TOKEN;
  if (!requiredToken) {
    return process.env.NODE_ENV !== "production";
  }

  const tokenFromHeader = request.headers.get("x-upload-token");
  return tokenFromHeader === requiredToken;
}

const timingRoleSchema = z.enum(["early", "semi_early", "late", "unknown"]);

const payloadSchema = z
  .object({
    cocktail: z.object({
      name: z.string().trim().min(2),
      intent: z.string().trim().optional(),
      designRationale: z.string().trim().optional(),
      createdBy: z.string().trim().optional()
    }),
    assay: z
      .object({
        type: z.enum(["spot", "plaque", "EOP", "kill_curve", "biofilm", "in_vivo", "other"]),
        protocolRef: z.string().trim().optional(),
        readoutSchema: z.record(z.unknown()).optional()
      })
      .optional(),
    experiment: z
      .object({
        lab: z.string().trim().optional(),
        operator: z.string().trim().optional(),
        experimentDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        conditions: z.record(z.unknown()).optional(),
        rawDataUri: z.string().trim().optional(),
        qcFlags: z.record(z.unknown()).optional()
      })
      .optional(),
    components: z
      .array(
        z.object({
          phageId: z.string().uuid(),
          timingRole: timingRoleSchema.default("unknown"),
          ratio: z.number().nullable().optional(),
          dosePfu: z.number().nullable().optional(),
          componentNotes: z.string().trim().optional()
        })
      )
      .min(1),
    results: z
      .array(
        z.object({
          strainSpecies: z.string().trim().min(2),
          strainName: z.string().trim().optional(),
          strainIdentifier: z.string().trim().optional(),
          outcomeMetrics: z.record(z.unknown()).default({}),
          resistanceEmerged: z.boolean().nullable().optional(),
          observedSynergy: z.number().nullable().optional(),
          notes: z.string().trim().optional()
        })
      )
      .default([])
  })
  .superRefine((payload, context) => {
    const hasExperiment = Boolean(payload.experiment);
    const hasAssay = Boolean(payload.assay);
    const hasResults = payload.results.length > 0;

    if (hasExperiment && !hasAssay) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An assay definition is required when experiment metadata is provided.",
        path: ["assay"]
      });
    }

    if (hasResults && !hasExperiment) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Experiment context is required when result rows are provided.",
        path: ["experiment"]
      });
    }
  });

async function findOrCreateHostStrain(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  species: string,
  strainName?: string,
  strainIdentifier?: string
): Promise<string> {
  let lookup = supabase
    .from("host_strains")
    .select("id")
    .eq("species", species)
    .limit(1);

  lookup = strainName
    ? lookup.eq("strain_name", strainName)
    : lookup.is("strain_name", null);

  lookup = strainIdentifier
    ? lookup.eq("strain_identifier", strainIdentifier)
    : lookup.is("strain_identifier", null);

  const existing = await lookup.maybeSingle();
  if (existing.error) {
    throw new Error(`Failed to look up host strain: ${existing.error.message}`);
  }
  if (existing.data?.id) return String(existing.data.id);

  const inserted = await supabase
    .from("host_strains")
    .insert({
      species,
      strain_name: strainName ?? null,
      strain_identifier: strainIdentifier ?? null,
      metadata_json: {}
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data?.id) {
    throw new Error(`Failed to create host strain: ${inserted.error?.message ?? "Unknown error"}`);
  }

  return String(inserted.data.id);
}

export async function POST(request: Request) {
  try {
    if (!canWriteInCurrentEnv(request)) {
      return Response.json(
        {
          error:
            "Unauthorized write. Provide x-upload-token or set NODE_ENV=development without UPLOAD_API_TOKEN."
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const payload = payloadSchema.parse(body);
    const supabase = createSupabaseAdminClient();

    let assayId: string | null = null;
    if (payload.assay) {
      const assayInsert = await supabase
        .from("assays")
        .insert({
          type: payload.assay.type,
          protocol_ref: payload.assay.protocolRef || null,
          readout_schema: payload.assay.readoutSchema ?? {}
        })
        .select("id")
        .single();

      if (assayInsert.error || !assayInsert.data?.id) {
        throw new Error(`Failed to create assay: ${assayInsert.error?.message ?? "Unknown error"}`);
      }
      assayId = String(assayInsert.data.id);
    }

    let experimentId: string | null = null;
    if (payload.experiment) {
      const experimentInsert = await supabase
        .from("experiments")
        .insert({
          assay_id: assayId,
          lab: payload.experiment.lab || null,
          operator: payload.experiment.operator || null,
          experiment_date: payload.experiment.experimentDate || null,
          conditions: payload.experiment.conditions ?? {},
          raw_data_uri: payload.experiment.rawDataUri || null,
          qc_flags: payload.experiment.qcFlags ?? {}
        })
        .select("id")
        .single();

      if (experimentInsert.error || !experimentInsert.data?.id) {
        throw new Error(
          `Failed to create experiment: ${experimentInsert.error?.message ?? "Unknown error"}`
        );
      }
      experimentId = String(experimentInsert.data.id);
    }

    const cocktailWrite = await supabase
      .from("cocktails")
      .upsert(
        {
          name: payload.cocktail.name,
          intent: payload.cocktail.intent || null,
          design_rationale: payload.cocktail.designRationale || null,
          created_by: payload.cocktail.createdBy || null
        },
        { onConflict: "name" }
      )
      .select("id,name")
      .single();

    if (cocktailWrite.error || !cocktailWrite.data?.id) {
      throw new Error(
        `Failed to create cocktail: ${cocktailWrite.error?.message ?? "Unknown error"}`
      );
    }

    const cocktailId = String(cocktailWrite.data.id);

    const componentRows = payload.components.map((component) => ({
      cocktail_id: cocktailId,
      phage_id: component.phageId,
      ratio: component.ratio ?? null,
      dose_pfu: component.dosePfu ?? null,
      timing_role: component.timingRole,
      component_notes: component.componentNotes || null
    }));

    const componentWrite = await supabase
      .from("cocktail_component")
      .upsert(componentRows, { onConflict: "cocktail_id,phage_id" });

    if (componentWrite.error) {
      throw new Error(`Failed to write cocktail components: ${componentWrite.error.message}`);
    }

    let resultRowsWritten = 0;
    if (payload.results.length > 0) {
      const resultRows: Array<Record<string, unknown>> = [];
      for (const row of payload.results) {
        const strainId = await findOrCreateHostStrain(
          supabase,
          row.strainSpecies,
          row.strainName,
          row.strainIdentifier
        );
        resultRows.push({
          cocktail_id: cocktailId,
          strain_id: strainId,
          experiment_id: experimentId,
          outcome_metrics: row.outcomeMetrics ?? {},
          resistance_emerged:
            typeof row.resistanceEmerged === "boolean" ? row.resistanceEmerged : null,
          observed_synergy: row.observedSynergy ?? null,
          notes: row.notes || null
        });
      }

      const resultsInsert = await supabase
        .from("cocktail_experiment_results")
        .insert(resultRows);

      if (resultsInsert.error) {
        throw new Error(`Failed to write experiment results: ${resultsInsert.error.message}`);
      }
      resultRowsWritten = resultRows.length;
    }

    return Response.json({
      cocktailId,
      cocktailName: payload.cocktail.name,
      assayId,
      experimentId,
      componentCount: componentRows.length,
      resultCount: resultRowsWritten
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected cocktail write failure";
    return Response.json({ error: message }, { status: 400 });
  }
}
