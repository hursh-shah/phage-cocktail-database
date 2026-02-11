# Daily Paper Ingestion Cron (Supabase Edge)

This project includes `supabase/functions/paper_ingest_daily/index.ts` for daily ingestion.

## Required environment variables

- `APP_BASE_URL` (for example `https://your-app-domain.com`)
- `UPLOAD_API_TOKEN` (must match app server token)

## Suggested schedule

- Run once daily at a fixed UTC hour.
- Recommended: `02:30 UTC`.

## Function behavior

1. Calls `POST /api/ingest/papers/search` with the default S. aureus cocktail query.
2. Returns ingestion job summary (`discovered`, `inserted`, `deduped`).
3. Relies on in-app review flow to fetch/extract/approve rows before publication.
