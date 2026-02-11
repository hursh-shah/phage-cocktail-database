"use client";

import { useState } from "react";

type UploadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      totalRows: number;
      validRows: number;
      insertedRows: number;
      skippedRows: number;
      warnings: string[];
    };

export function GeneticDistanceForm() {
  const [delimiter, setDelimiter] = useState<"" | "csv" | "tsv">("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setState({ status: "error", message: "Choose a CSV/TSV file first." });
      return;
    }

    const payload = new FormData();
    payload.append("file", file);
    if (delimiter) payload.append("delimiter", delimiter);
    setState({ status: "loading" });

    const response = await fetch("/api/ingest/genetic-relatedness", {
      method: "POST",
      headers: token.trim() ? { "x-upload-token": token.trim() } : undefined,
      body: payload
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      setState({
        status: "error",
        message:
          typeof json.error === "string"
            ? json.error
            : "Genetic distance upload failed."
      });
      return;
    }

    setState({
      status: "success",
      totalRows: Number(json.totalRows ?? 0),
      validRows: Number(json.validRows ?? 0),
      insertedRows: Number(json.insertedRows ?? 0),
      skippedRows: Number(json.skippedRows ?? 0),
      warnings: Array.isArray(json.warnings)
        ? json.warnings.map((item) => String(item))
        : []
    });
  }

  return (
    <form className="card card-body stack" onSubmit={onSubmit} style={{ gap: "0.8rem" }}>
      <h2 className="section-title" style={{ marginBottom: 0 }}>
        Upload Genetic Relatedness
      </h2>
      <div className="field-row">
        <label htmlFor="genetic_file">Distance file</label>
        <input
          id="genetic_file"
          name="file"
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
        />
      </div>
      <div className="grid-2">
        <div className="field-row">
          <label htmlFor="genetic_delimiter">Delimiter</label>
          <select
            id="genetic_delimiter"
            value={delimiter}
            onChange={(event) => setDelimiter(event.target.value as "" | "csv" | "tsv")}
          >
            <option value="">Auto detect</option>
            <option value="csv">CSV</option>
            <option value="tsv">TSV</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="genetic_token">Upload token (if configured)</label>
          <input
            id="genetic_token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
      </div>

      <button className="btn-link" type="submit" disabled={state.status === "loading"}>
        {state.status === "loading" ? "Uploading..." : "Upload distances"}
      </button>

      {state.status === "error" && (
        <p className="pill" data-tone="warn">
          {state.message}
        </p>
      )}

      {state.status === "success" && (
        <div className="stack">
          <span className="muted">
            Total: {state.totalRows} | Valid: {state.validRows} | Inserted: {state.insertedRows} |
            Skipped: {state.skippedRows}
          </span>
          {state.warnings.slice(0, 6).map((warning) => (
            <span key={warning} className="muted">
              {warning}
            </span>
          ))}
        </div>
      )}
    </form>
  );
}
