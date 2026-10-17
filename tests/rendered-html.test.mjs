import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the gallery gateway", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RZ Weddings \| Gallery<\/title>/i);
  assert.match(html, /Photography/);
  assert.match(html, /Films/);
  assert.match(html, /The <[^>]+>Gallery/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("server-renders the photography index and gallery", async () => {
  const indexResponse = await render("/photography");
  assert.equal(indexResponse.status, 200);
  const indexHtml = await indexResponse.text();
  assert.match(indexHtml, /Wedding Photography/);
  assert.match(indexHtml, /Jasmin &amp; Daniel/);
  assert.match(indexHtml, /Ofir &amp; Michael/);

  const galleryResponse = await render("/weddings/ofir-michael/photography");
  assert.equal(galleryResponse.status, 200);
  const galleryHtml = await galleryResponse.text();
  assert.match(galleryHtml, /A wedding in photographs/i);
  assert.match(galleryHtml, /ofir-michael-photoshoot-cover\.jpg/);
});

test("server-renders a couple story with its Mux videos", async () => {
  const response = await render("/weddings/ofir-michael");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Ofir &amp; Michael/);
  assert.match(html, /Play all/i);
  assert.match(html, /oEZSS00EsoWVjt5xyh9hKNb02qEaOWln2QmDY62YXT02hE/);
  assert.match(html, /UuwA01gx02TgoQ7HCBilsuRikAvgNASld5UNgJzZg9wto/);
  assert.match(html, /Jt00z7vatTcyvIwg7HtJFhOqRkqns00t016NJ7gMQe7qJE/);
});

test("ships the custom fonts and removes starter dependencies", async () => {
  const [page, storyComponent, stories, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/WeddingStory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/stories.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(packageJson, /@mux\/mux-player-react/);
  assert.match(storyComponent, /playbackId=\{videos\[activeVideo\]\.id\}/);
  assert.match(stories, /images\/jasmin-daniel-hero\.jpg/);
  assert.doesNotMatch(storyComponent, /className="hero-video"/);
  assert.match(stories, /oEZSS00EsoWVjt5xyh9hKNb02qEaOWln2QmDY62YXT02hE/);
  assert.match(stories, /ZGJUTPgXDripAlzu1ItIR02CKwxfex8PUsQBfNlb1Wx8/);
  assert.match(storyComponent, /minResolution="2160p"/);
  assert.match(storyComponent, /maxResolution="2160p"/);
  assert.match(layout, /RZ Weddings \| Gallery/);
  assert.match(layout, /github\.io\/gallery/);
  assert.match(layout, /jasmin-daniel-hero\.jpg/);

  await Promise.all([
    access(new URL("../public/fonts/meno-display.woff2", import.meta.url)),
    access(new URL("../public/favicon.svg", import.meta.url)),
    access(new URL("../public/fonts/meno-display-light.woff2", import.meta.url)),
    access(new URL("../public/fonts/vogue-demi.woff2", import.meta.url)),
  ]);
});
