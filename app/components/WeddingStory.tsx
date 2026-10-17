"use client";

import MuxPlayer from "@mux/mux-player-react";
import { useEffect, useState } from "react";
import type { WeddingStory as WeddingStoryData } from "../stories";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const thumbnail = (id: string, time: number, width = 1400) =>
  `https://image.mux.com/${id}/thumbnail.webp?time=${time}&width=${width}&fit_mode=smartcrop`;

const assetUrl = (url: string) => (url.startsWith("/") ? `${publicBasePath}${url}` : url);

export default function WeddingStory({ story }: { story: WeddingStoryData }) {
  const { videos } = story;
  const [activeVideo, setActiveVideo] = useState<number | null>(null);
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [shareLabel, setShareLabel] = useState("Share");

  useEffect(() => {
    if (activeVideo === null) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveVideo(null);
        setIsPlaylist(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeVideo]);

  const closePlayer = () => {
    setActiveVideo(null);
    setIsPlaylist(false);
  };

  const openVideo = (index: number, playlist = false) => {
    setIsPlaylist(playlist);
    setActiveVideo(index);
  };

  const handleVideoEnded = () => {
    if (isPlaylist && activeVideo !== null && activeVideo < videos.length - 1) {
      setActiveVideo(activeVideo + 1);
      return;
    }
    closePlayer();
  };

  const sharePage = async () => {
    const shareData = {
      title: `RZ Weddings — ${story.names}`,
      text: `Watch ${story.names}'s wedding videos.`,
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
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
    <main className="video-showcase">
      <img
        alt=""
        aria-hidden="true"
        className="hero-image"
        decoding="async"
        fetchPriority="high"
        src={assetUrl(story.heroImage)}
      />
      <div className="cinematic-shade" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href={`${publicBasePath}/`} aria-label="Back to RZ Weddings Gallery">
          <span className="brand-seal">RZ</span>
          <span className="brand-copy">
            <strong>RZ Weddings</strong>
            <small>Gallery</small>
          </span>
        </a>

        <div className="top-actions">
          <a className="top-action back-action" href={`${publicBasePath}/films/`}>
            <span aria-hidden="true">←</span> Films
          </a>
          <span className="quality-chip">4K</span>
          <button className="top-action" onClick={sharePage} type="button">
            {shareLabel}
          </button>
        </div>
      </header>

      <section className="hero-copy" aria-labelledby="wedding-title">
        <p className="eyebrow">A wedding story</p>
        <h1 id="wedding-title">{story.names}</h1>
        <p className="location">{story.location}</p>
        <button className="play-all" onClick={() => openVideo(0, true)} type="button">
          <span className="play-symbol" aria-hidden="true" />
          Play all
        </button>
      </section>

      <section className="film-rail" aria-label="Wedding videos">
        {videos.map((video, index) => (
          <button
            className="film-card"
            key={video.id}
            onClick={() => openVideo(index)}
            type="button"
            aria-label={`Play ${video.title}`}
          >
            <img
              alt=""
              decoding="async"
              loading="eager"
              src={
                video.coverImage
                  ? assetUrl(video.coverImage)
                  : thumbnail(video.id, video.thumbnailTime)
              }
            />
            <span className="card-shade" aria-hidden="true" />
            <span className="card-preview-play" aria-hidden="true">
              <span className="play-symbol" />
            </span>
            <span className="card-duration">{video.duration}</span>
            <span className="card-copy">
              <strong>{video.title}</strong>
              <small>
                <span className="mini-play" aria-hidden="true" /> Play video
              </small>
            </span>
          </button>
        ))}
      </section>

      {activeVideo !== null && (
        <div
          className="player-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${videos[activeVideo].title} video player`}
          onClick={closePlayer}
        >
          <button
            className="close-player"
            onClick={closePlayer}
            type="button"
            aria-label="Close video player"
          >
            <span aria-hidden="true">×</span>
          </button>

          <div className="player-frame" onClick={(event) => event.stopPropagation()}>
            <MuxPlayer
              accentColor="#c4a274"
              autoPlay
              key={videos[activeVideo].id}
              maxAutoResolution="2160p"
              minResolution="2160p"
              maxResolution="2160p"
              metadata={{
                video_id: videos[activeVideo].id,
                video_title: videos[activeVideo].title,
              }}
              onEnded={handleVideoEnded}
              playbackId={videos[activeVideo].id}
              poster={thumbnail(
                videos[activeVideo].id,
                videos[activeVideo].thumbnailTime,
                1800,
              )}
              primaryColor="#ffffff"
              secondaryColor="#2a1c14"
              title={videos[activeVideo].title}
            />
          </div>
        </div>
      )}
    </main>
  );
}
