import { AwsClient } from "aws4fetch";
import { zipLength, zipStream, type ZipEntry } from "./zip";
import { renderDownloadsPage } from "./downloadsPage";

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
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
  selectedIds?: Set<string>,
  headOnly = false,
) {
  const media = (gallery.media || []).filter(
    (item: Record<string, any>) =>
      item.originalKey?.startsWith(`couples/${slug}/`) &&
      (!selectedIds?.size || selectedIds.has(String(item.id))) &&
      (selection === "all" ||
        (selection === "photos" && item.type === "photo") ||
        (selection === "videos" && item.type === "video")),
  );
  if (!media.length) return null;
  // Sizes and checksums stored at upload (measured from the real bytes) avoid a
  // storage lookup per file; only items missing them are checked, in parallel.
  const modified = new Date(gallery.updatedAt || Date.now());
  const resolved: (ZipEntry | null)[] = new Array(media.length).fill(null);
  const pending = media.map((item: Record<string, any>, index: number) => ({ item, index }));
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      const { item, index } = next;
      const known = typeof item.crc32 === "number" && typeof item.size === "number";
      const head = known ? null : await env.MEDIA.head(item.originalKey);
      if (!known && !head) continue;
      const folder = item.type === "photo" ? "Photos" : "Films";
      resolved[index] = {
        name: `${folder}/${String(index + 1).padStart(3, "0")}-${safeName(item.filename || `${item.type}-${index + 1}`)}`,
        size: known ? item.size : head!.size,
        crc32: known || (typeof item.crc32 === "number" && item.size === head!.size) ? item.crc32 : undefined,
        modified: head?.uploaded || modified,
        open: async () => (await env.MEDIA.get(item.originalKey))?.body ?? null,
      };
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));
  const entries = resolved.filter((entry): entry is ZipEntry => entry !== null);
  if (!entries.length) return null;
  const headers = new Headers({
      "Content-Type": "application/zip",
      "Content-Length": String(zipLength(entries)),
    }),
    suffix = selection === "all" ? "gallery" : selection;
  headers.set(
    "Content-Disposition",
    `attachment; filename="${slug}-${suffix}.zip"`,
  );
  headers.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN);
  headers.set("Cache-Control", "private,no-store");
  return new Response(headOnly ? null : zipStream(entries), { status: 200, headers });
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
  selectedIds?: Set<string>,
) {
  const media = (gallery.media || []).filter(
    (item: Record<string, any>) =>
      item.originalKey?.startsWith(`couples/${slug}/`) &&
      (!selectedIds?.size || selectedIds.has(String(item.id))) &&
      (selection === "all" ||
        (selection === "photos" && item.type === "photo") ||
        (selection === "videos" && item.type === "video")),
  );
  const names = `${gallery.partnerOne || ""} & ${gallery.partnerTwo || ""}`;
  const archiveHref = `/api/galleries/${encodeURIComponent(slug)}/download?type=${selection}${selectedIds?.size ? `&ids=${encodeURIComponent([...selectedIds].join(","))}` : ""}`;
  return new Response(
    renderDownloadsPage({
      names,
      galleryUrl: publicGalleryUrl(slug),
      archiveHref,
      media,
      safeName,
    }),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

async function permanentlyDeleteGallery(
  env: Env,
  slug: string,
  gallery: Record<string, any>,
) {
  const mediaItems: Record<string, any>[] = Array.isArray(gallery.media) ? gallery.media : [];
  const assetIds = [
    ...new Set<string>(
      mediaItems
        .map((item: Record<string, any>) => item.assetId)
        .filter((id: unknown): id is string => Boolean(id)),
    ),
  ];
  await Promise.all(assetIds.map((id) => deleteMuxAsset(env, id)));
  await deleteR2Prefix(env.MEDIA, `couples/${slug}/`);
  await env.MEDIA.delete(`galleries/${slug}.json`);
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
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        },
      });
    try {
      if (url.pathname === "/api/health")
        return json({ ok: true }, 200, origin);
      const analyticsMatch = url.pathname.match(/^\/api\/analytics\/([^/]+)$/);
      if (analyticsMatch && request.method === "POST") {
        const slug = safeSlug(analyticsMatch[1]);
        const galleryObject = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!galleryObject) return json({ error: "Gallery not found" }, 404, origin);
        const gallery = await galleryObject.json<Record<string, any>>();
        if (!gallery.published) return json({ error: "Gallery not found" }, 404, origin);
        const body: { type?: string } = await request.json<{ type?: string }>().catch(() => ({}));
        const type = ["view", "play", "download"].includes(body.type || "") ? body.type! : "view";
        await env.MEDIA.put(
          `analytics/${slug}/${type}/${Date.now()}-${crypto.randomUUID()}.json`,
          JSON.stringify({ at: new Date().toISOString() }),
          { httpMetadata: { contentType: "application/json" } },
        );
        return json({ ok: true }, 201, origin);
      }
      if (analyticsMatch && request.method === "GET") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const slug = safeSlug(analyticsMatch[1]);
        const counts: Record<string, number> = { view: 0, play: 0, download: 0 };
        for (const type of Object.keys(counts)) {
          let cursor: string | undefined;
          do {
            const listed = await env.MEDIA.list({ prefix: `analytics/${slug}/${type}/`, cursor });
            counts[type] += listed.objects.length;
            cursor = listed.truncated ? listed.cursor : undefined;
          } while (cursor);
        }
        return json(counts, 200, origin);
      }
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
      if (url.pathname === "/api/multipart/start" && request.method === "POST") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const body = await request.json<{
          coupleSlug: string;
          kind: "photo" | "photo-web" | "video" | "video-poster";
          contentType: string;
          sha256: string;
        }>();
        const slug = safeSlug(body.coupleSlug);
        const sha256 = String(body.sha256 || "").toLowerCase();
        if (!slug || !/^[a-f0-9]{64}$/.test(sha256))
          return json({ error: "Invalid upload" }, 400, origin);
        const key = `couples/${slug}/${body.kind}/${sha256}`;
        if (await env.MEDIA.head(key)) return json({ key, exists: true }, 200, origin);
        const upload = await env.MEDIA.createMultipartUpload(key, {
          httpMetadata: { contentType: body.contentType || "application/octet-stream" },
        });
        return json({ key, uploadId: upload.uploadId, exists: false }, 200, origin);
      }
      if (url.pathname === "/api/multipart/part" && request.method === "PUT") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const key = url.searchParams.get("key") || "";
        const uploadId = url.searchParams.get("uploadId") || "";
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (!key.startsWith("couples/") || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || !request.body)
          return json({ error: "Invalid multipart upload" }, 400, origin);
        const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
        const part = await upload.uploadPart(partNumber, request.body);
        return json({ partNumber: part.partNumber, etag: part.etag }, 200, origin);
      }
      if (url.pathname === "/api/multipart/complete" && request.method === "POST") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const body = await request.json<{
          key: string;
          uploadId: string;
          parts: R2UploadedPart[];
        }>();
        if (!body.key?.startsWith("couples/") || !body.uploadId || !Array.isArray(body.parts))
          return json({ error: "Invalid multipart upload" }, 400, origin);
        const upload = env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
        await upload.complete(body.parts.sort((a, b) => a.partNumber - b.partNumber));
        return json({ key: body.key }, 200, origin);
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
        return json(galleries.filter((gallery: any) => gallery && !gallery.deletedAt), 200, origin);
      }
      if (url.pathname === "/api/trash" && request.method === "GET") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const listed = await env.MEDIA.list({ prefix: "galleries/" });
        const galleries = await Promise.all(
          listed.objects.map(async ({ key }) => {
            const object = await env.MEDIA.get(key);
            return object ? object.json<Record<string, any>>() : null;
          }),
        );
        return json(galleries.filter((gallery) => gallery?.deletedAt), 200, origin);
      }
      const healthMatch = url.pathname.match(
        /^\/api\/galleries\/([^/]+)\/health$/,
      );
      if (healthMatch && request.method === "GET") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const slug = safeSlug(healthMatch[1]);
        const object = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!object) return json({ error: "Gallery not found" }, 404, origin);
        const gallery = await object.json<Record<string, any>>();
        const issues: string[] = [];
        if (!gallery.partnerOne || !gallery.partnerTwo) issues.push("Add both partner names");
        if (!gallery.weddingDate) issues.push("Add the wedding date");
        if (!gallery.location) issues.push("Add the wedding location");
        const media = Array.isArray(gallery.media) ? gallery.media : [];
        if (!media.length) issues.push("Add at least one photo or film");
        if (!gallery.computerCoverUrl && !media.some((item: any) => item.url || item.posterUrl))
          issues.push("Choose or upload a computer cover");
        if (!gallery.phoneCoverUrl && !media.some((item: any) => item.url || item.posterUrl))
          issues.push("Choose or upload a phone cover");
        const storageChecks = await Promise.all(
          media.map(async (item: any) => ({
            item,
            stored: Boolean(item.originalKey && (await env.MEDIA.head(item.originalKey))),
          })),
        );
        for (const { item, stored } of storageChecks) {
          if (!stored) issues.push(`${item.filename || "A file"} is missing from storage`);
          if (item.type === "photo" && !item.url)
            issues.push(`${item.filename || "A photo"} has no web preview`);
          if (item.type === "video" && !item.playbackId)
            issues.push(`${item.filename || "A film"} is still processing`);
        }
        const streamChecks = await Promise.all(
          media
            .filter((item: any) => item.type === "video" && item.playbackId)
            .map(async (item: any) => {
              try {
                const response = await fetch(`https://stream.mux.com/${item.playbackId}.m3u8`, { method: "GET" });
                return { item, ok: response.ok };
              } catch {
                return { item, ok: false };
              }
            }),
        );
        for (const { item, ok } of streamChecks)
          if (!ok) issues.push(`${item.filename || "A film"} is not streaming yet`);
        return json(
          {
            ok: issues.length === 0,
            issues,
            checks: {
              details: Boolean(gallery.partnerOne && gallery.partnerTwo && gallery.weddingDate && gallery.location),
              storage: storageChecks.every(({ stored }) => stored),
              streaming: streamChecks.every(({ ok }) => ok) && !media.some((item: any) => item.type === "video" && !item.playbackId),
              covers: Boolean((gallery.computerCoverUrl || media.some((item: any) => item.url || item.posterUrl)) && (gallery.phoneCoverUrl || media.some((item: any) => item.url || item.posterUrl))),
            },
          },
          issues.length ? 409 : 200,
          origin,
        );
      }
      const archiveMatch = url.pathname.match(
        /^\/api\/galleries\/([^/]+)\/download$/,
      );
      if (archiveMatch && (request.method === "GET" || request.method === "HEAD")) {
        const slug = safeSlug(archiveMatch[1]),
          selection = url.searchParams.get("type") || "all";
        if (!["all", "photos", "videos"].includes(selection))
          return json({ error: "Invalid download type" }, 400, origin);
        const object = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!object) return json({ error: "Gallery not found" }, 404, origin);
        const gallery = await object.json<Record<string, any>>();
        if (!gallery.published)
          return json({ error: "Gallery not found" }, 404, origin);
        const selectedIds = new Set(
          (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 500),
        );
        const archive = await galleryArchive(
          env,
          gallery,
          slug,
          selection as "all" | "photos" | "videos",
          selectedIds,
          request.method === "HEAD",
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
          new Set(
            (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 500),
          ),
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
        const previewToken = url.searchParams.get("preview");
        if (
          !gallery.published &&
          !authorized(request, env) &&
          (!previewToken || previewToken !== gallery.previewToken)
        )
          return json({ error: "Gallery not found" }, 404, origin);
        return json(gallery, 200, origin);
      }
      if (
        url.pathname.startsWith("/api/galleries/") &&
        !url.pathname.endsWith("/restore") &&
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
      const restoreMatch = url.pathname.match(/^\/api\/galleries\/([^/]+)\/restore$/);
      if (restoreMatch && request.method === "POST") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const slug = safeSlug(restoreMatch[1]);
        const stored = await env.MEDIA.get(`galleries/${slug}.json`);
        if (!stored) return json({ error: "Gallery not found" }, 404, origin);
        const gallery = await stored.json<Record<string, any>>();
        delete gallery.deletedAt;
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
        const gallery = await stored.json<Record<string, any>>();
        if (url.searchParams.get("permanent") === "true") {
          await permanentlyDeleteGallery(env, slug, gallery);
          return json({ ok: true, permanent: true }, 200, origin);
        }
        gallery.deletedAt = new Date().toISOString();
        gallery.published = false;
        await env.MEDIA.put(`galleries/${slug}.json`, JSON.stringify(gallery), {
          httpMetadata: { contentType: "application/json" },
        });
        return json({ ok: true, recoverableUntil: new Date(Date.now() + 30 * 86400000).toISOString() }, 200, origin);
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
    ctx.waitUntil((async () => {
      await auditStorage(env, true);
      const galleries = await loadAllGalleries(env);
      const cutoff = Date.now() - 30 * 86400000;
      for (const gallery of galleries) {
        if (gallery.value.deletedAt && Date.parse(gallery.value.deletedAt) < cutoff)
          await permanentlyDeleteGallery(env, safeSlug(gallery.value.slug), gallery.value);
      }
    })());
  },
} satisfies ExportedHandler<Env>;
