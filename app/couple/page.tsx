"use client";

import MuxPlayer from "@mux/mux-player-react";
import { useEffect, useState } from "react";

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
  if (view === "photos")
    return (
      <main className="dynamic-photos">
        <DynamicHeader names={names} back={() => setView("home")} />
        <section className="dynamic-heading">
          <small>A wedding in photographs</small>
          <h1>{names}</h1>
          <p>{gallery.location}</p>
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
            onClick={() => setActivePhoto(null)}
          >
            <button
              className="dynamic-close"
              onClick={() => setActivePhoto(null)}
            >
              ×
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActivePhoto(
                  (activePhoto - 1 + photos.length) % photos.length,
                );
              }}
            >
              ←
            </button>
            <img
              onClick={(e) => e.stopPropagation()}
              src={photos[activePhoto].url!}
              alt={photos[activePhoto].alt}
            />
            <a
              className="original-download"
              href={`${API}/api/download?key=${encodeURIComponent(photos[activePhoto].originalKey)}`}
            >
              Download original
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActivePhoto((activePhoto + 1) % photos.length);
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
        <DynamicHeader names={names} back={() => setView("home")} />
        <section className="dynamic-film-copy">
          <small>A wedding story</small>
          <h1>{names}</h1>
          <p>{gallery.location}</p>
        </section>
        <section className="dynamic-film-rail">
          {films.map((film, index) => (
            <button key={film.id} onClick={() => setActiveFilm(index)}>
              <img
                src={
                  film.posterUrl ||
                  `https://image.mux.com/${film.playbackId}/thumbnail.webp?width=900&fit_mode=smartcrop`
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
          <button disabled={!photos.length} onClick={() => setView("photos")}>
            Photography <b>↗</b>
          </button>
          <button disabled={!films.length} onClick={() => setView("films")}>
            Films <b>↗</b>
          </button>
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
