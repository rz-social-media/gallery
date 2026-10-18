"use client";

import MuxPlayer from "@mux/mux-player-react";
import FilmPlayer from "../components/FilmPlayer";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const API = "https://rz-gallery-media-api.galfadlon2.workers.dev";
type Media = {
  id: string;
  type: "photo" | "video";
  url: string | null;
  playbackId: string | null;
  posterUrl?: string | null;
  title: string;
  alt: string;
  originalKey: string;
  filename: string;
};
type Gallery = {
  slug: string;
  partnerOne: string;
  partnerTwo: string;
  location: string;
  weddingDate: string;
  updatedAt?: string;
  note: string;
  computerCoverUrl?: string;
  phoneCoverUrl?: string;
  featuredVideoId?: string;
  media: Media[];
};

export default function CoupleGallery() {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"home" | "photos" | "films">("home");
  const [activePhoto, setActivePhoto] = useState<number | null>(null);
  const [activeFilm, setActiveFilm] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [sharePreparing, setSharePreparing] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState<"idle" | "preparing" | "started">("idle");
  const [sharedPhotoIds, setSharedPhotoIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const wheelLocked = useRef(false);
  const filmRail = useRef<HTMLElement | null>(null);
  const fullscreenRequested = useRef(false);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [gesturing, setGesturing] = useState(false);
  const photoImage = useRef<HTMLImageElement | null>(null);
  const gesture = useRef<{
    mode: "none" | "swipe" | "pan" | "pinch";
    startX: number;
    startY: number;
    startTime: number;
    startPan: { x: number; y: number };
    startZoom: number;
    startDistance: number;
    startMid: { x: number; y: number };
    moved: boolean;
    multi: boolean;
  }>({ mode: "none", startX: 0, startY: 0, startTime: 0, startPan: { x: 0, y: 0 }, startZoom: 1, startDistance: 1, startMid: { x: 0, y: 0 }, moved: false, multi: false });
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const preview = params.get("preview");
    setSharedPhotoIds((params.get("photos") || "").split(",").filter(Boolean).slice(0, 10));
    const initialView = window.location.hash.replace("#", "");
    if (initialView === "photos" || initialView === "films") {
      window.history.replaceState({ view: "home" }, "", `${window.location.pathname}${window.location.search}`);
      window.history.pushState({ view: initialView }, "", `#${initialView}`);
      setView(initialView);
    }
    if (!id) {
      setError("Gallery link is incomplete.");
      return;
    }
    fetch(`${API}/api/galleries/${encodeURIComponent(id)}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("This gallery is not available yet.");
        return r.json();
      })
      .then((data) => {
        setGallery(data);
        if (!preview)
          void fetch(`${API}/api/analytics/${encodeURIComponent(id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "view" }),
          });
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const onPopState = () => {
      const next = window.location.hash.replace("#", "");
      setView(next === "photos" || next === "films" ? next : "home");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (activePhoto === null || !gallery) return;
    const photoCount = gallery.media.filter(
      (item) => item.type === "photo" && item.url,
    ).length;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePhoto(null);
      if (event.key === "ArrowRight" || event.key === "ArrowDown")
        setActivePhoto((current) =>
          current === null ? null : (current + 1) % photoCount,
        );
      if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        setActivePhoto((current) =>
          current === null ? null : (current - 1 + photoCount) % photoCount,
        );
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [activePhoto, gallery]);
  if (error)
    return (
      <main className="dynamic-message">
        <span className="brand-seal">RZ</span>
        <h1>Gallery unavailable</h1>
        <p>{error}</p>
      </main>
    );
  if (!gallery)
    return (
      <main className="gallery-loading-screen" aria-label="Loading gallery">
        <span className="gallery-loading-mark" aria-hidden="true">
          <span>RZ</span>
          <span>RZ</span>
        </span>
        <span className="visually-hidden">Loading gallery</span>
      </main>
    );
  const allPhotos = gallery.media.filter((m) => m.type === "photo" && m.url);
  const photos = sharedPhotoIds.length
    ? allPhotos.filter((photo) => sharedPhotoIds.includes(photo.id))
    : allPhotos;
  const films = gallery.media.filter((m) => m.type === "video" && m.playbackId);
  const featuredFilm =
    films.find((film) => film.id === gallery.featuredVideoId) || films[0];
  const names = `${gallery.partnerOne} & ${gallery.partnerTwo}`;
  const automaticCover =
    photos[0]?.url ||
    gallery.media.find((item) => item.type === "video" && item.posterUrl)
      ?.posterUrl;
  const computerCover =
    gallery.computerCoverUrl || gallery.phoneCoverUrl || automaticCover;
  const phoneCover =
    gallery.phoneCoverUrl || gallery.computerCoverUrl || automaticCover;
  const coverStyle = {
    "--gallery-cover-computer": computerCover
      ? `url("${computerCover}")`
      : "none",
    "--gallery-cover-phone": phoneCover ? `url("${phoneCover}")` : "none",
  } as CSSProperties;
  const sharedIdsSuffix = sharedPhotoIds.length
    ? `&ids=${encodeURIComponent(sharedPhotoIds.join(","))}`
    : "";
  const downloadUrl = (type: "all" | "photos" | "videos") =>
    `${API}/api/galleries/${encodeURIComponent(gallery.slug)}/download?type=${type}${type === "photos" ? sharedIdsSuffix : ""}`;
  const mobileDownloadUrl = (type: "all" | "photos" | "videos") =>
    `${API}/api/galleries/${encodeURIComponent(gallery.slug)}/downloads?type=${type}${type === "photos" ? sharedIdsSuffix : ""}`;
  const startDownload = async (
    event: ReactMouseEvent<HTMLAnchorElement>,
    zipUrl: string,
    mobileUrl: string,
  ) => {
    event.preventDefault();
    if (downloadFeedback !== "idle") return;
    void fetch(`${API}/api/analytics/${encodeURIComponent(gallery.slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "download" }),
    }).catch(() => undefined);
    setDownloadFeedback("preparing");
    if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 760) {
      window.location.href = mobileUrl;
      window.setTimeout(() => setDownloadFeedback("idle"), 8000);
      return;
    }
    try {
      // HEAD runs the same preparation as the download and returns once the ZIP is ready to stream.
      await fetch(zipUrl, { method: "HEAD" });
    } catch {
      // Fall through: the real download will surface any error.
    }
    const link = document.createElement("a");
    link.href = zipUrl;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => setDownloadFeedback("started"), 900);
    window.setTimeout(() => setDownloadFeedback("idle"), 3200);
  };
  const downloadLabel = (fallback: string) =>
    downloadFeedback === "preparing"
      ? "Preparing…"
      : downloadFeedback === "started"
        ? "Download started"
        : fallback;
  const downloadToast = downloadFeedback !== "idle" && (
    <div className={`rz-download-toast is-${downloadFeedback}`} role="status" aria-live="polite">
      {downloadFeedback === "preparing" ? <span className="rz-download-spinner" aria-hidden="true" /> : <span className="rz-download-check" aria-hidden="true">✓</span>}
      <span>{downloadFeedback === "preparing" ? "Preparing your ZIP…" : "Your download has started"}</span>
    </div>
  );
  const shareUrl = `${API}/share/${encodeURIComponent(gallery.slug)}${gallery.updatedAt ? `?v=${encodeURIComponent(gallery.updatedAt)}` : ""}`;
  const shareGallery = async () => {
    if (navigator.share) {
      await navigator.share({ title: names, text: `${names} wedding gallery`, url: shareUrl });
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    window.alert("Gallery link copied");
  };
  const shareSelectedPhotos = async () => {
    const selected = photos.filter((photo) => selectedPhotos.includes(photo.id)).slice(0, 10);
    if (!selected.length) return;
    setSharePreparing(true);
    try {
      const files = await Promise.all(
        selected.map(async (photo) => {
          const response = await fetch(`${API}/api/download?key=${encodeURIComponent(photo.originalKey)}&name=${encodeURIComponent(photo.filename)}`);
          if (!response.ok) throw new Error("Could not prepare photo");
          const blob = await response.blob();
          return new File([blob], photo.filename, { type: blob.type || "image/jpeg" });
        }),
      );
      if (navigator.share && navigator.canShare?.({ files })) {
        await navigator.share({ files, title: `${names} photos` });
        return;
      }
      const selectedUrl = new URL(window.location.href);
      selectedUrl.hash = "photos";
      selectedUrl.searchParams.set("id", gallery.slug);
      selectedUrl.searchParams.set("photos", selected.map((photo) => photo.id).join(","));
      await navigator.clipboard.writeText(selectedUrl.href);
      window.alert("Selected photos link copied");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        window.alert("Could not prepare the selected photos. Please try fewer photos.");
    } finally {
      setSharePreparing(false);
    }
  };
  const savePhotoToDevice = async (photo: Media) => {
    try {
      const response = await fetch(`${API}/api/download?key=${encodeURIComponent(photo.originalKey)}&name=${encodeURIComponent(photo.filename)}`);
      if (!response.ok) throw new Error("Could not prepare photo");
      const blob = await response.blob();
      const file = new File([blob], photo.filename, { type: blob.type || "image/jpeg" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      window.location.href = `${API}/api/download?key=${encodeURIComponent(photo.originalKey)}&name=${encodeURIComponent(photo.filename)}`;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        window.location.href = `${API}/api/download?key=${encodeURIComponent(photo.originalKey)}&name=${encodeURIComponent(photo.filename)}`;
    }
  };
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  // Keeps the zoomed photo covering the screen instead of drifting off-edge.
  const clampPan = (next: { x: number; y: number }, scale: number) => {
    const image = photoImage.current;
    if (!image || scale <= 1) return { x: 0, y: 0 };
    const maxX = Math.max(0, (image.offsetWidth * scale - window.innerWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * scale - window.innerHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  };
  // Zoom so the point under (clientX, clientY) stays under the finger.
  const zoomAt = (scale: number, clientX: number, clientY: number, from = { zoom, pan }) => {
    const next = Math.min(5, Math.max(1, scale));
    const cx = clientX - window.innerWidth / 2;
    const cy = clientY - window.innerHeight / 2;
    const ratio = next / from.zoom;
    setZoom(next);
    setPan(clampPan({ x: cx - (cx - from.pan.x) * ratio, y: cy - (cy - from.pan.y) * ratio }, next));
  };
  const openPhoto = (index: number) => {
    resetZoom();
    setActivePhoto(index);
    if (!sessionStorage.getItem("rz-swipe-hint")) setShowSwipeHint(true);
  };
  const openView = (next: "photos" | "films") => {
    window.history.pushState({ view: next }, "", `#${next}`);
    setView(next);
  };
  const backHome = () => {
    if (window.location.hash) window.history.back();
    else setView("home");
  };
  const changePhoto = (direction: -1 | 1) => {
    setSwipeOffset(0);
    resetZoom();
    setActivePhoto((current) =>
      current === null
        ? null
        : (current + direction + photos.length) % photos.length,
    );
  };
  const closeFilm = () => setActiveFilm(null);
  const openFilm = (index: number) => {
    fullscreenRequested.current =
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 760;
    setActiveFilm(index);
    void fetch(`${API}/api/analytics/${encodeURIComponent(gallery.slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "play" }),
    }).catch(() => undefined);
  };
  if (view === "photos")
    return (
      <main className="dynamic-photos">
        {downloadToast}
        <DynamicHeader names={names} back={backHome} />
        <section className="photo-utility-bar" aria-label="Photography actions">
          <span><Icon name="photo" /> Photography</span>
          <div className="photo-page-actions">
            <button
              className={selectionMode ? "is-active" : ""}
              onClick={() => {
                setSelectionMode((current) => !current);
                setSelectedPhotos([]);
              }}
            >
              <Icon name="select" /> {selectionMode ? "Cancel selection" : "Select photos"}
            </button>
            <a
              className="page-download-all"
              href={downloadUrl("photos")}
              onClick={(event) => void startDownload(event, downloadUrl("photos"), mobileDownloadUrl("photos"))}
            >
              <Icon name="download" /> {downloadLabel("Download all photos")}
            </a>
          </div>
        </section>
        <JustifiedPhotoGrid
          photos={photos}
          names={names}
          openPhoto={openPhoto}
          selectionMode={selectionMode}
          selectedPhotos={selectedPhotos}
          togglePhoto={(id) =>
            setSelectedPhotos((current) =>
              current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id],
            )
          }
          savePhoto={savePhotoToDevice}
        />
        {selectionMode && selectedPhotos.length > 0 && (
          <aside className="selection-tray">
            <span>{selectedPhotos.length} selected</span>
            <button onClick={() => void shareSelectedPhotos()} disabled={sharePreparing}>
              <Icon name="share" /> {sharePreparing ? "Preparing share…" : "Share selected"}
            </button>
            <a
              href={`${downloadUrl("photos")}&ids=${encodeURIComponent(selectedPhotos.join(","))}`}
              onClick={(event) =>
                void startDownload(
                  event,
                  `${downloadUrl("photos")}&ids=${encodeURIComponent(selectedPhotos.join(","))}`,
                  `${mobileDownloadUrl("photos")}&ids=${encodeURIComponent(selectedPhotos.join(","))}`,
                )
              }
            >
              <Icon name="download" /> {downloadLabel("Download selected")}
            </a>
          </aside>
        )}
        {activePhoto !== null && (
          <div
            className="dynamic-lightbox rzl"
            role="dialog"
            aria-modal="true"
            aria-label={`${names} photo viewer`}
            onClick={(event) => {
              if ((event.nativeEvent as PointerEvent).pointerType === "touch" || window.matchMedia("(pointer: coarse)").matches) return;
              setActivePhoto(null);
            }}
            onWheel={(event) => {
              event.stopPropagation();
              if (
                wheelLocked.current ||
                Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) < 18
              )
                return;
              wheelLocked.current = true;
              const delta =
                Math.abs(event.deltaX) > Math.abs(event.deltaY)
                  ? event.deltaX
                  : event.deltaY;
              changePhoto(delta > 0 ? 1 : -1);
              window.setTimeout(() => (wheelLocked.current = false), 420);
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") return;
              if ((event.target as HTMLElement).closest("button, a")) return;
              touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Capture is a nicety; gestures still work without it.
              }
              const g = gesture.current;
              if (touchPoints.current.size === 2) {
                const [first, second] = [...touchPoints.current.values()];
                g.mode = "pinch";
                g.multi = true;
                g.startDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
                g.startMid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
                g.startZoom = zoom;
                g.startPan = pan;
                setSwipeOffset(0);
                setGesturing(true);
                setShowSwipeHint(false);
                sessionStorage.setItem("rz-swipe-hint", "seen");
              } else if (touchPoints.current.size === 1) {
                g.mode = zoom > 1 ? "pan" : "swipe";
                g.startX = event.clientX;
                g.startY = event.clientY;
                g.startTime = Date.now();
                g.startPan = pan;
                g.moved = false;
                g.multi = false;
              }
            }}
            onPointerMove={(event) => {
              if (!touchPoints.current.has(event.pointerId)) return;
              touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              const g = gesture.current;
              if (g.mode === "pinch" && touchPoints.current.size >= 2) {
                const [first, second] = [...touchPoints.current.values()];
                const distance = Math.hypot(second.x - first.x, second.y - first.y);
                const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
                const next = Math.min(5, Math.max(1, (g.startZoom * distance) / g.startDistance));
                const cx = g.startMid.x - window.innerWidth / 2;
                const cy = g.startMid.y - window.innerHeight / 2;
                const ratio = next / g.startZoom;
                setZoom(next);
                setPan(clampPan({
                  x: cx - (cx - g.startPan.x) * ratio + (mid.x - g.startMid.x),
                  y: cy - (cy - g.startPan.y) * ratio + (mid.y - g.startMid.y),
                }, next));
                return;
              }
              const dx = event.clientX - g.startX;
              const dy = event.clientY - g.startY;
              if (Math.hypot(dx, dy) > 8) g.moved = true;
              if (g.mode === "pan") {
                setGesturing(true);
                setPan(clampPan({ x: g.startPan.x + dx, y: g.startPan.y + dy }, zoom));
              } else if (g.mode === "swipe" && Math.abs(dx) > Math.abs(dy)) {
                setSwipeOffset(dx);
              }
            }}
            onPointerUp={(event) => {
              if (!touchPoints.current.has(event.pointerId)) return;
              touchPoints.current.delete(event.pointerId);
              const g = gesture.current;
              if (touchPoints.current.size > 0) {
                // One finger lifted mid-pinch: continue as a pan with the remaining finger.
                const [rest] = [...touchPoints.current.values()];
                g.mode = zoom > 1 ? "pan" : "none";
                g.startX = rest.x;
                g.startY = rest.y;
                g.startPan = pan;
                return;
              }
              setGesturing(false);
              const dx = event.clientX - g.startX;
              const dy = event.clientY - g.startY;
              const mode = g.mode;
              g.mode = "none";
              if (zoom < 1.05) resetZoom();
              if (mode === "swipe") {
                if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
                  changePhoto(dx < 0 ? 1 : -1);
                  return;
                }
                setSwipeOffset(0);
              }
              if (g.multi || g.moved || Date.now() - g.startTime > 300) return;
              // Tap handling: double tap zooms at the finger, single tap on the backdrop closes.
              const now = Date.now();
              const previous = lastTap.current;
              if (previous && now - previous.time < 300 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 40) {
                if (tapTimer.current) window.clearTimeout(tapTimer.current);
                lastTap.current = null;
                if (zoom > 1) resetZoom();
                else zoomAt(2.5, event.clientX, event.clientY, { zoom: 1, pan: { x: 0, y: 0 } });
                setShowSwipeHint(false);
                sessionStorage.setItem("rz-swipe-hint", "seen");
                return;
              }
              lastTap.current = { time: now, x: event.clientX, y: event.clientY };
              const onImage = event.target === photoImage.current;
              if (!onImage && zoom === 1) {
                tapTimer.current = window.setTimeout(() => setActivePhoto(null), 300);
              }
            }}
            onPointerCancel={() => {
              touchPoints.current.clear();
              gesture.current.mode = "none";
              setGesturing(false);
              setSwipeOffset(0);
            }}
          >
            <button
              className="dynamic-close"
              onClick={() => setActivePhoto(null)}
              aria-label="Close photo viewer"
            >
              <svg className="rzl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button
              className="lightbox-arrow is-previous"
              aria-label="Previous photo"
              onClick={(e) => {
                e.stopPropagation();
                changePhoto(-1);
              }}
            >
              <svg className="rzl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4l-8 8 8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <img
              ref={photoImage}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (window.matchMedia("(pointer: coarse)").matches) return;
                if (zoom > 1) resetZoom();
                else zoomAt(2.5, e.clientX, e.clientY, { zoom: 1, pan: { x: 0, y: 0 } });
                setShowSwipeHint(false);
                sessionStorage.setItem("rz-swipe-hint", "seen");
              }}
              src={photos[activePhoto].url!}
              alt={photos[activePhoto].alt}
              draggable={false}
              style={{
                transform: `translate3d(${pan.x + swipeOffset}px, ${pan.y}px, 0) scale(${zoom * (swipeOffset ? 0.985 : 1)})`,
                opacity: swipeOffset ? Math.max(0.55, 1 - Math.abs(swipeOffset) / 500) : 1,
                transition: swipeOffset || gesturing ? "none" : undefined,
                cursor: zoom > 1 ? "grab" : "zoom-in",
              }}
            />
            {showSwipeHint && (
              <button
                className="swipe-hint"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowSwipeHint(false);
                  sessionStorage.setItem("rz-swipe-hint", "seen");
                }}
              >
                Swipe to explore · Pinch to zoom
              </button>
            )}
            <div className="zoom-controls">
              <button onClick={(event) => { event.stopPropagation(); zoomAt(zoom - 0.5, window.innerWidth / 2, window.innerHeight / 2); }} aria-label="Zoom out">−</button>
              <button onClick={(event) => { event.stopPropagation(); zoomAt(zoom + 0.5, window.innerWidth / 2, window.innerHeight / 2); }} aria-label="Zoom in">＋</button>
            </div>
            {[1, -1].map((offset) => {
              const preloadIndex =
                (activePhoto + offset + photos.length) % photos.length;
              return (
                <link
                  key={offset}
                  rel="preload"
                  as="image"
                  href={photos[preloadIndex].url!}
                />
              );
            })}
            <span className="lightbox-count">
              {String(activePhoto + 1).padStart(2, "0")} /{" "}
              {String(photos.length).padStart(2, "0")}
            </span>
            <a
              className="original-download rzl-download"
              onClick={(event) => event.stopPropagation()}
              href={`${API}/api/download?key=${encodeURIComponent(photos[activePhoto].originalKey)}&name=${encodeURIComponent(photos[activePhoto].filename)}`}
            >
              <FilmIcon name="cloud" /> Download original
            </a>
            <button
              className="lightbox-arrow is-next"
              aria-label="Next photo"
              onClick={(e) => {
                e.stopPropagation();
                changePhoto(1);
              }}
            >
              <svg className="rzl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        )}
        <MobileActionBar back={backHome} share={shareGallery} download={mobileDownloadUrl("photos")} />
      </main>
    );
  if (view === "films")
    return (
      <main className="rzf">
        {downloadToast}
        {featuredFilm?.playbackId && (
          <MuxPlayer
            className="rzf-background"
            playbackId={featuredFilm.playbackId}
            defaultHiddenCaptions
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
            maxResolution="2160p"
            maxAutoResolution="2160p"
            renditionOrder="desc"
            capRenditionToPlayerSize={false}
            initialBandwidthEstimateKbps={50000}
            title={`${names} background film`}
          />
        )}
        <div className="rzf-shade" />
        <header className="rzf-header">
          <button className="rzf-brand" onClick={backHome} aria-label="Back to gallery">
            <span className="rzf-seal">RZ</span>
            <span className="rzf-brand-name">RZ.SOCIAL.MEDIA</span>
          </button>
          <div className="rzf-actions">
            <a
              className="rzf-circle"
              href={downloadUrl("videos")}
              onClick={(event) => void startDownload(event, downloadUrl("videos"), mobileDownloadUrl("videos"))}
              aria-label="Download all films"
              title="Download all films"
            >
              <FilmIcon name="cloud" />
            </a>
            <button className="rzf-circle" onClick={() => void shareGallery()} aria-label="Share gallery" title="Share">
              <FilmIcon name="share" />
            </button>
          </div>
        </header>
        <section className="rzf-copy">
          <h1>{names}</h1>
          <button className="rzf-play-all" onClick={() => openFilm(0)}>
            <FilmIcon name="playCircle" /> PLAY ALL
          </button>
        </section>
        <div className="rzf-rail-wrap">
          <section className="rzf-rail" ref={filmRail}>
            {films.map((film, index) => (
              <article
                key={film.id}
                className="rzf-card"
              >
                <button onClick={() => openFilm(index)} aria-label={`Play ${film.title || "wedding film"}`}>
                  <img
                    src={
                      film.posterUrl ||
                      `https://image.mux.com/${film.playbackId}/thumbnail.webp?time=0&width=900&fit_mode=smartcrop`
                    }
                    alt=""
                  />
                  <span className="rzf-card-shade" />
                  <span className="rzf-card-play"><FilmIcon name="play" /></span>
                  <span className="rzf-card-copy">
                    <strong>{film.title || "Wedding film"}</strong>
                    <small><FilmIcon name="play" /> PLAY FILM</small>
                  </span>
                </button>
              </article>
            ))}
          </section>
          {films.length > 3 && (
            <button
              className="rzf-next"
              aria-label="More films"
              onClick={() => filmRail.current?.scrollBy({ left: filmRail.current.clientWidth * .72, behavior: "smooth" })}
            >
              <FilmIcon name="chevron" />
            </button>
          )}
        </div>
        {activeFilm !== null && (
          <FilmPlayer
            key={films[activeFilm].id}
            playbackId={films[activeFilm].playbackId!}
            title={films[activeFilm].title || "Wedding film"}
            downloadUrl={`${API}/api/download?key=${encodeURIComponent(films[activeFilm].originalKey)}&name=${encodeURIComponent(films[activeFilm].filename)}`}
            requestFullscreen={fullscreenRequested.current}
            onClose={closeFilm}
            onEnded={() =>
              setActiveFilm((current) =>
                current === null || current >= films.length - 1 ? null : current + 1,
              )
            }
          />
        )}
        <MobileActionBar back={backHome} share={shareGallery} download={mobileDownloadUrl("videos")} />
      </main>
    );
  return (
    <main className="dynamic-home">
        {downloadToast}
      <div
        className="dynamic-cover"
        style={coverStyle}
      />
      <div className="dynamic-shade" />
      <header>
        <div><span className="brand-seal">RZ</span><span>Private wedding gallery</span></div>
        <a
          className="home-top-download"
          href={downloadUrl("all")}
          onClick={(event) => void startDownload(event, downloadUrl("all"), mobileDownloadUrl("all"))}
        >
          <Icon name="download" /> {downloadLabel("Download all")}
        </a>
      </header>
      <section>
        <small>Welcome to the wedding of</small>
        <h1>
          {gallery.partnerOne}
          <em>&</em>
          {gallery.partnerTwo}
        </h1>
        <p>{gallery.note}</p>
        <p className="gallery-meta">{[gallery.weddingDate, gallery.location].filter(Boolean).join(" · ")}</p>
        <div>
          <button disabled={!photos.length} onClick={() => openView("photos")}>
            <Icon name="photo" /> <span>Photography<small>{photos.length} photos</small></span> <b>↗</b>
          </button>
          <button disabled={!films.length} onClick={() => openView("films")}>
            <Icon name="film" /> <span>Films<small>{films.length} films</small></span> <b>↗</b>
          </button>
        </div>
      </section>
      <button className="home-share" onClick={() => void shareGallery()}><Icon name="share" /> Share</button>
    </main>
  );
}

