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
