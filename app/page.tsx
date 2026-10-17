import { stories } from "./stories";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const assetUrl = (url: string) => (url.startsWith("/") ? `${publicBasePath}${url}` : url);

export default function Home() {
  const featured = stories[0];

  return (
    <main className="gallery-gateway">
      <header className="gateway-header">
        <span className="brand" aria-label="RZ Weddings">
          <span className="brand-seal">RZ</span>
          <span className="brand-copy">
            <strong>RZ Weddings</strong>
            <small>Gallery</small>
          </span>
        </span>
        <span className="gateway-label">Photography &amp; films</span>
      </header>

      <section className="gateway-intro">
        <p className="eyebrow">Stories made to be felt</p>
        <h1>
          The <em>Gallery</em>
        </h1>
        <p>Wedding stories preserved in stills and cinematic motion.</p>
      </section>

      <nav className="gateway-choices" aria-label="Choose a gallery">
        <a className="gateway-choice" href={`${publicBasePath}/photography/`}>
          <img alt="Wedding photography" src={assetUrl(featured.heroImage)} />
          <span className="gateway-choice-shade" aria-hidden="true" />
          <span className="gateway-choice-number">01</span>
          <span className="gateway-choice-copy">
            <small>Selected moments</small>
            <strong>Photography</strong>
            <span>Explore photographs <i aria-hidden="true">↗</i></span>
          </span>
        </a>
        <a className="gateway-choice" href={`${publicBasePath}/films/`}>
          <img alt="Wedding films" src={assetUrl(featured.videos[0].coverImage ?? featured.heroImage)} />
          <span className="gateway-choice-shade" aria-hidden="true" />
          <span className="gateway-choice-number">02</span>
          <span className="gateway-choice-copy">
            <small>Cinematic motion</small>
            <strong>Films</strong>
            <span>Watch the stories <i aria-hidden="true">↗</i></span>
          </span>
        </a>
      </nav>
    </main>
  );
}
