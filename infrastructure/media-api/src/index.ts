import { AwsClient } from "aws4fetch";

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
const basic = (id: string, secret: string) =>
  `Basic ${btoa(`${id}:${secret}`)}`;

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
  return response.json() as Promise<{ data: Record<string, any> }>;
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
      if (url.pathname === "/api/uploads" && request.method === "POST") {
        if (!authorized(request, env))
          return json({ error: "Unauthorized" }, 401, origin);
        const body = await request.json<{
          coupleSlug: string;
          filename: string;
          contentType: string;
          kind: "photo" | "photo-web" | "video";
        }>();
        const slug = safeSlug(body.coupleSlug),
          filename = safeName(body.filename);
        if (!slug || !filename)
          return json({ error: "Invalid upload" }, 400, origin);
        const key = `couples/${slug}/${body.kind}/${crypto.randomUUID()}-${filename}`;
        return json(
          {
            key,
            uploadUrl: await signedR2(env, key, "PUT", 3600),
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
              coupleSlug: body.coupleSlug,
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
        return Response.redirect(await signedR2(env, key, "GET", 900), 302);
      }
      if (url.pathname.startsWith("/media/") && request.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(7));
        if (!key.includes("/photo-web/"))
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
} satisfies ExportedHandler<Env>;
