# RZ Gallery Media API

Cloudflare Worker for original-quality delivery and Mux ingestion.

## Required one-time setup

1. Authenticate: `npx wrangler login`
2. Create the bucket: `npx wrangler r2 bucket create rz-gallery-media`
3. Create an R2 API token and set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` as Worker secrets.
4. Set `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, and a strong `ADMIN_ACCESS_CODE` as Worker secrets.
5. Deploy with `npm run deploy`.

Never place these values in GitHub Pages or commit them to Git.

The browser uploads exact originals to signed R2 URLs. Mux ingests the R2 video copy for adaptive streaming and creates a highest-quality downloadable MP4. Original downloads continue to come from R2.

## Duplicate and orphan protection

- Uploads are addressed by a SHA-256 fingerprint within each gallery and media kind. Retrying the same file reuses the existing R2 object instead of storing a second copy.
- Mux creation checks both the gallery record and managed Mux asset metadata before creating an asset, so interrupted publish retries reuse the original asset.
- A daily maintenance audit removes only managed, unreferenced objects/assets older than seven days. It reads the complete gallery index twice before deletion and aborts on any gallery read/parse failure.
- A video asset for an interrupted publish is preserved when its R2 source is still present in a gallery but no Mux asset ID has been saved yet.
- Referenced media is never automatically deleted, even when two referenced entries appear to be duplicates.

An authenticated `POST /api/maintenance/audit` is dry-run by default. Add `?execute=true` to run the same conservative cleanup used by the scheduled job.
