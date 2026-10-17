"use client";
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
  filename: string;
};
type Gallery = {
  slug: string;
  partnerOne: string;
  partnerTwo: string;
  location: string;
  weddingDate: string;
  note: string;
  published: boolean;
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
          : data.error || "Request failed",
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
      setReady(true);
    } catch (e) {
      setNotice((e as Error).message);
    }
    setBusy(false);
  }
  async function load() {
    setRows(await call("/api/galleries"));
  }
  async function save(g: Gallery, published: boolean) {
    const slug = g.slug || slugify(`${g.partnerOne}-${g.partnerTwo}`);
    if (!slug) return setNotice("Add both names first");
    setBusy(true);
    setNotice("");
    try {
      const saved = await call(`/api/galleries/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...g, slug, published }),
      });
      setActive(saved);
      setNotice(published ? "Published successfully" : "Draft saved");
    } catch (e) {
      setNotice((e as Error).message);
    }
    setBusy(false);
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
          <button onClick={() => setActive(blank())}>＋ New gallery</button>
        </div>
        <div className="gm-grid">
          {rows.map((g) => {
            const cover = g.media.find((x) => x.type === "photo");
            return (
              <button
                className="gm-card"
                key={g.slug}
                onClick={() => setActive(g)}
              >
                <div>
                  {cover?.url && <img src={cover.url} alt="" />}
                  <span>{g.published ? "Live" : "Draft"}</span>
                </div>
                <h2>
                  {g.partnerOne} <i>&</i> {g.partnerTwo}
                </h2>
                <p>{g.location || "Location not added"}</p>
              </button>
            );
          })}
        </div>
      </section>
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
    [muxProgress, setMuxProgress] = useState<{
      state: string | null;
      percentage: number | null;
    }>({ state: null, percentage: null }),
    [videoStates, setVideoStates] = useState<Record<string, string>>({}),
    [deleting, setDeleting] = useState(false);
  const galleryRef = useRef(gallery);
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
  async function deleteGallery() {
    if (!gallery.slug) return;
    const names =
      [gallery.partnerOne, gallery.partnerTwo].filter(Boolean).join(" & ") ||
      gallery.slug;
    if (
      !window.confirm(
        `Delete ${names}'s entire gallery?\n\nThis permanently deletes the gallery, every uploaded photo and film, and cannot be undone.`,
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
  ) {
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
      }),
    });
    if (!response.ok) throw new Error("Could not prepare upload");
    const data = await response.json();
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
      xhr.onerror = () =>
        reject(
          new Error(
            "Upload could not reach storage. Check the connection and try again.",
          ),
        );
      xhr.send(file);
    });
    return data.key;
  }
  async function addFiles(files: File[]) {
    const slug =
      gallery.slug || slugify(`${gallery.partnerOne}-${gallery.partnerTwo}`);
    if (!slug) return alert("Add both names first");
    const nextMedia = [...gallery.media];
    for (const file of files) {
      setUploading(file.name);
      setProgress(0);
      setUploadStage("uploading");
      setProcessingStartedAt(null);
      setMuxProgress({ state: null, percentage: null });
      try {
        if (file.type.startsWith("image/")) {
          const originalKey = await signed(file, file.name, "photo", slug),
            web = await resize(file),
            webKey = await signed(
              web,
              `${file.name}.web.jpg`,
              "photo-web",
              slug,
            );
          nextMedia.push({
            id: crypto.randomUUID(),
            type: "photo",
            title: "",
            alt: file.name,
            filename: file.name,
            originalKey,
            url: `${API}/media/${webKey}`,
          });
          const updated = { ...galleryRef.current, slug, media: [...nextMedia] };
          galleryRef.current = updated;
          change(updated);
          await persist(updated);
        } else if (file.type.startsWith("video/")) {
          const originalKey = await signed(file, file.name, "video", slug);
          setUploadStage("processing");
          setProcessingStartedAt(Date.now());
          const createdResponse = await fetch(`${API}/api/videos`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${code}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              originalKey,
              title: file.name.replace(/\.[^.]+$/, "") || "Wedding film",
              coupleSlug: slug,
            }),
          });
          const created = await createdResponse.json();
          if (!createdResponse.ok)
            throw new Error(created.error || "Could not start film processing");
          nextMedia.push({
            id: crypto.randomUUID(),
            type: "video",
            title: file.name.replace(/\.[^.]+$/, "") || "Wedding film",
            alt: "",
            filename: file.name,
            originalKey,
            assetId: created.assetId,
          });
          const updated = { ...galleryRef.current, slug, media: [...nextMedia] };
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
    setMuxProgress({ state: null, percentage: null });
  }
  return (
    <main className="gm">
      <header>
        <button onClick={close}>← All galleries</button>
        <div>
          <button onClick={() => save(gallery, false)}>Save draft</button>
          <button className="primary" onClick={() => save(gallery, true)}>
            {busy ? "Publishing…" : "Publish gallery"}
          </button>
        </div>
      </header>
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
            <label className="upload">
              Upload files
              <input
                hidden
                multiple
                type="file"
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
          </div>
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
                    <strong>Processing film for streaming…</strong>
                    <small>
                      {uploading} · {formatElapsed(elapsedSeconds)} elapsed
                      {muxProgress.state
                        ? ` · ${formatMuxState(muxProgress.state)}`
                        : ""}
                      {muxProgress.percentage !== null &&
                      muxProgress.percentage > 0 &&
                      muxProgress.percentage < 100
                        ? ` · ${Math.round(muxProgress.percentage)}%`
                        : ""}
                    </small>
                    <small>Usually ready within a few minutes</small>
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
          <div className="gm-photos">
            {gallery.media
              .filter((x) => x.type === "photo")
              .map((p, i) => (
                <figure key={p.id}>
                  <img src={p.url} />
                  {i === 0 && <span>Cover</span>}
                  <button
                    onClick={() =>
                      set(
                        "media",
                        gallery.media.filter((x) => x.id !== p.id),
                      )
                    }
                  >
                    ×
                  </button>
                </figure>
              ))}
          </div>
          {gallery.media
            .filter((x) => x.type === "video")
            .map((v) => (
              <p
                className={`film ${!v.playbackId ? "is-processing" : ""}`}
                key={v.id}
              >
                {!v.playbackId && (
                  <b className="processing-spinner" aria-hidden="true" />
                )}
                {v.playbackId ? "▶" : ""} {v.title}
                {!v.playbackId && (
                  <small>
                    {formatMuxState(videoStates[v.id] || "preparing")} in the
                    background · Safe to close this page
                  </small>
                )}
                <button
                  onClick={() =>
                    set(
                      "media",
                      gallery.media.filter((x) => x.id !== v.id),
                    )
                  }
                >
                  Remove
                </button>
              </p>
            ))}
        </article>
        {gallery.slug && (
          <article className="danger-zone">
            <div>
              <small>Permanent action</small>
              <h2>Delete this gallery</h2>
              <p>
                Remove the gallery and all of its uploaded photos and films
                from storage.
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
