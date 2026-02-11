"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PaperQueueRow, PaperReviewQueueResult } from "@/types/paper";

type PublishedOutcome = {
  publishLinkId: string;
  cocktailId: string | null;
  cocktailName: string;
  pathogen: string;
  assayType: string;
  outcomeMetrics: Record<string, unknown>;
  resistanceEmerged: boolean | null;
  evidenceLocation: string | null;
  citation: {
    title: string | null;
    doi: string | null;
    url: string | null;
    year: number | null;
  };
};

type Props = {
  initialQueue: PaperQueueRow[];
  initialReview: PaperReviewQueueResult[];
  initialPublished: PublishedOutcome[];
};

type Panel = "queue" | "review" | "published";

function toMetricPreview(metrics: Record<string, unknown>): string {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return "No metrics";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ");
}

export function PapersConsole({ initialQueue, initialReview, initialPublished }: Props) {
  const [panel, setPanel] = useState<Panel>("queue");
  const [queue, setQueue] = useState(initialQueue);
  const [review, setReview] = useState(initialReview);
  const [published, setPublished] = useState(initialPublished);
  const [term, setTerm] = useState(
    '"phage cocktail" AND (staphylococcus OR "S. aureus") AND ("kill curve" OR biofilm OR CFU OR "log reduction")'
  );
  const [token, setToken] = useState("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function refreshAll() {
    const authHeader = token.trim() ? { "x-upload-token": token.trim() } : undefined;
    const [queueRes, reviewRes, publishedRes] = await Promise.all([
      fetch("/api/papers/queue", { cache: "no-store", headers: authHeader }),
      fetch("/api/curation/papers?status=pending_review", {
        cache: "no-store",
        headers: authHeader
      }),
      fetch("/api/papers/published-outcomes?pathogen=S_aureus", { cache: "no-store" })
    ]);

    if (queueRes.ok) {
      const payload = (await queueRes.json()) as { papers?: PaperQueueRow[] };
      setQueue(payload.papers ?? []);
    }
    if (reviewRes.ok) {
      const payload = (await reviewRes.json()) as { queue?: PaperReviewQueueResult[] };
      setReview(payload.queue ?? []);
    } else {
      setReview([]);
    }
    if (publishedRes.ok) {
      const payload = (await publishedRes.json()) as { results?: PublishedOutcome[] };
      setPublished(payload.results ?? []);
    }
  }

  useEffect(() => {
    if (!token.trim()) return;
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function runSearch() {
    setBusyKey("search");
    setStatusMessage("Running paper search...");
    try {
      const response = await fetch("/api/ingest/papers/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token.trim() ? { "x-upload-token": token.trim() } : {})
        },
        body: JSON.stringify({
          term,
          maxResults: 25,
          pathogenFocus: "S_aureus"
        })
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Paper search failed.");
      }
      setStatusMessage(
        `Search complete: discovered ${String(payload.discovered ?? 0)}, inserted ${String(payload.inserted ?? 0)}`
      );
      await refreshAll();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function postAction(url: string, body: Record<string, unknown>, key: string) {
    setBusyKey(key);
    setStatusMessage("Processing...");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token.trim() ? { "x-upload-token": token.trim() } : {})
        },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Action failed.");
      }
      setStatusMessage("Action completed.");
      await refreshAll();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusyKey(null);
    }
  }

  const queueView = (
    <div className="stack" style={{ gap: "0.7rem" }}>
        <div className="grid-2">
          <div className="field-row">
            <label htmlFor="search_term">PubMed query</label>
            <input
              id="search_term"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          <div className="field-row">
            <label htmlFor="token">Curator token (if configured)</label>
            <input id="token" value={token} onChange={(event) => setToken(event.target.value)} />
          </div>
        </div>
        <div className="split">
          <button className="btn-link" onClick={runSearch} disabled={busyKey !== null}>
            {busyKey === "search" ? "Searching..." : "Search OA papers"}
          </button>
          <span className="muted">Queue: {queue.length}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Paper</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No papers in queue.
                </td>
              </tr>
            )}
            {queue.map((paper) => (
              <tr key={paper.id}>
                <td>
                  <div className="stack" style={{ gap: "0.2rem" }}>
                    <strong>{paper.title}</strong>
                    <span className="muted" style={{ fontSize: "0.84rem" }}>
                      {paper.journal ?? "Journal unknown"} {paper.year ? `(${paper.year})` : ""}
                    </span>
                  </div>
                </td>
                <td>
                  <span className="pill">{paper.ingestStatus}</span>
                </td>
                <td>
                  <div className="stack" style={{ gridAutoFlow: "column", gap: "0.35rem" }}>
                    <button
                      className="btn-link btn-muted"
                      disabled={busyKey !== null}
                      onClick={() =>
                        postAction(`/api/ingest/papers/${paper.id}/fetch`, {}, `fetch-${paper.id}`)
                      }
                    >
                      Fetch
                    </button>
                    <button
                      className="btn-link btn-muted"
                      disabled={busyKey !== null}
                      onClick={() =>
                        postAction(`/api/ingest/papers/${paper.id}/extract`, {}, `extract-${paper.id}`)
                      }
                    >
                      Extract
                    </button>
                    {paper.url && (
                      <a className="btn-link btn-muted" href={paper.url} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );

  const reviewView = (
    <div className="stack" style={{ gap: "0.7rem" }}>
        <div className="split">
          <span className="muted">Pending extractions: {review.length}</span>
        </div>
        {review.length === 0 && <p className="muted">No pending extraction rows.</p>}
        {review.map((item) => (
          <article key={item.extractionId} className="card card-body stack" style={{ gap: "0.6rem" }}>
            <div className="split">
              <div className="stack" style={{ gap: "0.15rem" }}>
                <strong>{item.paper.title}</strong>
                <span className="muted" style={{ fontSize: "0.84rem" }}>
                  Confidence {item.extraction.confidence.toFixed(3)} | {item.extraction.extractorVersion}
                </span>
              </div>
              <span className="pill">{item.extraction.status}</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Assay</th>
                  <th>Host</th>
                  <th>Phages</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {item.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.assayType ?? "unknown"}</td>
                    <td>
                      {row.hostSpecies ?? "unknown"}
                      {row.hostStrainRaw ? ` (${row.hostStrainRaw})` : ""}
                    </td>
                    <td>{row.phageNames.join(", ") || "none"}</td>
                    <td>{toMetricPreview(row.outcomeMetrics)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="split">
              <button
                className="btn-link"
                disabled={busyKey !== null}
                onClick={() =>
                  postAction(
                    `/api/curation/papers/${item.extractionId}/approve`,
                    { reviewer: "curator" },
                    `approve-${item.extractionId}`
                  )
                }
              >
                Approve + publish
              </button>
              <button
                className="btn-link btn-danger"
                disabled={busyKey !== null}
                onClick={() =>
                  postAction(
                    `/api/curation/papers/${item.extractionId}/reject`,
                    {
                      reviewer: "curator",
                      reason: "Insufficient structured extraction confidence for publication."
                    },
                    `reject-${item.extractionId}`
                  )
                }
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
  );

  const publishedView = (
    <div className="stack" style={{ gap: "0.7rem" }}>
        <div className="split">
          <span className="muted">Published outcomes: {published.length}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Cocktail</th>
              <th>Assay</th>
              <th>Outcome</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {published.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No published outcomes yet.
                </td>
              </tr>
            )}
            {published.map((row) => (
              <tr key={row.publishLinkId}>
                <td>
                  {row.cocktailId ? (
                    <Link href={`/cocktails/${row.cocktailId}`} style={{ color: "var(--accent)" }}>
                      {row.cocktailName}
                    </Link>
                  ) : (
                    row.cocktailName
                  )}
                </td>
                <td>{row.assayType}</td>
                <td>{toMetricPreview(row.outcomeMetrics)}</td>
                <td>
                  {row.citation.url ? (
                    <a href={row.citation.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                      {row.evidenceLocation ?? "paper"}
                    </a>
                  ) : (
                    row.evidenceLocation ?? "paper"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );

  return (
    <section className="card">
      <div className="card-body stack" style={{ gap: "0.8rem" }}>
        <div className="split">
          <div className="stack" style={{ gridAutoFlow: "column", gap: "0.45rem" }}>
            <button
              className={`btn-link ${panel === "queue" ? "" : "btn-muted"}`}
              onClick={() => setPanel("queue")}
            >
              Queue
            </button>
            <button
              className={`btn-link ${panel === "review" ? "" : "btn-muted"}`}
              onClick={() => setPanel("review")}
            >
              Extraction Review
            </button>
            <button
              className={`btn-link ${panel === "published" ? "" : "btn-muted"}`}
              onClick={() => setPanel("published")}
            >
              Published Outcomes
            </button>
          </div>
          <button className="btn-link btn-muted" onClick={refreshAll} disabled={busyKey !== null}>
            Refresh
          </button>
        </div>
        {statusMessage && <span className="muted">{statusMessage}</span>}
        {panel === "queue" && queueView}
        {panel === "review" && reviewView}
        {panel === "published" && publishedView}
      </div>
    </section>
  );
}
