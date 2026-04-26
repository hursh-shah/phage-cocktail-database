# Phage Cocktail Database

Paper-first, cocktail-focused Next.js + Supabase app for Stenotrophomonas cocktail design-factor curation.

## What Is Implemented

- Cocktail-first schema and APIs
- Curator write flow for cocktails and results
- TSV/CSV metadata ingestion for `phages`
- Paper ingestion pipeline (staged review):
  - Steno-first OA PubMed search queue
  - PMCID full-text fetch
  - Structured text supplement fetch for CSV/TSV/TXT assets
  - Gemini-only cocktail and design-factor extraction with grounding checks
  - curator approve/reject publish
- Research endpoints for lab questions
- Public supervised-ML dataset builder for host-range/cocktail feasibility work
- `/papers` concise 3-panel curation console

## Environment Variables

Copy `.env.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPLOAD_API_TOKEN` (recommended in all non-local environments)
- `GEMINI_API_KEY` (required for paper extraction)
- `GEMINI_MODEL` (optional, default `gemini-3.1-pro-preview`)

Mutation endpoints require `x-upload-token` when `UPLOAD_API_TOKEN` is set.

## Key Routes

- UI:
  - `/`
  - `/cocktails`
  - `/cocktails/new`
  - `/phages`
  - `/upload`
  - `/papers`
- Public APIs:
  - `GET /api/cocktails?pathogen=S_maltophilia&assay=kill_curve`
  - `GET /api/cocktails/:id`
  - `GET /api/cocktails/:id/outcomes`
  - `GET /api/cocktails/:id/genetic_distance_summary`
  - `GET /api/cocktails/:id/kinetics_profile`
  - `GET /api/phages`
  - `GET /api/phages/:id`
  - `GET /api/phages/:id/host_range?include_evidence=true`
  - `GET /api/strains/:id/phenotypes`
  - `GET /api/strains/:id/mutations`
  - `GET /api/research/factor-matrix?pathogen=S_maltophilia`
- Ingestion/Curation APIs:
  - `POST /api/ingest/phage-metadata`
  - `POST /api/ingest/genetic-relatedness`
  - `POST /api/ingest/papers/search`
  - `POST /api/ingest/papers/:paperId/fetch`
  - `POST /api/ingest/papers/:paperId/extract`
  - `GET /api/curation/papers?status=pending_review`
  - `PATCH /api/curation/papers/rows/:rowId`
  - `POST /api/curation/papers/:extractionId/approve`
  - `POST /api/curation/papers/:extractionId/reject`
- MCP-wrapper APIs:
  - `POST /api/tools/search-cocktail-evidence`
  - `POST /api/tools/suggest-cocktail`
  - `POST /api/tools/analyze-variable-importance`

## Database Migrations

- `database/migrations/0001_init_phage_dataset_schema.sql`
- `database/migrations/0002_harden_rls_and_fk_indexes.sql`
- `database/migrations/0003_cocktail_first_schema.sql`
- `database/migrations/0004_paper_ingestion_pipeline.sql`
- `database/migrations/0005_design_factor_extraction.sql`

## Cron

Supabase Edge cron scaffold:

- `supabase/functions/paper_ingest_daily/index.ts`
- setup notes: `docs/operations/paper_ingest_cron.md`

## Local Development

1. `npm install`
2. `npm run dev`
3. open `http://localhost:3000`

## Public ML Dataset

Run the public-data pipeline with:

```bash
npm run public-ml:data
```

It downloads machine-readable public assets, pulls published Steno factor rows from Supabase when `.env.local` is configured, builds canonical supervised rows, runs a baseline host-range model, and writes:

- `data/public_ml/processed/canonical_supervised_rows.csv`
- `data/public_ml/processed/model_results.json`
- `data/public_ml/processed/cocktail_scores.csv`
- `docs/research/public_ml_dataset_report.md`

## Scope Defaults (V1)

- Pathogen: `S_maltophilia`
- Assays: `host_range`, `EOP`, `kill_curve`, `biofilm`, `antibiotic_synergy`, `genetic_relatedness`, `receptor_resistance`
- Source scope: OA PMCID papers + OA supplements
- Publish model: staged review only (no auto-publish)
- Analytics: descriptive/heuristic only
