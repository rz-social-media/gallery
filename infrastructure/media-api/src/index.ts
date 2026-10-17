import { AwsClient } from "aws4fetch";
import { downloadZip } from "client-zip";

interface Env {
  MEDIA: R2Bucket;
  ALLOWED_ORIGIN: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  MUX_TOKEN_ID: string;
  MUX_TOKEN_SECRET: string;
  ADMIN_ACCESS_CODE: string;
}

const json = (data: unknown, status = 200, origin = "*") =>
  Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
const safeSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 80);
const safeName = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-140);
const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const basic = (id: string, secret: string) =>
  `Basic ${btoa(`${id}:${secret}`)}`;
const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function authorized(request: Request, env: Env) {
  return (
    request.headers.get("authorization") === `Bearer ${env.ADMIN_ACCESS_CODE}`
  );
}
function r2Client(env: Env) {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}
async function signedR2(
  env: Env,
  key: string,
  method: "GET" | "PUT",
  seconds: number,
) {
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(seconds));
  return (await r2Client(env).sign(url, { method, aws: { signQuery: true } }))
    .url;
}
async function mux(env: Env, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.mux.com/video/v1${path}`, {
    ...init,
    headers: {
      Authorization: basic(env.MUX_TOKEN_ID, env.MUX_TOKEN_SECRET),
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok)
    throw new Error(`Mux ${response.status}: ${await response.text()}`);
  return response.json() as Promise<any>;
}
async function deleteMuxAsset(env: Env, assetId: string) {
  const response = await fetch(
    `https://api.mux.com/video/v1/assets/${assetId}`,
    {
      method: "DELETE",
      headers: { Authorization: basic(env.MUX_TOKEN_ID, env.MUX_TOKEN_SECRET) },
    },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(`Mux ${response.status}: ${await response.text()}`);
}
async function deleteR2Prefix(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length)
      await bucket.delete(listed.objects.map(({ key }) => key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
async function loadAllGalleries(env: Env) {
  const galleries: Array<{ key: string; value: Record<string, any> }> = [];
  let cursor: string | undefined;
  do {
    const listed = await env.MEDIA.list({ prefix: "galleries/", cursor });
    for (const { key } of listed.objects) {
      const object = await env.MEDIA.get(key);
      if (!object) throw new Error(`Gallery record disappeared: ${key}`);
      galleries.push({ key, value: await object.json<Record<string, any>>() });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return galleries;
}
function galleryReferences(
  galleries: Array<{ key: string; value: Record<string, any> }>,
) {
  const r2 = new Set<string>();
  const muxAssets = new Set<string>();
  const videoSources = new Set<string>();
  const sourceWithReferencedAsset = new Set<string>();
  for (const { value: gallery } of galleries) {
    const slug = safeSlug(String(gallery.slug || ""));
    for (const field of ["computerCoverUrl", "phoneCoverUrl"]) {
      const value = gallery[field];
      if (typeof value !== "string") continue;
      try {
        const marker = "/media/";
        const pathname = new URL(value).pathname;
        const index = pathname.indexOf(marker);
        if (index >= 0)
          r2.add(decodeURIComponent(pathname.slice(index + marker.length)));
      } catch {
        // Invalid cover metadata is never treated as permission to delete.
      }
    }
    for (const item of Array.isArray(gallery.media) ? gallery.media : []) {
      for (const field of ["originalKey", "webKey", "posterKey"]) {
        const key = item[field];
        if (typeof key === "string" && key.startsWith("couples/")) r2.add(key);
      }
      for (const field of ["url", "posterUrl"]) {
        const value = item[field];
        if (typeof value !== "string") continue;
        try {
          const marker = "/media/";
          const pathname = new URL(value).pathname;
          const index = pathname.indexOf(marker);
          if (index >= 0) r2.add(decodeURIComponent(pathname.slice(index + marker.length)));
        } catch {
          // An invalid display URL is not enough evidence to delete anything.
        }
      }
      if (typeof item.assetId === "string") muxAssets.add(item.assetId);
      if (
        item.type === "video" &&
        slug &&
        typeof item.originalKey === "string"
      ) {
        const source = `${slug}\n${item.originalKey}`;
        videoSources.add(source);
        if (typeof item.assetId === "string")
          sourceWithReferencedAsset.add(source);
      }
    }
  }
  return { r2, muxAssets, videoSources, sourceWithReferencedAsset };
}
async function listMuxAssets(env: Env) {
  const assets: Record<string, any>[] = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await mux(env, `/assets?${query}`);
    if (!Array.isArray(page.data)) throw new Error("Invalid Mux asset list");
    assets.push(...page.data);
    cursor = typeof page.next_cursor === "string" ? page.next_cursor : "";
  } while (cursor);
  return assets;
}
function managedMuxSource(asset: Record<string, any>) {
  if (typeof asset.passthrough !== "string") return null;
  try {
    const value = JSON.parse(asset.passthrough);
    const slug = safeSlug(String(value.coupleSlug || ""));
    const originalKey = String(value.originalKey || "");
    if (!slug || !originalKey.startsWith(`couples/${slug}/video/`)) return null;
    return { slug, originalKey, key: `${slug}\n${originalKey}` };
  } catch {
    return null;
  }
}
async function findExistingMuxAsset(
  env: Env,
  slug: string,
  originalKey: string,
) {
  const galleryObject = await env.MEDIA.get(`galleries/${slug}.json`);
  if (galleryObject) {
    const gallery = await galleryObject.json<Record<string, any>>();
    const existing = (gallery.media || []).find(
      (item: Record<string, any>) =>
        item.type === "video" &&
        item.originalKey === originalKey &&
        typeof item.assetId === "string",
    );
    if (existing) return { id: existing.assetId, status: "existing" };
  }
  const assets = await listMuxAssets(env);
  const existing = assets.find((asset) => {
    const source = managedMuxSource(asset);
    return (
      source?.slug === slug &&
      source.originalKey === originalKey &&
      (asset.status === "preparing" || asset.status === "ready")
    );
  });
  return existing ? { id: existing.id, status: existing.status } : null;
}
async function auditStorage(env: Env, execute: boolean) {
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  const galleries = await loadAllGalleries(env);
  const refs = galleryReferences(galleries);
  const r2Candidates: string[] = [];
  let cursor: string | undefined;
  let scannedR2 = 0;
  do {
    const listed = await env.MEDIA.list({ prefix: "couples/", cursor });
    scannedR2 += listed.objects.length;
    for (const object of listed.objects) {
      if (!refs.r2.has(object.key) && object.uploaded.getTime() < cutoff)
        r2Candidates.push(object.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  const muxAssets = await listMuxAssets(env);
  const muxCandidates = muxAssets.filter((asset) => {
    const source = managedMuxSource(asset);
    if (!source || refs.muxAssets.has(asset.id)) return false;
    if (Number(asset.created_at || 0) * 1000 >= cutoff) return false;
    if (asset.status === "errored") return true;
    // If a gallery references the source but has no saved asset yet, this may
    // be a recoverable interrupted publish, so it must remain untouched.
    return (
      !refs.videoSources.has(source.key) ||
      refs.sourceWithReferencedAsset.has(source.key)
    );
  });

  const deletedR2: string[] = [];
  const deletedMux: string[] = [];
  if (execute && (r2Candidates.length || muxCandidates.length)) {
    // Re-read every gallery immediately before deletion. Any parse/read error
    // aborts the whole cleanup, and newly referenced media is protected.
    const latestRefs = galleryReferences(await loadAllGalleries(env));
    const safeR2 = r2Candidates.filter((key) => !latestRefs.r2.has(key));
    for (let index = 0; index < safeR2.length; index += 1000) {
      const batch = safeR2.slice(index, index + 1000);
      await env.MEDIA.delete(batch);
      deletedR2.push(...batch);
    }
    for (const asset of muxCandidates) {
      const source = managedMuxSource(asset);
      if (!source || latestRefs.muxAssets.has(asset.id)) continue;
      if (
        asset.status !== "errored" &&
        latestRefs.videoSources.has(source.key) &&
        !latestRefs.sourceWithReferencedAsset.has(source.key)
      )
        continue;
      await deleteMuxAsset(env, asset.id);
      deletedMux.push(asset.id);
    }
  }
  return {
    mode: execute ? "execute" : "dry-run",
    graceDays: ORPHAN_GRACE_MS / 86400000,
    galleries: galleries.length,
    scanned: { r2: scannedR2, mux: muxAssets.length },
    candidates: { r2: r2Candidates.length, mux: muxCandidates.length },
    deleted: { r2: deletedR2.length, mux: deletedMux.length },
  };
}
async function galleryArchive(
  env: Env,
  gallery: Record<string, any>,
  slug: string,
  selection: "all" | "photos" | "videos",
) {
  const media = (gallery.media || []).filter(
    (item: Record<string, any>) =>
      item.originalKey?.startsWith(`couples/${slug}/`) &&
      (selection === "all" ||
        (selection === "photos" && item.type === "photo") ||
        (selection === "videos" && item.type === "video")),
  );
  if (!media.length) return null;
  async function* files() {
    for (let index = 0; index < media.length; index++) {
      const item = media[index],
        object = await env.MEDIA.get(item.originalKey);
      if (!object?.body) continue;
      const folder = item.type === "photo" ? "Photos" : "Films";
      yield {
        name: `${folder}/${String(index + 1).padStart(3, "0")}-${safeName(item.filename || `${item.type}-${index + 1}`)}`,
        input: object.body,
        lastModified: object.uploaded,
      };
    }
  }
  const archive = downloadZip(files()),
    headers = new Headers(archive.headers),
    suffix = selection === "all" ? "gallery" : selection;
  headers.set(
    "Content-Disposition",
    `attachment; filename="${slug}-${suffix}.zip"`,
  );
  headers.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN);
  headers.set("Cache-Control", "private,no-store");
  return new Response(archive.body, { status: 200, headers });
}
function publicGalleryUrl(slug: string) {
  return `https://rz-social-media.github.io/gallery/couple/?id=${encodeURIComponent(slug)}`;
}
function galleryCover(gallery: Record<string, any>) {
  return (
    gallery.computerCoverUrl ||
    gallery.phoneCoverUrl ||
    (gallery.media || []).find((item: Record<string, any>) => item.type === "photo" && item.url)?.url ||
    (gallery.media || []).find((item: Record<string, any>) => item.type === "video" && item.posterUrl)?.posterUrl ||
    ""
  );
}
function sharePage(gallery: Record<string, any>, slug: string) {
  const names = `${gallery.partnerOne || ""} & ${gallery.partnerTwo || ""}`;
  const details = [gallery.weddingDate, gallery.location].filter(Boolean).join(" · ");
  const destination = publicGalleryUrl(slug);
  const cover = galleryCover(gallery);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(names)} | RZ Weddings</title><meta name="description" content="${escapeHtml(details)}"><meta property="og:type" content="website"><meta property="og:site_name" content="RZ Weddings"><meta property="og:title" content="${escapeHtml(names)}"><meta property="og:description" content="${escapeHtml(details)}"><meta property="og:url" content="${escapeHtml(new URL(`/share/${slug}`, "https://rz-gallery-media-api.galfadlon2.workers.dev").href)}">${cover ? `<meta property="og:image" content="${escapeHtml(cover)}"><meta property="og:image:alt" content="${escapeHtml(`${names} wedding gallery`)}">` : ""}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(names)}"><meta name="twitter:description" content="${escapeHtml(details)}">${cover ? `<meta name="twitter:image" content="${escapeHtml(cover)}">` : ""}<link rel="canonical" href="${escapeHtml(destination)}"><script>location.replace(${JSON.stringify(destination)})</script></head><body><p><a href="${escapeHtml(destination)}">Open ${escapeHtml(names)}’s gallery</a></p></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public,max-age=300,s-maxage=300",
      },
    },
  );
}
function mobileDownloadsPage(
  gallery: Record<string, any>,
  slug: string,
  selection: "all" | "photos" | "videos",
) {
  const media = (gallery.media || []).filter(
    (item: Record<string, any>) =>
      item.originalKey?.startsWith(`couples/${slug}/`) &&
      (selection === "all" ||
        (selection === "photos" && item.type === "photo") ||
        (selection === "videos" && item.type === "video")),
  );
  const names = `${gallery.partnerOne || ""} & ${gallery.partnerTwo || ""}`;
  const rows = media
    .map((item: Record<string, any>, index: number) => {
      const name = safeName(item.filename || `${item.type}-${index + 1}`);
      const href = `/api/download?key=${encodeURIComponent(item.originalKey)}&name=${encodeURIComponent(name)}`;
      const preview = item.type === "photo" ? item.url : item.posterUrl;
      return `<li>${preview ? `<img src="${escapeHtml(preview)}" alt="">` : ""}<div><strong>${escapeHtml(name)}</strong><small>${item.type === "photo" ? "Photograph" : "Film"}</small></div><a href="${escapeHtml(href)}">Download ↓</a></li>`;
    })
    .join("");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Downloads | ${escapeHtml(names)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f3eee7;color:#271f19;font-family:Arial,sans-serif}main{width:min(720px,100%);margin:auto;padding:28px 18px 60px}small{color:#7e7064;text-transform:uppercase;letter-spacing:.14em;font-size:10px}h1{font-family:Georgia,serif;font-size:42px;font-weight:400;margin:8px 0}p{color:#74695f;line-height:1.5}ul{padding:0;margin:28px 0;display:grid;gap:9px}li{list-style:none;display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;padding:9px;background:#fffdf8;border:1px solid #ded4c8}img{width:64px;height:64px;object-fit:cover}strong{display:block;max-width:34vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}li small{display:block;margin-top:5px}a{padding:11px 12px;background:#2e251f;color:white;text-decoration:none;font-size:12px}nav a{display:inline-block;background:transparent;color:#4d4037;padding:0;margin-bottom:20px}@media(max-width:430px){h1{font-size:36px}li{grid-template-columns:54px 1fr auto}img{width:54px;height:54px}li a{padding:10px 8px;font-size:11px}}</style></head><body><main><nav><a href="${escapeHtml(publicGalleryUrl(slug))}">← Back to gallery</a></nav><small>Original files</small><h1>${escapeHtml(names)}</h1><p>Tap Download beside each item. On iPhone, Safari saves it to the Downloads folder in the Files app.</p><ul>${rows}</ul></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url),
      origin = env.ALLOWED_ORIGIN;
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "authorization, content-type",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        },
      });
    try {
      if (url.pathname === "/api/health")
        return json({ ok: true }, 200, origin);
      const shareMatch = url.pathname.match(/^\/share\/([^/]+)$/);
      if (shareMatch && request.method === "GET") {
        const slug = safeSlug(shareMatch[1]);
        const object = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!object) return new Response("Gallery not found", { status: 404 });
        const gallery = await object.json<Record<string, any>>();
        if (!gallery.published)
          return new Response("Gallery not found", { status: 404 });
        return sharePage(gallery, slug);
      }
      if (url.pathname === "/api/uploads" && request.method === "POST") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const body = await request.json<{
          coupleSlug: string;
          filename: string;
          contentType: string;
          kind: "photo" | "photo-web" | "video" | "video-poster";
          sha256: string;
        }>();
        const slug = safeSlug(body.coupleSlug),
          filename = safeName(body.filename),
          sha256 = String(body.sha256 || "").toLowerCase();
        if (!slug || !filename || !/^[a-f0-9]{64}$/.test(sha256))
          return json({ error: "Invalid upload" }, 400, origin);
        const key = `couples/${slug}/${body.kind}/${sha256}`;
        const existing = await env.MEDIA.head(key);
        return json(
          {
            key,
            exists: Boolean(existing),
            uploadUrl: existing
              ? null
              : await signedR2(env, key, "PUT", 3600),
            contentType: body.contentType,
          },
          200,
          origin,
        );
      }
      if (url.pathname === "/api/videos" && request.method === "POST") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const body = await request.json<{
          originalKey: string;
          title: string;
          coupleSlug: string;
        }>();
        if (
          !body.originalKey.startsWith(
            `couples/${safeSlug(body.coupleSlug)}/video/`,
          )
        )
          return json({ error: "Invalid source" }, 400, origin);
        const slug = safeSlug(body.coupleSlug);
        const existing = await findExistingMuxAsset(
          env,
          slug,
          body.originalKey,
        );
        if (existing)
          return json(
            { assetId: existing.id, status: existing.status, reused: true },
            200,
            origin,
          );
        const inputUrl = await signedR2(env, body.originalKey, "GET", 86400);
        const result = await mux(env, "/assets", {
          method: "POST",
          body: JSON.stringify({
            inputs: [{ url: inputUrl }],
            playback_policies: ["public"],
            video_quality: "plus",
            max_resolution_tier: "2160p",
            static_renditions: [{ resolution: "highest" }],
            passthrough: JSON.stringify({
              managedBy: "rz-gallery-v1",
              coupleSlug: slug,
              originalKey: body.originalKey,
              title: body.title,
            }),
          }),
        });
        return json(
          { assetId: result.data.id, status: result.data.status },
          201,
          origin,
        );
      }
      if (
        url.pathname === "/api/maintenance/audit" &&
        request.method === "POST"
      ) {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        return json(
          await auditStorage(env, url.searchParams.get("execute") === "true"),
          200,
          origin,
        );
      }
      if (url.pathname.startsWith("/api/videos/") && request.method === "GET") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const id = url.pathname.split("/").pop();
        const result = await mux(env, `/assets/${id}`);
        const asset = result.data;
        return json(
          {
            assetId: asset.id,
            status: asset.status,
            progressState: asset.progress?.state || null,
            progressPercentage:
              typeof asset.progress?.percentage === "number"
                ? asset.progress.percentage
                : null,
            playbackId: asset.playback_ids?.[0]?.id || null,
            downloadReady:
              asset.static_renditions?.files?.some(
                (x: any) => x.resolution === "highest" && x.status === "ready",
              ) || false,
          },
          200,
          origin,
        );
      }
      if (url.pathname === "/api/galleries" && request.method === "GET") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const listed = await env.MEDIA.list({ prefix: "galleries/" });
        const galleries = await Promise.all(
          listed.objects.map(async ({ key }) => {
            const object = await env.MEDIA.get(key);
            return object ? object.json() : null;
          }),
        );
        return json(galleries.filter(Boolean), 200, origin);
      }
      const archiveMatch = url.pathname.match(
        /^\/api\/galleries\/([^/]+)\/download$/,
      );
      if (archiveMatch && request.method === "GET") {
        const slug = safeSlug(archiveMatch[1]),
          selection = url.searchParams.get("type") || "all";
        if (!["all", "photos", "videos"].includes(selection))
          return json({ error: "Invalid download type" }, 400, origin);
        const object = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!object) return json({ error: "Gallery not found" }, 404, origin);
        const gallery = await object.json<Record<string, any>>();
        if (!gallery.published)
          return json({ error: "Gallery not found" }, 404, origin);
        const archive = await galleryArchive(
          env,
          gallery,
          slug,
          selection as "all" | "photos" | "videos",
        );
        return archive || json({ error: "No files to download" }, 404, origin);
      }
      const downloadsMatch = url.pathname.match(
        /^\/api\/galleries\/([^/]+)\/downloads$/,
      );
      if (downloadsMatch && request.method === "GET") {
        const slug = safeSlug(downloadsMatch[1]);
        const selection = url.searchParams.get("type") || "all";
        if (!["all", "photos", "videos"].includes(selection))
          return json({ error: "Invalid download type" }, 400, origin);
        const object = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!object) return new Response("Gallery not found", { status: 404 });
        const gallery = await object.json<Record<string, any>>();
        if (!gallery.published)
          return new Response("Gallery not found", { status: 404 });
        return mobileDownloadsPage(
          gallery,
          slug,
          selection as "all" | "photos" | "videos",
        );
      }
      if (
        url.pathname.startsWith("/api/galleries/") &&
        request.method === "GET"
      ) {
        const slug = safeSlug(url.pathname.split("/").pop() || "");
        const object = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!object) return json({ error: "Gallery not found" }, 404, origin);
        const gallery = await object.json<Record<string, any>>();
        if (!gallery.published && !authorized(request, env))
          return json({ error: "Gallery not found" }, 404, origin);
        return json(gallery, 200, origin);
      }
      if (
        url.pathname.startsWith("/api/galleries/") &&
        request.method === "POST"
      ) {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const slug = safeSlug(url.pathname.split("/").pop() || "");
        if (!slug) return json({ error: "Invalid slug" }, 400, origin);
        const gallery = await request.json<Record<string, any>>();
        gallery.slug = slug;
        gallery.updatedAt = new Date().toISOString();
        await env.MEDIA.put(`galleries/${slug}.json`, JSON.stringify(gallery), {
          httpMetadata: { contentType: "application/json" },
        });
        return json(gallery, 200, origin);
      }
      if (
        url.pathname.startsWith("/api/galleries/") &&
        request.method === "DELETE"
      ) {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const slug = safeSlug(url.pathname.split("/").pop() || "");
        if (!slug) return json({ error: "Invalid slug" }, 400, origin);
        const stored = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!stored) return json({ error: "Gallery not found" }, 404, origin);
        const gallery = await stored.json<{
          media?: Array<{ assetId?: string }>;
        }>();
        const assetIds = [
          ...new Set(
            (gallery.media || [])
              .map(({ assetId }) => assetId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        await Promise.all(assetIds.map((id) => deleteMuxAsset(env, id)));
        await deleteR2Prefix(env.MEDIA, `couples/${slug}/`);
        await env.MEDIA.delete(`galleries/${slug}.json`);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/api/download" && request.method === "GET") {
        const key = url.searchParams.get("key") || "";
        if (!key.startsWith("couples/"))
          return json({ error: "Invalid file" }, 400, origin);
        const object = await env.MEDIA.get(key);
        if (!object?.body) return json({ error: "File not found" }, 404, origin);
        const headers = new Headers({
          "Access-Control-Allow-Origin": origin,
          "Cache-Control": "private,no-store",
          "Content-Disposition": `attachment; filename="${safeName(url.searchParams.get("name") || key.split("/").pop() || "download")}"`,
          "Content-Length": String(object.size),
        });
        object.writeHttpMetadata(headers);
        headers.set(
          "Content-Disposition",
          `attachment; filename="${safeName(url.searchParams.get("name") || key.split("/").pop() || "download")}"`,
        );
        return new Response(object.body, { headers });
      }
      if (url.pathname.startsWith("/media/") && request.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(7));
        if (!key.includes("/photo-web/") && !key.includes("/video-poster/"))
          return new Response("Not found", { status: 404 });
        const object = await env.MEDIA.get(key);
        if (!object) return new Response("Not found", { status: 404 });
        const headers = new Headers({
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public,max-age=31536000,immutable",
          ETag: object.httpEtag,
        });
        object.writeHttpMetadata(headers);
        return new Response(object.body, { headers });
      }
      return json({ error: "Not found" }, 404, origin);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Unexpected error" },
        500,
        origin,
      );
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(auditStorage(env, true));
  },
} satisfies ExportedHandler<Env>;