function JustifiedPhotoGrid({
  photos,
  names,
  openPhoto,
  selectionMode,
  selectedPhotos,
  togglePhoto,
  savePhoto,
}: {
  photos: Media[];
  names: string;
  openPhoto: (index: number) => void;
  selectionMode: boolean;
  selectedPhotos: string[];
  togglePhoto: (id: string) => void;
  savePhoto: (photo: Media) => Promise<void>;
}) {
  const container = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(1200);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const columnCount = width <= 700 ? 2 : 3;
  const columns: Array<{ height: number; items: Array<{ photo: Media; index: number; ratio: number }> }> =
    Array.from({ length: columnCount }, () => ({ height: 0, items: [] }));
  photos.forEach((photo, index) => {
    const ratio = ratios[photo.id] || 1.45;
    const shortest = columns.reduce((min, column) => (column.height < min.height ? column : min), columns[0]);
    shortest.items.push({ photo, index, ratio });
    shortest.height += 1 / ratio;
  });
  return (
    <section className="dynamic-photo-grid" ref={container}>
      {columns.map((column, columnIndex) => (
        <div className="masonry-column" key={columnIndex}>
          {column.items.map(({ photo, index, ratio }) => (
            <article
              className={`public-photo-tile ${selectedPhotos.includes(photo.id) ? "is-selected" : ""}`}
              key={photo.id}
              style={{ aspectRatio: String(ratio) }}
            >
              <button onClick={() => selectionMode ? togglePhoto(photo.id) : openPhoto(index)}>
                <img
                  src={photo.url!}
                  alt={photo.alt || `${names} photograph ${index + 1}`}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    image.dataset.loaded = "true";
                    const nextRatio = image.naturalWidth / image.naturalHeight;
                    setRatios((currentRatios) =>
                      currentRatios[photo.id] === nextRatio
                        ? currentRatios
                        : { ...currentRatios, [photo.id]: nextRatio },
                    );
                  }}
                />
              </button>
              {selectionMode && <b className="selection-check">{selectedPhotos.includes(photo.id) ? "✓" : ""}</b>}
              <span>{String(index + 1).padStart(2, "0")}</span>
              <a
                className="media-card-download"
                href={`${API}/api/download?key=${encodeURIComponent(photo.originalKey)}&name=${encodeURIComponent(photo.filename)}`}
                aria-label={`Download ${photo.filename}`}
                title="Download photo"
                onClick={(event) => {
                  if (window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 760) {
                    event.preventDefault();
                    void savePhoto(photo);
                  }
                }}
              >
                ↓
              </a>
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}
function MobileActionBar({ back, share, download }: { back: () => void; share: () => Promise<void>; download: string }) {
  return (
    <nav className="mobile-action-bar" aria-label="Gallery actions">
      <button onClick={back}><Icon name="back" /> Gallery</button>
      <button onClick={() => void share()}><Icon name="share" /> Share</button>
      <a href={download}><Icon name="download" /> Download</a>
    </nav>
  );
}
function Icon({ name }: { name: "photo" | "film" | "download" | "share" | "back" | "select" | "play" }) {
  const paths = {
    photo: <><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-4 3 2 4-4 6 6"/></>,
    film: <><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 5v14M16 5v14M3 10h5M16 10h5M3 15h5M16 15h5"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/></>,
    share: <><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    select: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/></>,
    play: <path d="m9 7 8 5-8 5Z" fill="currentColor" stroke="none"/>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
function FilmIcon({ name }: { name: "cloud" | "share" | "playCircle" | "play" | "chevron" }) {
  if (name === "chevron")
    return <svg className="rzf-icon" viewBox="0 0 24 40" aria-hidden="true"><path d="M5 4l15 16L5 36" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (name === "playCircle")
    return <svg className="rzf-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#fff"/><path d="M9.6 7.4v9.2l7.2-4.6z" fill="currentColor"/></svg>;
  const paths = {
    cloud: "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.240 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z",
    share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.250.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z",
    play: "M7 4.5v15l12.5-7.5z",
  };
  return <svg className="rzf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} fill="currentColor"/></svg>;
}
function DynamicHeader({ names, back, action }: { names: string; back: () => void; action?: ReactNode }) {
  return (
    <header className="dynamic-topbar">
      <button onClick={back}>
        <span className="brand-seal">RZ</span>
        <span>
          <strong>RZ Weddings</strong>
          <small>{names}</small>
        </span>
      </button>
      {action}
    </header>
  );
}
