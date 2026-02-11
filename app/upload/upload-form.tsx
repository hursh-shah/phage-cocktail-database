"use client";

import { useState } from "react";
import type { UploadIngestSummary } from "@/types/cocktail";

type UploadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; summary: UploadIngestSummary };

export function UploadForm() {
  const [sourceLabel, setSourceLabel] = useState("refseq_phage_metadata");
  const [delimiter, setDelimiter] = useState<"" | "csv" | "tsv">("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setState({ status: "error", message: "Choose a CSV or TSV file first." });
      return;
    }

    const payload = new FormData();
    payload.append("file", file);
    payload.append("source_label", sourceLabel);
    if (delimiter) payload.append("delimiter", delimiter);

    setState({ status: "loading" });
    const response = await fetch("/api/ingest/phage-metadata", {
      method: "POST",
      headers: token ? { "x-upload-token": token } : undefined,
      body: payload
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      setState({
        status: "error",
        message:
          typeof json.error === "string" ? json.error : "Upload failed unexpectedly."
      });
      return;
    }

    setState({
      status: "success",
      summary: json as UploadIngestSummary
    });
  }

  return (
    <form className="card card-body stack" onSubmit={onSubmit} style={{ gap: "0.8rem" }}>
      <div className="field-row">
        <label htmlFor="file">Metadata file</label>
        <input id="file" name="file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" />
      </div>

      <div className="grid-2">
        <div className="field-row">
          <label htmlFor="source_label">Source label</label>
          <input
            id="source_label"
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            placeholder="refseq_phage_metadata"
          />
        </div>
        <div className="field-row">
          <label htmlFor="delimiter">Delimiter (optional)</label>
          <select
            id="delimiter"
            value={delimiter}
            onChange={(event) => setDelimiter(event.target.value as "" | "csv" | "tsv")}
          >
            <option value="">Auto detect</option>
            <option value="tsv">TSV</option>
            <option value="csv">CSV</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <label htmlFor="upload_token">Upload token (if configured)</label>
        <input
          id="upload_token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Optional x-upload-token"
        />
      </div>

      <div className="split">
        <button className="btn-link" type="submit" disabled={state.status === "loading"}>
          {state.status === "loading" ? "Uploading..." : "Upload metadata"}
        </button>
      </div>

      {state.status === "error" && (
        <p className="pill" data-tone="warn">
          {state.message}
        </p>
      )}

      {state.status === "success" && (
        <div className="card card-body stack" style={{ gap: "0.45rem" }}>
          <strong>Import complete</strong>
          <span className="muted">
            {state.summary.upsertedRows} rows upserted from {state.summary.sourceFilename}
          </span>
          <span className="muted">
            Total rows: {state.summary.totalRows} • Valid rows: {state.summary.validRows} •
            Skipped rows: {state.summary.skippedRows}
          </span>
          {state.summary.sampleWarnings.length > 0 && (
            <div className="stack">
              {state.summary.sampleWarnings.map((warning) => (
                <span className="muted" key={warning}>
                  {warning}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
