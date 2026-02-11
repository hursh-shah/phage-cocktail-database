# Phage Cocktail Database

Paper-first, cocktail-focused Next.js + Supabase app for S. aureus outcome curation.

## What Is Implemented

- Cocktail-first schema and APIs
- Curator write flow for cocktails and results
- TSV/CSV metadata ingestion for `phages`
- Paper ingestion pipeline (staged review):
  - OA PubMed search queue
  - PMCID full-text fetch
  - Gemini-only extraction with grounding checks
  - curator approve/reject publish
- Research endpoints for lab questions
- `/papers` concise 3-panel curation console

## Environment Variables

Copy `.env.example` to `.env.local` and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPLOAD_API_TOKEN` (recommended in all non-local environments)
- `GEMINI_API_KEY` (required for paper extraction)
- `GEMINI_MODEL` (optional, default `gemini-3-flash-preview`)

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
  - `GET /api/cocktails?pathogen=S_aureus&assay=kill_curve`
  - `GET /api/cocktails/:id`
  - `GET /api/cocktails/:id/outcomes`
  - `GET /api/cocktails/:id/genetic_distance_summary`
  - `GET /api/cocktails/:id/kinetics_profile`
  - `GET /api/phages`
  - `GET /api/phages/:id`
  - `GET /api/phages/:id/host_range?include_evidence=true`
  - `GET /api/strains/:id/phenotypes`
  - `GET /api/strains/:id/mutations`
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

## Cron

Supabase Edge cron scaffold:

- `supabase/functions/paper_ingest_daily/index.ts`
- setup notes: `docs/operations/paper_ingest_cron.md`

## Local Development

1. `npm install`
2. `npm run dev`
3. open `http://localhost:3000`

## Scope Defaults (V1)

- Pathogen: `S_aureus`
- Assays: `kill_curve`, `biofilm`
- Source scope: OA PMCID papers + OA supplements
- Publish model: staged review only (no auto-publish)
- Analytics: descriptive/heuristic only
