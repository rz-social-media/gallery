"use client";

import { useState } from "react";
import { stories } from "../stories";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const assetUrl = (url: string) => url.startsWith("/") ? `${publicBasePath}${url}` : url;

export default function StoryIndex({ mode }: { mode: "films" | "photography" }) {
  const [activeStory, setActiveStory] = useState(0);
  const isFilms = mode === "films";

  return (
    <main className="portfolio-shell">
      <img alt="" aria-hidden="true" className="portfolio-backdrop" decoding="async" fetchPriority="high" src={assetUrl(stories[activeStory].heroImage)} />
      <div className="portfolio-wash" aria-hidden="true" />
      <header className="portfolio-header">
        <a className="brand" href={`${publicBasePath}/`} aria-label="Back to RZ Weddings Gallery">
          <span className="brand-seal">RZ</span>
          <span className="brand-copy"><strong>RZ Weddings</strong><small>Gallery</small></span>
        </a>
        <div className="portfolio-meta" aria-label={`${mode} portfolio`}><span>Wedding gallery</span><span>{isFilms ? "Films" : "Photography"}</span></div>
      </header>
      <section className="portfolio-intro" aria-labelledby="portfolio-title">
        <p className="eyebrow">Stories made to be felt</p>
        <h1 id="portfolio-title">Wedding <em>{isFilms ? "Films" : "Photography"}</em></h1>
        <p className="portfolio-description">{isFilms ? "Cinematic wedding films shaped around atmosphere, movement and the people who made the day unforgettable." : "An editorial collection of honest moments, quiet details and the people who made each celebration unforgettable."}</p>
      </section>
      <section className="story-dock" aria-label={`Selected wedding ${mode}`}>
        {stories.map((story, index) => (
          <a className={`story-card${activeStory === index ? " is-active" : ""}`} href={`${publicBasePath}/weddings/${story.slug}/${isFilms ? "" : "photography/"}`} key={story.slug} onFocus={() => setActiveStory(index)} onMouseEnter={() => setActiveStory(index)} aria-label={`View ${story.names}'s ${mode}`}>
            <img alt={`${story.names}'s wedding`} decoding="async" src={assetUrl(story.heroImage)} />
            <span className="story-card-shade" aria-hidden="true" />
            <span className="story-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="story-card-copy"><small>{story.location}</small><strong>{story.names}</strong><span className="story-link">View gallery <i aria-hidden="true">↗</i></span></span>
          </a>
        ))}
      </section>
      <p className="portfolio-count" aria-live="polite"><span>{String(activeStory + 1).padStart(2, "0")}</span> / {String(stories.length).padStart(2, "0")}</p>
    </main>
  );
}
