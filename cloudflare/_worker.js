// Cloudflare Pages entry for rz-gallery.pages.dev.
// Galleries live at clean URLs (/talia-liel). Link previews (WhatsApp etc.)
// don't run JavaScript, so each gallery URL is served as the static client
// page with that gallery's title, cover and brand already in the <head>,
// taken from the media API's /share page. Everything else is the static site.

const API = "https://rz-gallery-media-api.galfadlon2.workers.dev";
const SLUG = /^\/([a-z0-9][a-z0-9-]*)\/?$/i;
const PREVIEW_TAGS =
  /<title>[\s\S]*?<\/title>|<meta (?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)"[^>]*>|<link rel="(?:icon|apple-touch-icon)"[^>]*>/g;

class Remove {
  element(element) {
    element.remove();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Old links (/couple/?id=…) move to the clean URL. Manager previews keep theirs.
    if (/^\/couple\/?$/.test(url.pathname) && url.searchParams.get("id") && !url.searchParams.has("preview")) {
      const target = new URL(`/${encodeURIComponent(url.searchParams.get("id"))}`, url);
      url.searchParams.forEach((value, key) => {
        if (key !== "id" && key !== "brand") target.searchParams.append(key, value);
      });
      target.hash = url.hash;
      return Response.redirect(target.toString(), 301);
    }

    const match = url.pathname.match(SLUG);
    if (!match || !["GET", "HEAD"].includes(request.method)) return env.ASSETS.fetch(request);
    // Real pages (/manage, /films, …) win over gallery slugs.
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    const slug = match[1].toLowerCase();

    const [page, share] = await Promise.all([
      env.ASSETS.fetch(new Request(new URL("/couple/", url), request)),
      fetch(`${API}/share/${encodeURIComponent(slug)}`, { headers: { "User-Agent": "rz-gallery-pages" } }),
    ]);
    if (!share.ok) return asset;
    const shareHtml = await share.text(),
      tags = (shareHtml.match(PREVIEW_TAGS) || []).join(""),
      business = shareHtml.includes('<meta property="og:site_name" content="OMNI">');

    const response = new HTMLRewriter()
      .on("title", new Remove())
      .on('meta[name="description"]', new Remove())
      .on('meta[property^="og:"]', new Remove())
      .on('meta[name^="twitter:"]', new Remove())
      .on('link[rel~="icon"]', new Remove())
      .on('link[rel="apple-touch-icon"]', new Remove())
      .on("head", {
        element(element) {
          element.append(tags, { html: true });
        },
      })
      .on("html", {
        element(element) {
          // First paint is already OMNI for business galleries.
          if (business) element.setAttribute("data-brand", "omni");
        },
      })
      .transform(page);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=60");
    return new Response(response.body, { status: 200, headers });
  },
};
