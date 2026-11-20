/** @jsxRuntime automatic */
import { AuthCard, SignedInCard } from './auth-card.js';
import { Body, Footer, Head, Header, PlayIcon } from './chrome.js';
import { fill, siteCopy } from './copy.js';
import {
  bonusPercent,
  faqPageLd,
  formatCredits,
  formatUsd,
  isYoutubeId,
  softwareApplicationLd,
  videoObjectLd,
  youtube,
} from './seo.js';
import type { LandingModel, SitePack } from './types.js';

/** Thumbnail with a play button; the youtube-nocookie iframe loads only on click (FR-34). */
function Video({ id }: { id: string }) {
  return (
    <a
      className="video"
      href={`${youtube.embed(id)}?autoplay=1&rel=0`}
      data-video-id={id}
      aria-label={siteCopy.video.play}
    >
      <img
        src={youtube.thumbnail(id)}
        alt=""
        width={480}
        height={360}
        loading="lazy"
        decoding="async"
      />
      <span className="play">
        <PlayIcon />
      </span>
      <span className="video-caption">{siteCopy.video.caption}</span>
    </a>
  );
}

function SectionHead({
  id,
  overline,
  title,
  body,
}: {
  id: string;
  overline: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="section-head">
      <span className="overline">{overline}</span>
      <h2 id={`${id}-title`}>{title}</h2>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

function HowItWorks() {
  const h = siteCopy.how;
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <SectionHead id="how" overline={h.overline} title={h.title} />
      <ol className="grid-3">
        {h.steps.map((step, i) => (
          <li className="step" key={step.title}>
            <span className="step-n" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Features() {
  const f = siteCopy.features;
  return (
    <section className="section" id="features" aria-labelledby="features-title">
      <SectionHead id="features" overline={f.overline} title={f.title} />
      <ul className="grid-3">
        {f.items.map((item) => (
          <li className="feature" key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SampleLead() {
  const s = siteCopy.sample;
  return (
    <section className="section sample" aria-labelledby="sample-title">
      <div className="sample-copy">
        <span className="overline">{s.overline}</span>
        <h2 id="sample-title">{s.title}</h2>
        <p className="lead-in">{s.body}</p>
      </div>
      <article className="lead" aria-label={s.cardLabel}>
        <div className="lead-top">
          <div>
            <span className="lead-name">{s.name}</span>
            <span className="lead-meta">{s.meta}</span>
          </div>
          <span className="score" aria-label={s.scoreLabel}>
            {s.score}
          </span>
        </div>
        <ul className="contacts">
          {s.contacts.map((contact) =>
            contact.verified ? (
              <li key={contact.text}>
                <span className="dot" aria-hidden="true">
                  ●
                </span>{' '}
                {contact.text} <span className="sr-only">{s.verified}</span>
              </li>
            ) : (
              <li key={contact.text} className="muted">
                {contact.text}
              </li>
            ),
          )}
        </ul>
        <ul className="evidence">
          {s.evidence.map((e) => (
            <li key={e.text}>
              <span>{e.text}</span>
              <span className="points">+{e.points}</span>
            </li>
          ))}
        </ul>
        <p className="sources">{s.sources}</p>
        <p className="pitch">
          <b>{s.pitchLead}</b> {s.pitch}
        </p>
      </article>
    </section>
  );
}

function Pack({
  pack,
  featured,
  signedIn,
}: {
  pack: SitePack;
  featured: boolean;
  signedIn: boolean;
}) {
  const p = siteCopy.pricing;
  const bonus = bonusPercent(pack);
  const blurb = p.blurbs[pack.name];
  return (
    <li className={featured ? 'pack pack-featured' : 'pack'}>
      <span className="pack-name">
        {pack.name}
        {bonus ? <span className="bonus">{fill(p.bonus, { n: bonus })}</span> : null}
      </span>
      <span className="pack-price">{formatUsd(pack.priceCents)}</span>
      <span className="pack-credits">
        {formatCredits(pack.credits)} {p.credits}
      </span>
      {blurb ? <span className="pack-blurb">{blurb}</span> : null}
      <a
        className={featured ? 'btn btn-primary' : 'btn btn-secondary'}
        href={signedIn ? '/app/credits' : '#signup'}
        data-tab-link={signedIn ? undefined : 'signup'}
      >
        {signedIn ? p.buyCredits : p.startFree}
      </a>
    </li>
  );
}

function Pricing({ packs, signedIn }: { packs: readonly SitePack[]; signedIn: boolean }) {
  const p = siteCopy.pricing;
  const href = signedIn ? '/app' : '#signup';
  // The middle pack of three or more gets the accent border, as in the approved mock.
  const featured = packs.length >= 3 ? 1 : -1;
  return (
    <section className="section" id="pricing" aria-labelledby="pricing-title">
      <SectionHead id="pricing" overline={p.overline} title={p.title} body={p.body} />
      {packs.length === 0 ? (
        <p className="price-notes">{p.empty}</p>
      ) : (
        <ul className="packs">
          {packs.map((pack, i) => (
            <Pack key={pack.id} pack={pack} featured={i === featured} signedIn={signedIn} />
          ))}
        </ul>
      )}
      <a
        className="btn btn-primary pricing-cta"
        href={href}
        data-tab-link={signedIn ? undefined : 'signup'}
      >
        {signedIn ? siteCopy.nav.openApp : p.startFree}
      </a>
      <p className="price-notes">{p.notes}</p>
    </section>
  );
}

function Faq() {
  const f = siteCopy.faq;
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <SectionHead id="faq" overline={f.overline} title={f.title} />
      <div className="faq-list">
        {f.items.map((item) => (
          <details className="faq-item" key={item.q} open>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta({ signedIn }: { signedIn: boolean }) {
  const c = siteCopy.cta;
  return (
    <section className="cta" aria-labelledby="cta-title">
      <div className="cta-copy">
        <h2 id="cta-title">{c.title}</h2>
        <p>{c.body}</p>
      </div>
      {signedIn ? (
        <a className="btn btn-primary" href="/app">
          {siteCopy.nav.openApp}
        </a>
      ) : (
        <a className="btn btn-primary" href="#signup" data-tab-link="signup">
          {c.button}
        </a>
      )}
    </section>
  );
}

/** FR-34: the public landing page, rendered on the server (ADR 0016). */
export function LandingPage({ model }: { model: LandingModel }) {
  const h = siteCopy.hero;
  const videoId = isYoutubeId(model.settings.youtubeVideoId) ? model.settings.youtubeVideoId : null;
  const jsonLd = [
    softwareApplicationLd(model.siteUrl, model.packs),
    faqPageLd(),
    ...(videoId ? [videoObjectLd(videoId)] : []),
  ];
  return (
    <html lang="en">
      <Head
        ctx={model}
        title={siteCopy.meta.title}
        description={siteCopy.meta.description}
        path="/"
        jsonLd={jsonLd}
      />
      <Body ctx={model}>
        <Header signedIn={model.signedIn} onLanding />
        <main id="main">
          <section className="hero" id="top" aria-labelledby="hero-title">
            <div className="hero-intro">
              <span className="overline">{h.overline}</span>
              <h1 id="hero-title">{h.headline}</h1>
              <p className="hero-lede">{h.lede}</p>
              <ul className="perks">
                {h.perks.map((perk) => (
                  <li key={perk}>
                    <span className="dot" aria-hidden="true">
                      ●
                    </span>{' '}
                    {perk}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hero-card">
              {model.signedIn ? <SignedInCard /> : <AuthCard card={model.card} />}
            </div>
            {videoId ? (
              <div className="hero-video" id="video">
                <Video id={videoId} />
              </div>
            ) : null}
          </section>
          <HowItWorks />
          <Features />
          <SampleLead />
          <Pricing packs={model.packs} signedIn={model.signedIn} />
          <Faq />
          <FinalCta signedIn={model.signedIn} />
        </main>
        <Footer ctx={model} />
      </Body>
    </html>
  );
}
