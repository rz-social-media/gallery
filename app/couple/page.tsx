"use client";

import MuxPlayer from "@mux/mux-player-react";
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
  note: string;
  media: Media[];
};

export default function CoupleGallery() {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"home" | "photos" | "films">("home");
  const [activePhoto, setActivePhoto] = useState<number | null>(null);
  const [activeFilm, setActiveFilm] = useState<number | null>(null);
  const wheelLocked = useRef(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      setError("Gallery link is incomplete.");
      return;
    }
    fetch(`${API}/api/galleries/${encodeURIComponent(id)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("This gallery is not available yet.");
        return r.json();
      })
      .then(setGallery)
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
      <main className="dynamic-message">
        <span className="brand-seal">RZ</span>
        <p>Preparing your gallery…</p>
      </main>
    );
  const photos = gallery.media.filter((m) => m.type === "photo" && m.url);
  const films = gallery.media.filter((m) => m.type === "video" && m.playbackId);
  const names = `${gallery.partnerOne} & ${gallery.partnerTwo}`;
  const cover = photos[0]?.url;
  const downloadUrl = (type: "all" | "photos" | "videos") =>
    `${API}/api/galleries/${encodeURIComponent(gallery.slug)}/download?type=${type}`;
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
    setActivePhoto((current) =>
      current === null
        ? null
        : (current + direction + photos.length) % photos.length,
    );
  };
  if (view === "photos")
    return (
      <main className="dynamic-photos">
        <DynamicHeader names={names} back={backHome} />
        <section className="dynamic-heading">
          <small>A wedding in photographs</small>
          <h1>{names}</h1>
          <p>{gallery.location}</p>
          <a className="page-download-all" href={downloadUrl("photos")}>
            Download all photos ↓
          </a>
        </section>
        <section className="dynamic-photo-grid">
          {photos.map((photo, index) => (
            <button key={photo.id} onClick={() => setActivePhoto(index)}>
              <img
                src={photo.url!}
                alt={photo.alt || `${names} photograph ${index + 1}`}
              />
              <span>{String(index + 1).padStart(2, "0")}</span>
            </button>
          ))}
        </section>
        {activePhoto !== null && (
          <div
            className="dynamic-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`${names} photo viewer`}
            onClick={() => setActivePhoto(null)}
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
              swipeStart.current = { x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!swipeStart.current || event.pointerType === "mouse") return;
              const dx = event.clientX - swipeStart.current.x;
              const dy = event.clientY - swipeStart.current.y;
              if (Math.abs(dx) > Math.abs(dy)) setSwipeOffset(dx);
            }}
            onPointerUp={(event) => {
              if (!swipeStart.current || event.pointerType === "mouse") return;
              const dx = event.clientX - swipeStart.current.x;
              const dy = event.clientY - swipeStart.current.y;
              swipeStart.current = null;
              if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy))
                changePhoto(dx < 0 ? 1 : -1);
              else setSwipeOffset(0);
            }}
            onPointerCancel={() => {
              swipeStart.current = null;
              setSwipeOffset(0);
            }}
          >
            <button
              className="dynamic-close"
              onClick={() => setActivePhoto(null)}
              aria-label="Close photo viewer"
            >
              ×
            </button>
            <button
              className="lightbox-arrow is-previous"
              aria-label="Previous photo"
              onClick={(e) => {
                e.stopPropagation();
                changePhoto(-1);
              }}
            >
              ←
            </button>
            <img
              onClick={(e) => e.stopPropagation()}
              src={photos[activePhoto].url!}
              alt={photos[activePhoto].alt}
              draggable={false}
              style={{
                transform: `translateX(${swipeOffset}px) scale(${swipeOffset ? 0.985 : 1})`,
                opacity: swipeOffset ? Math.max(0.55, 1 - Math.abs(swipeOffset) / 500) : 1,
                transition: swipeOffset ? "none" : undefined,
              }}
            />
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
              className="original-download"
              href={`${API}/api/download?key=${encodeURIComponent(photos[activePhoto].originalKey)}`}
            >
              Download original
            </a>
            <button
              className="lightbox-arrow is-next"
              aria-label="Next photo"
              onClick={(e) => {
                e.stopPropagation();
                changePhoto(1);
              }}
            >
              →
            </button>
          </div>
        )}
      </main>
    );
  if (view === "films")
    return (
      <main
        className="dynamic-films"
        style={
          cover
            ? {
                backgroundImage: `linear-gradient(90deg,rgba(5,4,3,.82),rgba(5,4,3,.18)),url(${cover})`,
              }
            : undefined
        }
      >
        <DynamicHeader names={names} back={backHome} />
        <section className="dynamic-film-copy">
          <small>A wedding story</small>
          <h1>{names}</h1>
          <p>{gallery.location}</p>
          <a className="page-download-all" href={downloadUrl("videos")}>
            Download all films ↓
          </a>
        </section>
        <section className="dynamic-film-rail">
          {films.map((film, index) => (
            <button key={film.id} onClick={() => setActiveFilm(index)}>
              <img
                src={
                  film.posterUrl ||
                  `https://image.mux.com/${film.playbackId}/thumbnail.webp?time=0&width=900&fit_mode=smartcrop`
                }
                alt=""
              />
              <span>▶</span>
              <strong>{film.title || "Wedding film"}</strong>
            </button>
          ))}
        </section>
        {activeFilm !== null && (
          <div className="player-modal" onClick={() => setActiveFilm(null)}>
            <button
              className="close-player"
              onClick={() => setActiveFilm(null)}
            >
              ×
            </button>
            <div className="player-frame" onClick={(e) => e.stopPropagation()}>
              <MuxPlayer
                autoPlay
                playbackId={films[activeFilm].playbackId!}
                title={films[activeFilm].title}
                accentColor="#c4a274"
              />
              <a
                className="video-download"
                href={`${API}/api/download?key=${encodeURIComponent(films[activeFilm].originalKey)}`}
              >
                Download original film
              </a>
            </div>
          </div>
        )}
      </main>
    );
  return (
    <main className="dynamic-home">
      <div
        className="dynamic-cover"
        style={cover ? { backgroundImage: `url(${cover})` } : undefined}
      />
      <div className="dynamic-shade" />
      <header>
        <span className="brand-seal">RZ</span>
        <span>Private wedding gallery</span>
      </header>
      <section>
        <small>Welcome to the wedding of</small>
        <h1>
          {gallery.partnerOne}
          <em>&</em>
          {gallery.partnerTwo}
        </h1>
        <p>{gallery.note || gallery.location}</p>
        <div>
          <button disabled={!photos.length} onClick={() => openView("photos")}>
            Photography <b>↗</b>
          </button>
          <button disabled={!films.length} onClick={() => openView("films")}>
            Films <b>↗</b>
          </button>
          <a className="home-download-all" href={downloadUrl("all")}>
            Download all <b>↓</b>
          </a>
        </div>
      </section>
    </main>
  );
}
function DynamicHeader({ names, back }: { names: string; back: () => void }) {
  return (
    <header className="dynamic-topbar">
      <button onClick={back}>
        <span className="brand-seal">RZ</span>
        <span>
          <strong>RZ Weddings</strong>
          <small>{names}</small>
        </span>
      </button>
      <button onClick={back}>← Gallery</button>
    </header>
  );
}
