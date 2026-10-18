"use client";

import "@mux/mux-video";
import {
  MediaControlBar,
  MediaController,
  MediaFullscreenButton,
  MediaLoadingIndicator,
  MediaMuteButton,
  MediaPlayButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaCastButton,
} from "media-chrome/react";
import { MediaRenditionMenu, MediaRenditionMenuButton } from "media-chrome/react/menu";
import { createElement, useEffect, useRef, type ComponentRef } from "react";

type Props = {
  playbackId: string;
  title: string;
  downloadUrl: string;
  requestFullscreen: boolean;
  onClose: () => void;
  onEnded: () => void;
};

const icons = {
  back: <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />,
  cloud: <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />,
  gear: <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />,
  bigPlay: <path d="M6 2.5v19L21 12z" />,
};
const Svg = ({ name, slot }: { name: keyof typeof icons; slot?: string }) => (
  <svg slot={slot} className="rzp-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{icons[name]}</svg>
);

export default function FilmPlayer({ playbackId, title, downloadUrl, requestFullscreen, onClose, onEnded }: Props) {
  const controller = useRef<ComponentRef<typeof MediaController> | null>(null);
  const video = useRef<(HTMLVideoElement & { playbackId?: string }) | null>(null);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const ended = () => onEndedRef.current();
    el.addEventListener("ended", ended);
    void el.play?.().catch(() => undefined);
    if (requestFullscreen) void controller.current?.requestFullscreen?.().catch(() => undefined);
    return () => el.removeEventListener("ended", ended);
  }, [playbackId, requestFullscreen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="rzp" role="dialog" aria-label={title}>
      <MediaController ref={controller} className="rzp-controller">
        {createElement("mux-video", {
          ref: video,
          slot: "media",
          "playback-id": playbackId,
          "metadata-video-title": title,
          "prefer-playback": "mse",
          "max-resolution": "2160p",
          "max-auto-resolution": "2160p",
          "rendition-order": "desc",
          "cap-rendition-to-player-size": "false",
          playsInline: true,
          crossOrigin: "anonymous",
          autoPlay: true,
        })}
        <button slot="top-chrome" className="rzp-back" onClick={onClose} aria-label="Back to films">
          <Svg name="back" />
        </button>
        <MediaLoadingIndicator slot="centered-chrome" noAutohide className="rzp-loading" />
        <MediaPlayButton slot="centered-chrome" className="rzp-big-play">
          <Svg name="bigPlay" slot="play" />
          <span slot="pause" />
        </MediaPlayButton>
        <MediaRenditionMenu id="rzp-quality" anchor="auto" hidden className="rzp-menu" />
        <MediaTimeRange className="rzp-range" />
        <MediaControlBar className="rzp-bar">
          <MediaPlayButton className="rzp-btn" />
          <MediaMuteButton className="rzp-btn" />
          <MediaTimeDisplay className="rzp-time" showDuration />
          <span className="rzp-title">• {title}</span>
          <span className="rzp-spacer" />
          <a className="rzp-btn rzp-link" href={downloadUrl} aria-label="Download original film" title="Download original film">
            <Svg name="cloud" />
          </a>
          <MediaRenditionMenuButton className="rzp-btn" invokeTarget="rzp-quality" aria-label="Quality">
            <Svg name="gear" slot="icon" />
          </MediaRenditionMenuButton>
          <MediaCastButton className="rzp-btn rzp-cast" />
          <MediaFullscreenButton className="rzp-btn" />
        </MediaControlBar>
      </MediaController>
    </div>
  );
}
