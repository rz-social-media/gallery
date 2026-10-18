"use client";
import { createSHA256 } from "hash-wasm";
import { useEffect, useRef, useState } from "react";

const API = "https://rz-gallery-media-api.galfadlon2.workers.dev",
  BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Media = {
  id: string;
  type: "photo" | "video";
  title: string;
  alt: string;
  url?: string;
  originalKey: string;
  playbackId?: string;
  assetId?: string;
  posterUrl?: string;
  filename: string;
  sha256?: string;
};
type Gallery = {
  slug: string;
  partnerOne: string;
  partnerTwo: string;
  location: string;
  weddingDate: string;
  note: string;
  published: boolean;
  updatedAt?: string;
  previewToken?: string;
  deletedAt?: string;
  computerCoverUrl?: string;
  phoneCoverUrl?: string;
  media: Media[];
};
const blank = (): Gallery => ({
  slug: "",
  partnerOne: "",
  partnerTwo: "",
  location: "",
  weddingDate: "",
  note: "",
  published: false,
  media: [],
});
const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default function Manager() {
  const [code, setCode] = useState(""),
    [ready, setReady] = useState(false),
    [rows, setRows] = useState<Gallery[]>([]),
    [active, setActive] = useState<Gallery | null>(null),
    [openMenu, setOpenMenu] = useState<string | null>(null),
    [trashRows, setTrashRows] = useState<Gallery[]>([]),
    [showTrash, setShowTrash] = useState(false),
    [analytics, setAnalytics] = useState<Record<string, { view: number; play: number; download: number }>>({}),
    [quickPreview, setQuickPreview] = useState<Gallery | null>(null),
    [quickPreviewMode, setQuickPreviewMode] = useState<"computer" | "phone">("computer"),
    [coverGallery, setCoverGallery] = useState<Gallery | null>(null),
    [quickCoverField, setQuickCoverField] = useState<"computerCoverUrl" | "phoneCoverUrl">("computerCoverUrl"),
    [coverUploading, setCoverUploading] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const saved = sessionStorage.getItem("rz-admin-code");
    if (saved) login(saved);
  }, []);
  const auth = (value = code) => ({ Authorization: `Bearer ${value}` });
  async function call(path: string, init?: RequestInit, value = code) {
    const response = await fetch(API + path, {
      ...init,
      headers: { ...auth(value), ...(init?.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Invalid access code"
          : data.error || data.issues?.join(" · ") || "Request failed",
      );
    return data;
  }
  async function login(value: string) {
    setBusy(true);
    setNotice("");
    try {
      const list = await call("/api/galleries", undefined, value);
      setCode(value);
      sessionStorage.setItem("rz-admin-code", value);
      setRows(list);
      void loadAnalytics(list, value);
      setReady(true);
    } catch (e) {
      setNotice((e as Error).message);
    }
    setBusy(false);
  }
  async function load() {
    const list = await call("/api/galleries");
    setRows(list);
    void loadAnalytics(list);
  }
  async function loadAnalytics(galleries: Gallery[], value = code) {
    const entries = await Promise.all(
      galleries.map(async (gallery) => {
        try {
          return [gallery.slug, await call(`/api/analytics/${gallery.slug}`, undefined, value)] as const;
        } catch {
          return [gallery.slug, { view: 0, play: 0, download: 0 }] as const;
        }
      }),
    );
    setAnalytics(Object.fromEntries(entries));
  }
  async function openQuickPreview(gallery: Gallery) {
    const updated = gallery.previewToken
      ? gallery
      : { ...gallery, previewToken: crypto.randomUUID() };
    if (!gallery.previewToken) {
      await call(`/api/galleries/${gallery.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setRows((current) => current.map((item) => item.slug === gallery.slug ? updated : item));
    }
    setQuickPreview(updated);
  }
  async function applyQuickCover(url: string) {
    if (!coverGallery) return;
    const updated = { ...coverGallery, [quickCoverField]: url };
    const saved = await call(`/api/galleries/${coverGallery.slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setRows((current) => current.map((item) => item.slug === saved.slug ? saved : item));
    setCoverGallery(saved);
    setNotice("Cover updated");
    window.setTimeout(() => setNotice(""), 1800);
  }
  async function uploadQuickCover(file: File) {
    if (!coverGallery || !file.type.startsWith("image/")) return;
    setCoverUploading(true);
    try {
      const web = await resize(file);
      const hash = await createSHA256();
      hash.init();
      hash.update(new Uint8Array(await web.arrayBuffer()));
      const sha256 = hash.digest("hex");
      const prepared = await call("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coupleSlug: coverGallery.slug,
          filename: `${file.name}.cover.jpg`,
          contentType: web.type || "image/jpeg",
          kind: "photo-web",
          sha256,
        }),
      });
      if (!prepared.exists) {
        const uploaded = await fetch(prepared.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": prepared.contentType },
          body: web,
        });
        if (!uploaded.ok) throw new Error("Cover upload failed");
      }
      await applyQuickCover(`${API}/media/${prepared.key}`);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setCoverUploading(false);
    }
  }
  async function openTrash() {
    setTrashRows(await call("/api/trash"));
    setShowTrash(true);
  }
  async function restoreGallery(gallery: Gallery) {
    await call(`/api/galleries/${gallery.slug}/restore`, { method: "POST" });
    setTrashRows((current) => current.filter((item) => item.slug !== gallery.slug));
    await load();
  }
  async function save(g: Gallery, published: boolean) {
    const slug = g.slug || slugify(`${g.partnerOne}-${g.partnerTwo}`);
    if (!slug) return setNotice("Add both names first");
    setBusy(true);
    setNotice("");
    try {
      let nextGallery = { ...g, slug, published };
      if (published) {
        const media = [...nextGallery.media];
        for (let index = 0; index < media.length; index++) {
          const item = media[index];
          if (item.type !== "video" || item.assetId) continue;
          const created = await call("/api/videos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              originalKey: item.originalKey,
              title: item.title || "Wedding film",
              coupleSlug: slug,
            }),
          });
          media[index] = { ...item, assetId: created.assetId };
          nextGallery = { ...nextGallery, media: [...media] };
          await call(`/api/galleries/${slug}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...nextGallery, published: g.published }),
          });
        }
        nextGallery = { ...nextGallery, media };
        if (media.some((item) => item.type === "video" && !item.playbackId)) {
          const draft = { ...nextGallery, published: false };
          const saved = await call(`/api/galleries/${slug}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          });
          setActive(saved);
          setNotice("Films are processing. Health check will run automatically when they are ready.");
          setBusy(false);
          return;
        }
        await call(`/api/galleries/${slug}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...nextGallery, published: false }),
        });
        try {
          await call(`/api/galleries/${slug}/health`);
        } catch (error) {
          throw new Error(`Health check failed: ${(error as Error).message}`);
        }
      }
      const saved = await call(`/api/galleries/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextGallery),
      });
      setActive(saved);
      setNotice(published ? "Published successfully" : "Draft saved");
    } catch (e) {
      setNotice((e as Error).message);
    }
    setBusy(false);
  }
  async function deleteFromDashboard(gallery: Gallery) {
    const names = `${gallery.partnerOne} & ${gallery.partnerTwo}`;
    if (
      !window.confirm(
        `Move ${names}'s gallery to Trash? You can restore it for 30 days.`,
      )
    )
      return;
    try {
      await call(`/api/galleries/${gallery.slug}`, { method: "DELETE" });
      setRows((current) =>
        current.filter((item) => item.slug !== gallery.slug),
      );
    } catch (error) {
      alert((error as Error).message);
    }
  }
  async function copyGalleryUrl(gallery: Gallery) {
    if (!gallery.published) return;
    const version = gallery.updatedAt
      ? `?v=${encodeURIComponent(gallery.updatedAt)}`
      : "";
    const shareUrl = `${API}/share/${encodeURIComponent(gallery.slug)}${version}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Gallery URL copied");
      setOpenMenu(null);
      window.setTimeout(() => setNotice(""), 2200);
    } catch {
      window.prompt("Copy gallery URL", shareUrl);
    }
  }
  if (!ready)
    return (
      <main className="gm-login">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login(code);
          }}
        >
          <b className="gm-seal">RZ</b>
          <small>Private workspace</small>
          <h1>Gallery Manager</h1>
          <p>Upload, organize and deliver every wedding story.</p>
          <label>
            Access code
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </label>
          {notice && <em>{notice}</em>}
          <button>{busy ? "Connecting…" : "Open manager"}</button>
        </form>
      </main>
    );
  if (active)
    return (
      <Editor
        gallery={active}
        change={setActive}
        close={() => {
          setActive(null);
          load();
        }}
        save={save}
        busy={busy}
        notice={notice}
        code={code}
      />
    );
  return (
    <main className="gm">
      <header>
        <div>
          <b className="gm-seal">RZ</b>
          <strong>Gallery Manager</strong>
        </div>
        <button
          onClick={() => {
            sessionStorage.removeItem("rz-admin-code");
            setReady(false);
          }}
        >
          Sign out
        </button>
      </header>
      <section className="gm-dash">
        <div className="gm-title">
          <div>
            <small>Your galleries</small>
            <h1>
              Every story,
              <br />
              <i>ready to share.</i>
            </h1>
          </div>
          <div className="gm-title-actions">
            <button onClick={() => void openTrash()}>Trash</button>
            <button onClick={() => setActive(blank())}>＋ New gallery</button>
          </div>
        </div>
        {showTrash && (
          <section className="trash-panel">
            <div><h2>Recently deleted</h2><button onClick={() => setShowTrash(false)}>Close</button></div>
            <p>Galleries are permanently deleted after 30 days.</p>
            {trashRows.length === 0 ? <p>Trash is empty.</p> : trashRows.map((gallery) => (
              <article key={gallery.slug}>
                <span>{gallery.partnerOne} &amp; {gallery.partnerTwo}</span>
                <small>{gallery.deletedAt ? new Date(gallery.deletedAt).toLocaleDateString() : ""}</small>
                <button onClick={() => void restoreGallery(gallery)}>Restore</button>
              </article>
            ))}
          </section>
        )}
        <div className="gm-grid">
          {rows.map((g) => {
            const coverUrl =
              g.computerCoverUrl ||
              g.phoneCoverUrl ||
              g.media.find((x) => x.type === "photo")?.url ||
              g.media.find((x) => x.type === "video")?.posterUrl;
            return (
              <article className="gm-card" key={g.slug}>
                <button
                  className="gm-card-open"
                  onClick={() => setActive(g)}
                >
                  <div>
                    {coverUrl && <img src={coverUrl} alt="" />}
                    <span>{g.published ? "Live" : "Draft"}</span>
                  </div>
                  <h2>
                    {g.partnerOne} <i>&</i> {g.partnerTwo}
                  </h2>
                  <p>{g.location || "Location not added"}</p>
                  <small className="gm-card-stats">
                    {analytics[g.slug]?.view || 0} views · {analytics[g.slug]?.play || 0} plays · {analytics[g.slug]?.download || 0} downloads
                  </small>
                </button>
                <button className="gm-quick-preview" onClick={() => void openQuickPreview(g)}>
                  Preview
                </button>
                <div className="gm-card-menu">
                  <button
                    className="gm-card-menu-trigger"
                    onClick={() =>
                      setOpenMenu((current) =>
                        current === g.slug ? null : g.slug,
                      )
                    }
                    aria-label={`Actions for ${g.partnerOne} and ${g.partnerTwo}`}
                    aria-expanded={openMenu === g.slug}
                  >
                    •••
                  </button>
                  {openMenu === g.slug && (
                    <div className="gm-card-menu-popover">
                      <button
                        disabled={!g.published}
                        onClick={() => void copyGalleryUrl(g)}
                        title={g.published ? "Copy gallery URL" : "Publish the gallery first"}
                      >
                        <span aria-hidden="true">⧉</span> Copy URL
                      </button>
                      <button onClick={() => { setOpenMenu(null); void openQuickPreview(g); }}>
                        <span aria-hidden="true">◉</span> Quick Preview
                      </button>
                      <button onClick={() => { setOpenMenu(null); setCoverGallery(g); }}>
                        <span aria-hidden="true">▣</span> Change Cover
                      </button>
                      <button
                        className="is-danger"
                        onClick={() => {
                          setOpenMenu(null);
                          void deleteFromDashboard(g);
                        }}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                        </svg>
                        Delete Gallery
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {notice && <aside className="gm-dashboard-notice">{notice}</aside>}
      {quickPreview?.previewToken && (
        <div className="preview-modal" role="dialog" aria-modal="true">
          <div className="preview-toolbar">
            <strong>{quickPreview.partnerOne} &amp; {quickPreview.partnerTwo}</strong>
            <div>
              <button className={quickPreviewMode === "computer" ? "active" : ""} onClick={() => setQuickPreviewMode("computer")}>Computer</button>
              <button className={quickPreviewMode === "phone" ? "active" : ""} onClick={() => setQuickPreviewMode("phone")}>Phone</button>
              <button onClick={() => setQuickPreview(null)}>Close</button>
            </div>
          </div>
          <div className={`preview-device is-${quickPreviewMode}`}>
            <iframe title="Client gallery preview" src={`${window.location.origin}${BASE}/couple/?id=${encodeURIComponent(quickPreview.slug)}&preview=${encodeURIComponent(quickPreview.previewToken)}`} />
          </div>
        </div>
      )}
      {coverGallery && (
        <div className="cover-modal" role="dialog" aria-modal="true">
          <section>
            <div className="cover-modal-head">
              <div><small>Quick edit</small><h2>Change cover</h2></div>
              <button onClick={() => setCoverGallery(null)}>×</button>
            </div>
            <div className="cover-targets">
              <button className={quickCoverField === "computerCoverUrl" ? "active" : ""} onClick={() => setQuickCoverField("computerCoverUrl")}>Computer Cover</button>
              <button className={quickCoverField === "phoneCoverUrl" ? "active" : ""} onClick={() => setQuickCoverField("phoneCoverUrl")}>Phone Cover</button>
            </div>
            <label className="cover-upload">
              {coverUploading ? "Uploading…" : "＋ Upload new cover"}
              <input hidden type="file" accept="image/*" disabled={coverUploading} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadQuickCover(file);
              }} />
            </label>
            <p>Or choose from media already in this gallery.</p>
            <div className="cover-library">
              {coverGallery.media.flatMap((item) => {
                const url = item.type === "photo" ? item.url : item.posterUrl;
                return url ? [<button key={item.id} onClick={() => void applyQuickCover(url)}><img src={url} alt={item.alt || item.title || item.filename} /></button>] : [];
              })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Editor({
  gallery,
  change,
  close,
  save,
  busy,
  notice,
  code,
}: {
  gallery: Gallery;
  change: (g: Gallery) => void;
  close: () => void;
  save: (g: Gallery, p: boolean) => void;
  busy: boolean;
  notice: string;
  code: string;
}) {
  const [uploading, setUploading] = useState<string | null>(null),
    [progress, setProgress] = useState(0),
    [uploadStage, setUploadStage] = useState<"uploading" | "processing">(
      "uploading",
    ),
    [processingStartedAt, setProcessingStartedAt] = useState<number | null>(
      null,
    ),
    [elapsedSeconds, setElapsedSeconds] = useState(0),
    [videoStates, setVideoStates] = useState<Record<string, string>>({}),
    [dropActive, setDropActive] = useState(false),
    [draggedMediaId, setDraggedMediaId] = useState<string | null>(null),
    [coverFor, setCoverFor] = useState<string | null>(null),
    [galleryCoverFor, setGalleryCoverFor] = useState<
      "computerCoverUrl" | "phoneCoverUrl" | null
    >(null),
    [deleting, setDeleting] = useState(false),
    [previewMode, setPreviewMode] = useState<"computer" | "phone" | null>(null),
    [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle"),
    [healthState, setHealthState] = useState<{ ok: boolean; issues: string[] } | null>(null),
    [checkingHealth, setCheckingHealth] = useState(false);
  const galleryRef = useRef(gallery);
  const lastAutosaved = useRef(JSON.stringify(gallery));
  useEffect(() => {
    galleryRef.current = gallery;
  }, [gallery]);
  useEffect(() => {
    if (!processingStartedAt) {
      setElapsedSeconds(0);
      return;
    }
    const update = () =>
      setElapsedSeconds(Math.floor((Date.now() - processingStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [processingStartedAt]);
  const pendingVideoIds = gallery.media
    .filter((item) => item.type === "video" && item.assetId && !item.playbackId)
    .map((item) => item.assetId)
    .join(",");
  useEffect(() => {
    if (!gallery.slug || !pendingVideoIds) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      const current = galleryRef.current;
      const pending = current.media.filter(
        (item) => item.type === "video" && item.assetId && !item.playbackId,
      );
      if (!pending.length) return;
      try {
        const results = await Promise.all(
          pending.map(async (item) => {
            const response = await fetch(`${API}/api/videos/${item.assetId}`, {
              headers: { Authorization: `Bearer ${code}` },
            });
            if (!response.ok) throw new Error("Could not check film status");
            return { item, state: await response.json() };
          }),
        );
        if (stopped) return;
        setVideoStates((previous) => ({
          ...previous,
          ...Object.fromEntries(
            results.map(({ item, state }) => [
              item.id,
              state.progressState || state.status,
            ]),
          ),
        }));
        const ready = new Map(
          results
            .filter(({ state }) => state.playbackId)
            .map(({ item, state }) => [item.id, state.playbackId]),
        );
        if (ready.size) {
          const latest = galleryRef.current;
          const updated = {
            ...latest,
            media: latest.media.map((item) =>
              ready.has(item.id)
                ? { ...item, playbackId: ready.get(item.id) }
                : item,
            ),
          };
          galleryRef.current = updated;
          change(updated);
          await persist(updated);
        }
        if (results.some(({ state }) => !state.playbackId))
          timer = window.setTimeout(poll, 5000);
      } catch {
        if (!stopped) timer = window.setTimeout(poll, 10000);
      }
    };
    poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pendingVideoIds, gallery.slug, code]);
  const set = (k: keyof Gallery, v: any) => change({ ...gallery, [k]: v });
  async function persist(value: Gallery) {
    const response = await fetch(`${API}/api/galleries/${value.slug}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${code}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
    if (!response.ok) throw new Error("Could not save gallery progress");
  }
  useEffect(() => {
    const slug = gallery.slug || slugify(`${gallery.partnerOne}-${gallery.partnerTwo}`);
    if (!slug || !gallery.partnerOne || !gallery.partnerTwo) return;
    const candidate = { ...gallery, slug };
    const serialized = JSON.stringify(candidate);
    if (serialized === lastAutosaved.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        await persist(candidate);
        lastAutosaved.current = serialized;
        galleryRef.current = candidate;
        if (!gallery.slug) change(candidate);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [gallery]);
  async function openPreview() {
    const slug = gallery.slug || slugify(`${gallery.partnerOne}-${gallery.partnerTwo}`);
    if (!slug) return alert("Add both names first");
    const updated = {
      ...galleryRef.current,
      slug,
      published: galleryRef.current.published,
      previewToken: galleryRef.current.previewToken || crypto.randomUUID(),
    };
    await persist(updated);
    galleryRef.current = updated;
    change(updated);
    setPreviewMode("computer");
  }
  async function runHealthCheck() {
    const slug = gallery.slug || slugify(`${gallery.partnerOne}-${gallery.partnerTwo}`);
    if (!slug) return alert("Add both names first");
    setCheckingHealth(true);
    try {
      await persist({ ...galleryRef.current, slug, published: false });
      const response = await fetch(`${API}/api/galleries/${slug}/health`, {
        headers: { Authorization: `Bearer ${code}` },
      });
      const result = await response.json();
      setHealthState({ ok: Boolean(result.ok), issues: result.issues || [] });
    } catch (error) {
      setHealthState({ ok: false, issues: [(error as Error).message] });
    } finally {
      setCheckingHealth(false);
    }
  }
  async function updateMedia(media: Media[]) {
    const updated = { ...galleryRef.current, media };
    galleryRef.current = updated;
    change(updated);
    if (updated.slug) {
      try {
        await persist(updated);
      } catch (error) {
        alert((error as Error).message);
      }
    }
  }
  function moveMedia(targetId: string) {
    if (!draggedMediaId || draggedMediaId === targetId) return;
    const media = [...galleryRef.current.media],
      from = media.findIndex((item) => item.id === draggedMediaId),
      to = media.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = media.splice(from, 1);
    media.splice(to, 0, moved);
    setDraggedMediaId(null);
    void updateMedia(media);
  }
  function selectVideoCover(videoId: string, posterUrl?: string) {
    const media = galleryRef.current.media.map((item) =>
      item.id === videoId ? { ...item, posterUrl } : item,
    );
    setCoverFor(null);
    void updateMedia(media);
  }
  function selectGalleryCover(
    field: "computerCoverUrl" | "phoneCoverUrl",
    coverUrl?: string,
  ) {
    const updated = { ...galleryRef.current, [field]: coverUrl };
    galleryRef.current = updated;
    change(updated);
    setGalleryCoverFor(null);
    if (updated.slug) void persist(updated);
  }
  const coverCandidates = gallery.media.flatMap((item) => {
    const url = item.type === "photo" ? item.url : item.posterUrl;
    return url
      ? [{ id: item.id, url, alt: item.alt || item.title || item.filename }]
      : [];
  });
  const automaticCover = coverCandidates[0]?.url;
  async function deleteGallery() {
    if (!gallery.slug) return;
    const names =
      [gallery.partnerOne, gallery.partnerTwo].filter(Boolean).join(" & ") ||
      gallery.slug;
    if (
      !window.confirm(
        `Move ${names}'s gallery to Trash?\n\nYou can restore it for 30 days before the files are permanently removed.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const response = await fetch(`${API}/api/galleries/${gallery.slug}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${code}` },
        }),
        data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not delete gallery");
      close();
    } catch (error) {
      alert((error as Error).message);
      setDeleting(false);
    }
  }
  async function signed(
    file: Blob,
    filename: string,
    kind: string,
    slug: string,
    sha256: string,
  ) {
    if (file.size >= 48 * 1024 * 1024) {
      const sessionKey = `rz-gallery-upload-${sha256}`;
      type UploadSession = {
        key: string;
        uploadId: string;
        parts: { partNumber: number; etag: string }[];
      };
      let session: UploadSession | null = null;
      try {
        session = JSON.parse(localStorage.getItem(sessionKey) || "null");
      } catch {
        localStorage.removeItem(sessionKey);
      }
      if (!session) {
        const started = await fetch(`${API}/api/multipart/start`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${code}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            coupleSlug: slug,
            contentType: file.type || "application/octet-stream",
            kind,
            sha256,
          }),
        });
        const data = await started.json();
        if (!started.ok) throw new Error(data.error || "Could not prepare upload");
        if (data.exists) return data.key as string;
        session = { key: data.key, uploadId: data.uploadId, parts: [] };
        localStorage.setItem(sessionKey, JSON.stringify(session));
      }
      const chunkSize = 8 * 1024 * 1024;
      const totalParts = Math.ceil(file.size / chunkSize);
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (session.parts.some((part) => part.partNumber === partNumber)) continue;
        const chunk = file.slice((partNumber - 1) * chunkSize, Math.min(partNumber * chunkSize, file.size));
        let uploaded: { partNumber: number; etag: string } | null = null;
        for (let attempt = 1; attempt <= 3 && !uploaded; attempt++) {
          const response = await fetch(
            `${API}/api/multipart/part?key=${encodeURIComponent(session.key)}&uploadId=${encodeURIComponent(session.uploadId)}&partNumber=${partNumber}`,
            { method: "PUT", headers: { Authorization: `Bearer ${code}` }, body: chunk },
          );
          if (response.ok) uploaded = await response.json();
          else if (attempt === 3) throw new Error(`Upload failed on part ${partNumber}`);
          else await new Promise((resolve) => window.setTimeout(resolve, attempt * 1200));
        }
        session.parts.push(uploaded!);
        localStorage.setItem(sessionKey, JSON.stringify(session));
        setProgress(Math.round((session.parts.length / totalParts) * 100));
      }
      const completed = await fetch(`${API}/api/multipart/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${code}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(session),
      });
      if (!completed.ok) throw new Error("Could not finalize upload");
      localStorage.removeItem(sessionKey);
      return session.key;
    }
    const response = await fetch(`${API}/api/uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${code}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coupleSlug: slug,
        filename,
        contentType: file.type || "application/octet-stream",
        kind,
        sha256,
      }),
    });
    if (!response.ok) throw new Error("Could not prepare upload");
    const data = await response.json();
    if (data.exists) return data.key as string;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", data.uploadUrl);
          xhr.setRequestHeader("Content-Type", data.contentType);
          xhr.upload.onprogress = (e) =>
            e.lengthComputable &&
            setProgress(Math.round((e.loaded / e.total) * 100));
          xhr.onload = () =>
            xhr.status < 300
              ? resolve()
              : reject(new Error(`Upload failed (storage returned ${xhr.status})`));
          xhr.onerror = () => reject(new Error("Upload lost its connection"));
          xhr.send(file);
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error as Error;
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, attempt * 1200));
      }
    }
    if (lastError) throw new Error(`${lastError.message}. Retried 3 times.`);
    return data.key;
  }
  async function fingerprint(file: Blob) {
    const hash = await createSHA256();
    hash.init();
    const chunkSize = 8 * 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
      hash.update(new Uint8Array(chunk));
    }
    return hash.digest("hex");
  }
  async function addFiles(files: File[]) {
    if (uploading || !files.length) return;
    const slug =
      gallery.slug || slugify(`${gallery.partnerOne}-${gallery.partnerTwo}`);
    if (!slug) return alert("Add both names first");
    for (const file of files) {
      setUploading(file.name);
      setProgress(0);
      setUploadStage("uploading");
      setProcessingStartedAt(null);
      try {
        const sha256 = await fingerprint(file);
        if (
          galleryRef.current.media.some(
            (item) => item.type === (file.type.startsWith("image/") ? "photo" : "video") && item.sha256 === sha256,
          )
        )
          continue;
        if (file.type.startsWith("image/")) {
          const originalKey = await signed(file, file.name, "photo", slug, sha256),
            web = await resize(file),
            webSha256 = await fingerprint(web),
            webKey = await signed(
              web,
              `${file.name}.web.jpg`,
              "photo-web",
              slug,
              webSha256,
            );
          const media = [
            ...galleryRef.current.media,
            {
              id: crypto.randomUUID(),
              type: "photo" as const,
              title: "",
              alt: file.name,
              filename: file.name,
              sha256,
              originalKey,
              url: `${API}/media/${webKey}`,
            },
          ];
          const updated = { ...galleryRef.current, slug, media };
          galleryRef.current = updated;
          change(updated);
          await persist(updated);
        } else if (file.type.startsWith("video/")) {
          const originalKey = await signed(file, file.name, "video", slug, sha256);
          setUploadStage("processing");
          setProcessingStartedAt(Date.now());
          const poster = await createVideoPoster(file);
          const posterSha256 = await fingerprint(poster);
          const posterKey = await signed(
            poster,
            `${file.name}.poster.jpg`,
            "video-poster",
            slug,
            posterSha256,
          );
          const media = [
            ...galleryRef.current.media,
            {
              id: crypto.randomUUID(),
              type: "video" as const,
              title: file.name.replace(/\.[^.]+$/, "") || "Wedding film",
              alt: "",
              filename: file.name,
              sha256,
              originalKey,
              posterUrl: `${API}/media/${posterKey}`,
            },
          ];
          const updated = { ...galleryRef.current, slug, media };
          galleryRef.current = updated;
          change(updated);
          await persist(updated);
        }
      } catch (e) {
        alert((e as Error).message);
      }
    }
    setUploading(null);
    setProgress(0);
    setUploadStage("uploading");
    setProcessingStartedAt(null);
  }
  return (
    <main className="gm">
      <header>
        <button onClick={close}>← All galleries</button>
        <div>
          <span className={`autosave-state is-${saveState}`}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
          </span>
          <button onClick={() => void openPreview()}>Preview</button>
          <button onClick={() => void runHealthCheck()}>{checkingHealth ? "Checking…" : "Health check"}</button>
          <button onClick={() => save(gallery, false)}>Save draft</button>
          <button className="primary" onClick={() => save(gallery, true)}>
            {busy ? "Publishing…" : "Publish gallery"}
          </button>
        </div>
      </header>
      {healthState && (
        <aside className={`health-panel ${healthState.ok ? "is-ok" : "is-error"}`}>
          <strong>{healthState.ok ? "Ready to publish" : "Needs attention"}</strong>
          {healthState.issues.length > 0 && <ul>{healthState.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          <button onClick={() => setHealthState(null)}>×</button>
        </aside>
      )}
      {previewMode && galleryRef.current.previewToken && (
        <div className="preview-modal" role="dialog" aria-modal="true">
          <div className="preview-toolbar">
            <strong>Client preview</strong>
            <div>
              <button className={previewMode === "computer" ? "active" : ""} onClick={() => setPreviewMode("computer")}>Computer</button>
              <button className={previewMode === "phone" ? "active" : ""} onClick={() => setPreviewMode("phone")}>Phone</button>
              <button onClick={() => setPreviewMode(null)}>Close</button>
            </div>
          </div>
          <div className={`preview-device is-${previewMode}`}>
            <iframe
              title="Client gallery preview"
              src={`${window.location.origin}${BASE}/couple/?id=${encodeURIComponent(galleryRef.current.slug)}&preview=${encodeURIComponent(galleryRef.current.previewToken)}`}
            />
          </div>
        </div>
      )}
      <section className="gm-edit">
        <small>Gallery details</small>
        <h1>
          {gallery.partnerOne || "Partner one"} <i>&</i>{" "}
          {gallery.partnerTwo || "Partner two"}
        </h1>
        <article>
          <h2>Story details</h2>
          <div className="fields">
            <label>
              Partner one
              <input
                value={gallery.partnerOne}
                onChange={(e) => set("partnerOne", e.target.value)}
              />
            </label>
            <label>
              Partner two
              <input
                value={gallery.partnerTwo}
                onChange={(e) => set("partnerTwo", e.target.value)}
              />
            </label>
            <label>
              Location
              <input
                value={gallery.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </label>
            <label>
              Wedding date
              <input
                type="date"
                value={gallery.weddingDate}
                onChange={(e) => set("weddingDate", e.target.value)}
              />
            </label>
          </div>
          <label>
            Opening note
            <textarea
              value={gallery.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </label>
        </article>
        <article>
          <div className="article-head">
            <div>
              <small>01</small>
              <h2>Photos & films</h2>
            </div>
          </div>
          <label
            className={`media-dropzone ${dropActive ? "is-active" : ""} ${uploading ? "is-busy" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDropActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDropActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropActive(false);
              if (!uploading) void addFiles([...event.dataTransfer.files]);
            }}
          >
            <strong>
              {uploading ? "Upload in progress…" : "Drop photos & films here"}
            </strong>
            <span>or click once to choose files</span>
            <input
              hidden
              multiple
              type="file"
              disabled={Boolean(uploading)}
              accept="image/*,video/*"
              onClick={(e) => {
                e.currentTarget.value = "";
              }}
              onChange={(e) => {
                const files = [...(e.currentTarget.files || [])];
                e.currentTarget.value = "";
                if (files.length) void addFiles(files);
              }}
            />
          </label>
          {uploading && (
            <div
              className={`upload-progress ${uploadStage === "processing" ? "is-processing" : ""}`}
              role="status"
              aria-live="polite"
            >
              {uploadStage === "processing" ? (
                <>
                  <b className="processing-spinner" aria-hidden="true" />
                  <div>
                    <strong>Creating the film cover…</strong>
                    <small>
                      {uploading} · {formatElapsed(elapsedSeconds)} elapsed
                    </small>
                    <small>Saving the first frame as the default cover</small>
                  </div>
                </>
              ) : (
                <>
                  <strong>{uploading}</strong>
                  <span>{progress}%</span>
                  <i style={{ width: `${progress}%` }} />
                </>
              )}
            </div>
          )}
          <div className="media-section-title">
            <div>
              <small>Photography</small>
              <strong>
                {gallery.media.filter((item) => item.type === "photo").length} photos
              </strong>
            </div>
            <span>Drag to reorder · First photo is the gallery cover</span>
          </div>
          <div className="gm-photos">
            {gallery.media
              .filter((x) => x.type === "photo")
              .map((p, i) => (
                <figure
                  key={p.id}
                  draggable
                  onDragStart={() => setDraggedMediaId(p.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveMedia(p.id)}
                  title="Drag to reorder"
                >
                  <img src={p.url} />
                  {i === 0 && <span>Cover</span>}
                  <b className="media-ready-badge">Ready</b>
                  <button
                    onClick={() =>
                      void updateMedia(
                        galleryRef.current.media.filter(
                          (item) => item.id !== p.id,
                        ),
                      )
                    }
                    aria-label={`Remove ${p.filename}`}
                  >
                    ×
                  </button>
                </figure>
              ))}
          </div>
          <div className="media-section-title films-title">
            <div>
              <small>Films</small>
              <strong>
                {gallery.media.filter((item) => item.type === "video").length} films
              </strong>
            </div>
            <span>Every film includes a cover</span>
          </div>
          {gallery.media
            .filter((x) => x.type === "video")
            .map((v) => (
              <div
                className={`film ${v.assetId && !v.playbackId ? "is-processing" : ""}`}
                key={v.id}
                draggable
                onDragStart={() => setDraggedMediaId(v.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveMedia(v.id)}
                title="Drag to reorder"
              >
                <div className="film-poster">
                  {v.posterUrl ? (
                    <img src={v.posterUrl} alt="" />
                  ) : v.playbackId ? (
                    <img
                      src={`https://image.mux.com/${v.playbackId}/thumbnail.webp?time=0&width=360&fit_mode=smartcrop`}
                      alt=""
                    />
                  ) : (
                    <b className="processing-spinner" aria-hidden="true" />
                  )}
                </div>
                <div className="film-copy">
                  <input
                    aria-label="Film title"
                    value={v.title}
                    onChange={(event) => {
                      const media = galleryRef.current.media.map((item) =>
                        item.id === v.id
                          ? { ...item, title: event.target.value }
                          : item,
                      );
                      const updated = { ...galleryRef.current, media };
                      galleryRef.current = updated;
                      change(updated);
                    }}
                    onBlur={() => void persist(galleryRef.current)}
                  />
                  <small className={`media-status ${v.playbackId ? "is-ready" : v.assetId ? "is-processing" : "is-uploaded"}`}>
                    {v.playbackId ? "Ready" : v.assetId ? (videoStates[v.id] || "Processing") : "Uploaded · waiting for publish"}
                  </small>
                  {!v.assetId && (
                    <small>
                      Ready in draft · Streaming starts only when you publish
                    </small>
                  )}
                  {v.assetId && !v.playbackId && (
                    <small>
                      {formatMuxState(videoStates[v.id] || "preparing")} in the
                      background · Safe to close this page
                    </small>
                  )}
                </div>
                <div className="film-actions">
                  <button onClick={() => setCoverFor(v.id)}>
                    Choose cover
                  </button>
                  <button
                    onClick={() =>
                      void updateMedia(
                        galleryRef.current.media.filter(
                          (item) => item.id !== v.id,
                        ),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
        </article>
        <article className="gallery-covers-editor">
          <div className="article-head">
            <div>
              <small>02</small>
              <h2>Gallery covers</h2>
              <p>
                Choose one image for computers and one for phones. If you leave
                either empty, the gallery automatically uses the first available
                photo or film cover.
              </p>
            </div>
          </div>
          <div className="gallery-cover-cards">
            {(
              [
                ["computerCoverUrl", "Computer cover"],
                ["phoneCoverUrl", "Phone cover"],
              ] as const
            ).map(([field, label]) => {
              const selected = gallery[field];
              return (
                <section key={field}>
                  <div className={field === "phoneCoverUrl" ? "is-phone" : ""}>
                    {(selected || automaticCover) && (
                      <img src={selected || automaticCover} alt="" />
                    )}
                    <span>{selected ? "Selected" : "Automatic default"}</span>
                  </div>
                  <h3>{label}</h3>
                  <button onClick={() => setGalleryCoverFor(field)}>
                    {selected ? "Change cover" : "Choose cover"}
                  </button>
                </section>
              );
            })}
          </div>
        </article>
        {coverFor && (
          <div className="cover-picker" onClick={() => setCoverFor(null)}>
            <section onClick={(event) => event.stopPropagation()}>
              <div>
                <div>
                  <small>Film cover</small>
                  <h2>Choose a photograph</h2>
                </div>
                <button onClick={() => setCoverFor(null)}>×</button>
              </div>
              <div className="cover-options">
                {gallery.media
                  .filter((item) => item.type === "photo" && item.url)
                  .map((photo) => (
                    <button
                      key={photo.id}
                      onClick={() => selectVideoCover(coverFor, photo.url)}
                    >
                      <img src={photo.url} alt={photo.alt} />
                    </button>
                  ))}
              </div>
              {!gallery.media.some(
                (item) => item.type === "photo" && item.url,
              ) && <p>Upload a photograph first, then choose it here.</p>}
              <button
                className="automatic-cover"
                onClick={() => selectVideoCover(coverFor)}
              >
                Use automatic film thumbnail
              </button>
            </section>
          </div>
        )}
        {galleryCoverFor && (
          <div
            className="cover-picker"
            onClick={() => setGalleryCoverFor(null)}
          >
            <section onClick={(event) => event.stopPropagation()}>
              <div>
                <div>
                  <small>Gallery cover</small>
                  <h2>
                    Choose the {galleryCoverFor === "phoneCoverUrl" ? "phone" : "computer"} cover
                  </h2>
                </div>
                <button onClick={() => setGalleryCoverFor(null)}>×</button>
              </div>
              <div className="cover-options">
                {coverCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    onClick={() =>
                      selectGalleryCover(galleryCoverFor, candidate.url)
                    }
                  >
                    <img src={candidate.url} alt={candidate.alt} />
                  </button>
                ))}
              </div>
              {!coverCandidates.length && (
                <p>Upload a photograph or film first, then choose it here.</p>
              )}
              <button
                className="automatic-cover"
                onClick={() => selectGalleryCover(galleryCoverFor)}
              >
                Use automatic default
              </button>
            </section>
          </div>
        )}
        {gallery.slug && (
          <article className="danger-zone">
            <div>
              <small>Permanent action</small>
              <h2>Delete this gallery</h2>
              <p>
                Remove the gallery and all of its uploaded photos and films from
                storage.
              </p>
            </div>
            <button
              disabled={deleting || busy || Boolean(uploading)}
              onClick={deleteGallery}
            >
              {deleting ? "Deleting…" : "Delete entire gallery"}
            </button>
          </article>
        )}
        {notice && (
          <aside>
            {notice}
            {gallery.published && (
              <a href={`${BASE}/couple/?id=${gallery.slug}`} target="_blank">
                Open gallery ↗
              </a>
            )}
          </aside>
        )}
      </section>
    </main>
  );
}

async function resize(file: File) {
  const bitmap = await createImageBitmap(file),
    max = 2400,
    scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Image processing failed")),
      "image/jpeg",
      0.86,
    ),
  );
}

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatMuxState(state: string) {
  return state === "transcoding"
    ? "Transcoding"
    : state === "ingesting"
      ? "Preparing"
      : "Processing";
}

async function createVideoPoster(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    const frameReady = await new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (ready: boolean) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        resolve(ready && video.videoWidth > 0 && video.videoHeight > 0);
      };
      const timeout = window.setTimeout(() => finish(video.readyState >= 2), 12000);
      video.onerror = () => finish(false);
      video.onseeked = () => finish(true);
      video.onloadeddata = () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0.04) {
          finish(true);
          return;
        }
        try {
          video.currentTime = Math.min(0.1, Math.max(0.01, video.duration / 100));
          window.setTimeout(() => finish(video.readyState >= 2), 1500);
        } catch {
          finish(true);
        }
      };
      video.load();
    });
    if (!frameReady) return createFallbackVideoPoster();
    const max = 1600,
      scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas
      .getContext("2d")!
      .drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Could not create cover")),
        "image/jpeg",
        0.86,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function createFallbackVideoPoster() {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#eee7de";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#8f7b69";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(800, 420, 76, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#2a241f";
  context.textAlign = "center";
  context.font = "600 58px Georgia, serif";
  context.fillText("RZ", 800, 440);
  context.fillStyle = "#74685d";
  context.font = "28px Arial, sans-serif";
  context.fillText("WEDDING FILM", 800, 555);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not create cover")),
      "image/jpeg",
      0.86,
    ),
  );
}
