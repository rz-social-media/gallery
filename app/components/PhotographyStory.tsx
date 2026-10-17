"use client";

import { useEffect, useState } from "react";
import type { WeddingStory } from "../stories";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const assetUrl = (url: string) => url.startsWith("/") ? `${publicBasePath}${url}` : url;

export default function PhotographyStory({ story }: { story: WeddingStory }) {
  const [activePhoto, setActivePhoto] = useState<number | null>(null);
  const [shareLabel, setShareLabel] = useState("Share");

  useEffect(() => {
    if (activePhoto === null) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setActivePhoto(null);
    const moveThroughGallery = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setActivePhoto((activePhoto + 1) % story.photos.length);
      if (event.key === "ArrowLeft") setActivePhoto((activePhoto - 1 + story.photos.length) % story.photos.length);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("keydown", moveThroughGallery);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("keydown", moveThroughGallery);
    };
  }, [activePhoto, story.photos.length]);

  const sharePage = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `RZ Weddings — ${story.names}`, text: `View ${story.names}'s wedding photographs.`, url: window.location.href });
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      setShareLabel("Copied");
      window.setTimeout(() => setShareLabel("Share"), 1600);
    } catch {
      setShareLabel("Share");
    }
  };

  return (
    <main className="photo-story">
      <header className="photo-topbar">
        <a className="brand" href={`${publicBasePath}/`} aria-label="Back to RZ Weddings Gallery">
          <span className="brand-seal">RZ</span>
          <span className="brand-copy"><strong>RZ Weddings</strong><small>Gallery</small></span>
        </a>
        <div className="top-actions">
          <a className="top-action back-action" href={`${publicBasePath}/photography/`}><span aria-hidden="true">←</span> Photography</a>
          <button className="top-action" onClick={sharePage} type="button">{shareLabel}</button>
        </div>
      </header>

      <section className="photo-heading">
        <p className="eyebrow">A wedding in photographs</p>
        <h1>{story.names}</h1>
        <p>{story.location}</p>
      </section>

      <section className="photo-grid" aria-label={`${story.names} wedding photographs`}>
        {story.photos.map((photo, index) => (
          <button className={`photo-tile is-${photo.orientation}`} key={`${photo.src}-${index}`} onClick={() => setActivePhoto(index)} type="button" aria-label={`Open photograph ${index + 1} of ${story.photos.length}`}>
            <img alt={photo.alt} loading={index > 2 ? "lazy" : "eager"} src={assetUrl(photo.src)} />
            <span>{String(index + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </section>

      {activePhoto !== null && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Photograph ${activePhoto + 1} of ${story.photos.length}`} onClick={() => setActivePhoto(null)}>
          <button className="close-player" onClick={() => setActivePhoto(null)} type="button" aria-label="Close photograph"><span aria-hidden="true">×</span></button>
          <button className="lightbox-arrow is-previous" onClick={(event) => { event.stopPropagation(); setActivePhoto((activePhoto - 1 + story.photos.length) % story.photos.length); }} type="button" aria-label="Previous photograph">←</button>
          <img alt={story.photos[activePhoto].alt} onClick={(event) => event.stopPropagation()} src={assetUrl(story.photos[activePhoto].src)} />
          <button className="lightbox-arrow is-next" onClick={(event) => { event.stopPropagation(); setActivePhoto((activePhoto + 1) % story.photos.length); }} type="button" aria-label="Next photograph">→</button>
          <p>{String(activePhoto + 1).padStart(2, "0")} / {String(story.photos.length).padStart(2, "0")}</p>
        </div>
      )}
    </main>
  );
}
