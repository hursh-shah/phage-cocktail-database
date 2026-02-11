"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type PhageOption = {
  id: string;
  name: string;
  genomeAccession: string | null;
};

type Props = {
  phages: PhageOption[];
};

type ComponentRow = {
  phageId: string;
  timingRole: "early" | "semi_early" | "late" | "unknown";
  ratio: string;
  dosePfu: string;
  componentNotes: string;
};

type ResultRow = {
  strainSpecies: string;
  strainName: string;
  strainIdentifier: string;
  resistanceEmerged: "" | "true" | "false";
  observedSynergy: string;
  outcomeMetricsJson: string;
  notes: string;
};

type SubmitState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      cocktailId: string;
      cocktailName: string;
      componentCount: number;
      resultCount: number;
    };

function parseOptionalNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: "${raw}"`);
  }
  return parsed;
}

function parseObjectJson(raw: string, label: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function NewCocktailForm({ phages }: Props) {
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [designRationale, setDesignRationale] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [includeExperiment, setIncludeExperiment] = useState(true);
  const [uploadToken, setUploadToken] = useState("");

  const [assayType, setAssayType] = useState<
    "spot" | "plaque" | "EOP" | "kill_curve" | "biofilm" | "in_vivo" | "other"
  >("kill_curve");
  const [protocolRef, setProtocolRef] = useState("");
  const [readoutSchemaJson, setReadoutSchemaJson] = useState("{}");
  const [lab, setLab] = useState("");
  const [operator, setOperator] = useState("");
  const [experimentDate, setExperimentDate] = useState("");
  const [conditionsJson, setConditionsJson] = useState("{}");
  const [rawDataUri, setRawDataUri] = useState("");
  const [qcFlagsJson, setQcFlagsJson] = useState("{}");

  const [components, setComponents] = useState<ComponentRow[]>([
    {
      phageId: phages[0]?.id ?? "",
      timingRole: "unknown",
      ratio: "",
      dosePfu: "",
      componentNotes: ""
    }
  ]);

  const [results, setResults] = useState<ResultRow[]>([
    {
      strainSpecies: "Staphylococcus aureus",
      strainName: "",
      strainIdentifier: "",
      resistanceEmerged: "",
      observedSynergy: "",
      outcomeMetricsJson: "{}",
      notes: ""
    }
  ]);

  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (components.length === 0) return false;
    if (components.some((row) => !row.phageId)) return false;
    if (includeExperiment && results.some((row) => !row.strainSpecies.trim())) return false;
    return true;
  }, [components, includeExperiment, name, results]);

  function addComponent() {
    setComponents((current) => [
      ...current,
      {
        phageId: phages[0]?.id ?? "",
        timingRole: "unknown",
        ratio: "",
        dosePfu: "",
        componentNotes: ""
      }
    ]);
  }

  function removeComponent(index: number) {
    setComponents((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function addResult() {
    setResults((current) => [
      ...current,
      {
        strainSpecies: "",
        strainName: "",
        strainIdentifier: "",
        resistanceEmerged: "",
        observedSynergy: "",
        outcomeMetricsJson: "{}",
        notes: ""
      }
    ]);
  }

  function removeResult(index: number) {
    setResults((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "loading" });

    try {
      const payload = {
        cocktail: {
          name: name.trim(),
          intent: intent.trim() || undefined,
          designRationale: designRationale.trim() || undefined,
          createdBy: createdBy.trim() || undefined
        },
        assay: includeExperiment
          ? {
              type: assayType,
              protocolRef: protocolRef.trim() || undefined,
              readoutSchema: parseObjectJson(readoutSchemaJson, "Readout schema")
            }
          : undefined,
        experiment: includeExperiment
          ? {
              lab: lab.trim() || undefined,
              operator: operator.trim() || undefined,
              experimentDate: experimentDate.trim() || undefined,
              conditions: parseObjectJson(conditionsJson, "Experiment conditions"),
              rawDataUri: rawDataUri.trim() || undefined,
              qcFlags: parseObjectJson(qcFlagsJson, "QC flags")
            }
          : undefined,
        components: components.map((row) => ({
          phageId: row.phageId,
          timingRole: row.timingRole,
          ratio: parseOptionalNumber(row.ratio),
          dosePfu: parseOptionalNumber(row.dosePfu),
          componentNotes: row.componentNotes.trim() || undefined
        })),
        results: includeExperiment
          ? results
              .filter((row) => row.strainSpecies.trim())
              .map((row) => ({
                strainSpecies: row.strainSpecies.trim(),
                strainName: row.strainName.trim() || undefined,
                strainIdentifier: row.strainIdentifier.trim() || undefined,
                outcomeMetrics: parseObjectJson(row.outcomeMetricsJson, "Outcome metrics"),
                resistanceEmerged:
                  row.resistanceEmerged === ""
                    ? null
                    : row.resistanceEmerged === "true",
                observedSynergy: parseOptionalNumber(row.observedSynergy),
                notes: row.notes.trim() || undefined
              }))
          : []
      };

      const response = await fetch("/api/curation/cocktails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(uploadToken.trim() ? { "x-upload-token": uploadToken.trim() } : {})
        },
        body: JSON.stringify(payload)
      });

      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Write failed.");
      }

      setState({
        status: "success",
        cocktailId: String(json.cocktailId),
        cocktailName: String(json.cocktailName),
        componentCount: Number(json.componentCount ?? 0),
        resultCount: Number(json.resultCount ?? 0)
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unexpected failure"
      });
    }
  }

  return (
    <form className="stack" onSubmit={submitForm}>
      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <h2 className="section-title">Cocktail Design</h2>
          <div className="grid-2">
            <div className="field-row">
              <label htmlFor="cocktail_name">Cocktail name</label>
              <input
                id="cocktail_name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Staph staged timing v2"
              />
            </div>
            <div className="field-row">
              <label htmlFor="intent">Intent</label>
              <input
                id="intent"
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                placeholder="staged kinetics / broad coverage / close genetic"
              />
            </div>
            <div className="field-row">
              <label htmlFor="created_by">Created by</label>
              <input
                id="created_by"
                value={createdBy}
                onChange={(event) => setCreatedBy(event.target.value)}
                placeholder="hursh + collaborator"
              />
            </div>
            <div className="field-row">
              <label htmlFor="upload_token">Write token (if configured)</label>
              <input
                id="upload_token"
                value={uploadToken}
                onChange={(event) => setUploadToken(event.target.value)}
                placeholder="Optional x-upload-token"
              />
            </div>
          </div>
          <div className="field-row">
            <label htmlFor="design_rationale">Design rationale</label>
            <textarea
              id="design_rationale"
              value={designRationale}
              onChange={(event) => setDesignRationale(event.target.value)}
              rows={4}
              placeholder="Why this cocktail should work better than alternatives..."
            />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <div className="split">
            <h2 className="section-title">Components</h2>
            <button className="btn-link btn-muted" type="button" onClick={addComponent}>
              Add phage
            </button>
          </div>
          {components.map((row, index) => (
            <div key={`component-${index}`} className="card card-body stack" style={{ gap: "0.6rem" }}>
              <div className="split">
                <strong>Component {index + 1}</strong>
                {components.length > 1 && (
                  <button
                    className="btn-link btn-danger"
                    type="button"
                    onClick={() => removeComponent(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid-2">
                <div className="field-row">
                  <label>Phage</label>
                  <select
                    value={row.phageId}
                    onChange={(event) =>
                      setComponents((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, phageId: event.target.value } : item
                        )
                      )
                    }
                  >
                    <option value="">Select phage</option>
                    {phages.map((phage) => (
                      <option key={phage.id} value={phage.id}>
                        {phage.name}
                        {phage.genomeAccession ? ` (${phage.genomeAccession})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-row">
                  <label>Timing role</label>
                  <select
                    value={row.timingRole}
                    onChange={(event) =>
                      setComponents((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                timingRole: event.target.value as ComponentRow["timingRole"]
                              }
                            : item
                        )
                      )
                    }
                  >
                    <option value="unknown">Unknown</option>
                    <option value="early">Early</option>
                    <option value="semi_early">Semi-early</option>
                    <option value="late">Late</option>
                  </select>
                </div>
                <div className="field-row">
                  <label>Ratio</label>
                  <input
                    value={row.ratio}
                    onChange={(event) =>
                      setComponents((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, ratio: event.target.value } : item
                        )
                      )
                    }
                    placeholder="1"
                  />
                </div>
                <div className="field-row">
                  <label>Dose PFU</label>
                  <input
                    value={row.dosePfu}
                    onChange={(event) =>
                      setComponents((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, dosePfu: event.target.value } : item
                        )
                      )
                    }
                    placeholder="1e8"
                  />
                </div>
              </div>
              <div className="field-row">
                <label>Component notes</label>
                <textarea
                  value={row.componentNotes}
                  onChange={(event) =>
                    setComponents((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, componentNotes: event.target.value }
                          : item
                      )
                    )
                  }
                  rows={2}
                  placeholder="Optional notes for this phage component"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-body stack" style={{ gap: "0.8rem" }}>
          <div className="split">
            <h2 className="section-title">Experiment Context</h2>
            <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={includeExperiment}
                onChange={(event) => setIncludeExperiment(event.target.checked)}
              />
              Include assay/experiment details
            </label>
          </div>

          {includeExperiment && (
            <>
              <div className="grid-2">
                <div className="field-row">
                  <label>Assay type</label>
                  <select
                    value={assayType}
                    onChange={(event) =>
                      setAssayType(
                        event.target.value as
                          | "spot"
                          | "plaque"
                          | "EOP"
                          | "kill_curve"
                          | "biofilm"
                          | "in_vivo"
                          | "other"
                      )
                    }
                  >
                    <option value="kill_curve">Kill curve</option>
                    <option value="spot">Spot</option>
                    <option value="plaque">Plaque</option>
                    <option value="EOP">EOP</option>
                    <option value="biofilm">Biofilm</option>
                    <option value="in_vivo">In vivo</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field-row">
                  <label>Protocol reference</label>
                  <input
                    value={protocolRef}
                    onChange={(event) => setProtocolRef(event.target.value)}
                    placeholder="DOI, internal SOP, URL..."
                  />
                </div>
                <div className="field-row">
                  <label>Lab</label>
                  <input value={lab} onChange={(event) => setLab(event.target.value)} />
                </div>
                <div className="field-row">
                  <label>Operator</label>
                  <input
                    value={operator}
                    onChange={(event) => setOperator(event.target.value)}
                    placeholder="initials or name"
                  />
                </div>
                <div className="field-row">
                  <label>Experiment date</label>
                  <input
                    type="date"
                    value={experimentDate}
                    onChange={(event) => setExperimentDate(event.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>Raw data URI</label>
                  <input
                    value={rawDataUri}
                    onChange={(event) => setRawDataUri(event.target.value)}
                    placeholder="Storage link to raw CSV"
                  />
                </div>
              </div>
              <div className="grid-2">
                <div className="field-row">
                  <label>Readout schema (JSON object)</label>
                  <textarea
                    value={readoutSchemaJson}
                    onChange={(event) => setReadoutSchemaJson(event.target.value)}
                    rows={4}
                  />
                </div>
                <div className="field-row">
                  <label>QC flags (JSON object)</label>
                  <textarea
                    value={qcFlagsJson}
                    onChange={(event) => setQcFlagsJson(event.target.value)}
                    rows={4}
                  />
                </div>
              </div>
              <div className="field-row">
                <label>Conditions (JSON object)</label>
                <textarea
                  value={conditionsJson}
                  onChange={(event) => setConditionsJson(event.target.value)}
                  rows={4}
                  placeholder='{"media":"TSB","temp_c":37,"moi":0.1,"timepoints_h":[0,4,8,24]}'
                />
              </div>
            </>
          )}
        </div>
      </section>

      {includeExperiment && (
        <section className="card">
          <div className="card-body stack" style={{ gap: "0.8rem" }}>
            <div className="split">
              <h2 className="section-title">Result Rows</h2>
              <button className="btn-link btn-muted" type="button" onClick={addResult}>
                Add result row
              </button>
            </div>
            {results.map((row, index) => (
              <div key={`result-${index}`} className="card card-body stack" style={{ gap: "0.6rem" }}>
                <div className="split">
                  <strong>Result {index + 1}</strong>
                  {results.length > 1 && (
                    <button
                      className="btn-link btn-danger"
                      type="button"
                      onClick={() => removeResult(index)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid-2">
                  <div className="field-row">
                    <label>Strain species</label>
                    <input
                      value={row.strainSpecies}
                      onChange={(event) =>
                        setResults((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, strainSpecies: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Staphylococcus aureus"
                    />
                  </div>
                  <div className="field-row">
                    <label>Strain name</label>
                    <input
                      value={row.strainName}
                      onChange={(event) =>
                        setResults((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, strainName: event.target.value } : item
                          )
                        )
                      }
                    />
                  </div>
                  <div className="field-row">
                    <label>Strain identifier</label>
                    <input
                      value={row.strainIdentifier}
                      onChange={(event) =>
                        setResults((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, strainIdentifier: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="ATCC_43300"
                    />
                  </div>
                  <div className="field-row">
                    <label>Resistance emerged</label>
                    <select
                      value={row.resistanceEmerged}
                      onChange={(event) =>
                        setResults((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  resistanceEmerged: event.target.value as
                                    | ""
                                    | "true"
                                    | "false"
                                }
                              : item
                          )
                        )
                      }
                    >
                      <option value="">Unknown</option>
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                  <div className="field-row">
                    <label>Observed synergy</label>
                    <input
                      value={row.observedSynergy}
                      onChange={(event) =>
                        setResults((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, observedSynergy: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Optional numeric value"
                    />
                  </div>
                </div>
                <div className="field-row">
                  <label>Outcome metrics (JSON object)</label>
                  <textarea
                    rows={3}
                    value={row.outcomeMetricsJson}
                    onChange={(event) =>
                      setResults((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, outcomeMetricsJson: event.target.value }
                            : item
                        )
                      )
                    }
                    placeholder='{"log_reduction_24h":2.6,"time_to_regrowth_h":48}'
                  />
                </div>
                <div className="field-row">
                  <label>Notes</label>
                  <textarea
                    rows={2}
                    value={row.notes}
                    onChange={(event) =>
                      setResults((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, notes: event.target.value } : item
                        )
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-body stack" style={{ gap: "0.75rem" }}>
          <div className="split">
            <button className="btn-link" disabled={!canSubmit || state.status === "loading"} type="submit">
              {state.status === "loading" ? "Saving..." : "Save cocktail record"}
            </button>
            <Link href="/cocktails" className="btn-link btn-muted">
              Cancel
            </Link>
          </div>

          {state.status === "error" && (
            <p className="pill" data-tone="warn">
              {state.message}
            </p>
          )}

          {state.status === "success" && (
            <div className="card card-body stack" style={{ gap: "0.35rem" }}>
              <strong>Saved</strong>
              <span className="muted">
                {state.cocktailName} saved with {state.componentCount} components and{" "}
                {state.resultCount} results.
              </span>
              <Link href={`/cocktails/${state.cocktailId}`} style={{ color: "var(--accent)" }}>
                Open saved cocktail
              </Link>
            </div>
          )}
        </div>
      </section>
    </form>
  );
}
