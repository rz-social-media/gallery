"use client";

import MuxPlayer from "@mux/mux-player-react";
import type { CSSProperties } from "react";
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
  computerCoverUrl?: string;
  phoneCoverUrl?: string;
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
  const downloadUrl = (type: "all" | "photos" | "videos") =>
    `${API}/api/galleries/${encodeURIComponent(gallery.slug)}/download?type=${type}`;
  const mobileDownloadUrl = (type: "all" | "photos" | "videos") =>
    `${API}/api/galleries/${encodeURIComponent(gallery.slug)}/downloads?type=${type}`;
  const adaptDownload = (
    event: React.MouseEvent<HTMLAnchorElement>,
    type: "all" | "photos" | "videos",
  ) => {
    if (
      window.matchMedia("(pointer: coarse)").matches ||
      window.innerWidth <= 760
    ) {
      event.preventDefault();
      window.location.href = mobileDownloadUrl(type);
    }
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
          <a
            className="page-download-all"
            href={downloadUrl("photos")}
            onClick={(event) => adaptDownload(event, "photos")}
          >
            Download all photos ↓
          </a>
        </section>
        <JustifiedPhotoGrid
          photos={photos}
          names={names}
          openPhoto={setActivePhoto}
        />
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
              href={`${API}/api/download?key=${encodeURIComponent(photos[activePhoto].originalKey)}&name=${encodeURIComponent(photos[activePhoto].filename)}`}
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
        style={coverStyle}
      >
        <div className="dynamic-film-cover" />
        <DynamicHeader names={names} back={backHome} />
        <section className="dynamic-film-copy">
          <small>A wedding story</small>
          <h1>{names}</h1>
          <p>{gallery.location}</p>
          <a
            className="page-download-all"
            href={downloadUrl("videos")}
            onClick={(event) => adaptDownload(event, "videos")}
          >
            Download all films ↓
          </a>
        </section>
        <section className="dynamic-film-rail">
          {films.map((film, index) => (
            <article key={film.id}>
              <button onClick={() => setActiveFilm(index)}>
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
              <a
                className="media-card-download"
                href={`${API}/api/download?key=${encodeURIComponent(film.originalKey)}&name=${encodeURIComponent(film.filename)}`}
                aria-label={`Download ${film.title || film.filename}`}
                title="Download film"
              >
                ↓
              </a>
            </article>
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
                href={`${API}/api/download?key=${encodeURIComponent(films[activeFilm].originalKey)}&name=${encodeURIComponent(films[activeFilm].filename)}`}
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
        style={coverStyle}
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
          <a
            className="home-download-all"
            href={downloadUrl("all")}
            onClick={(event) => adaptDownload(event, "all")}
          >
            Download all <b>↓</b>
          </a>
        </div>
      </section>
    </main>
  );
}

function JustifiedPhotoGrid({
  photos,
  names,
  openPhoto,
}: {
  photos: Media[];
  names: string;
  openPhoto: (index: number) => void;
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
  const gap = width <= 700 ? 7 : 12;
  const targetHeight = width <= 700 ? 190 : 290;
  const rows: Array<{
    height: number;
    items: Array<{ photo: Media; index: number; ratio: number }>;
  }> = [];
  let current: Array<{ photo: Media; index: number; ratio: number }> = [];
  let ratioSum = 0;
  let previousHeight = targetHeight;
  photos.forEach((photo, index) => {
    const ratio = ratios[photo.id] || 1.45;
    current.push({ photo, index, ratio });
    ratioSum += ratio;
    const height = (width - gap * (current.length - 1)) / ratioSum;
    if (height <= targetHeight) {
      previousHeight = Math.max(135, height);
      rows.push({ height: previousHeight, items: current });
      current = [];
      ratioSum = 0;
    }
  });
  if (current.length)
    rows.push({
      height: Math.min(previousHeight, targetHeight),
      items: current,
    });
  return (
    <section className="dynamic-photo-grid" ref={container}>
      {rows.map((row, rowIndex) => (
        <div className="justified-row" key={rowIndex} style={{ height: row.height }}>
          {row.items.map(({ photo, index, ratio }) => (
            <article
              className="public-photo-tile"
              key={photo.id}
              style={{ width: row.height * ratio }}
            >
              <button onClick={() => openPhoto(index)}>
                <img
                  src={photo.url!}
                  alt={photo.alt || `${names} photograph ${index + 1}`}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    const nextRatio = image.naturalWidth / image.naturalHeight;
                    setRatios((currentRatios) =>
                      currentRatios[photo.id] === nextRatio
                        ? currentRatios
                        : { ...currentRatios, [photo.id]: nextRatio },
                    );
                  }}
                />
              </button>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <a
                className="media-card-download"
                href={`${API}/api/download?key=${encodeURIComponent(photo.originalKey)}&name=${encodeURIComponent(photo.filename)}`}
                aria-label={`Download ${photo.filename}`}
                title="Download photo"
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
