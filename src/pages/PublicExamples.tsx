import { ArrowLeft, ArrowRight } from "lucide-react";
import { exampleSites } from "../lib/exampleSites";
import { usePremiumRoot, usePointerSpotlight, useScrollReveal } from "../lib/premiumMotion";
import { usePageWipe } from "../lib/usePageWipe";
import { PublicFooterLinks } from "../components/PublicFooterLinks";

// "See what a site could look like": fictional businesses built from the real client-site template. Labelled as examples everywhere; never presented as client work.
export function PublicExamples() {
  usePremiumRoot();
  useScrollReveal();
  usePointerSpotlight();
  usePageWipe();

  return (
    <main className="px">
      <header className="px-nav" aria-label="Primary">
        <a className="px-brand" href="/">
          <span className="px-mark" aria-hidden="true">N</span>
          <span className="px-brandtext"><strong>NXQX</strong>{" "}<span>Web systems</span></span>
        </a>
        <nav className="px-links" aria-label="Main navigation">
          <a href="/"><ArrowLeft size={16} /> Back home</a>
          <a href="/plans">Plans</a>
          <a className="px-cta" data-px-wipe href="/portal">Client portal</a>
        </nav>
      </header>

      <section>
        <div className="px-wrap">
          <h1 className="sr-only">Example websites</h1>
          <span className="px-kicker" data-px-reveal>Examples</span>
          <h2 data-px-reveal>See what a site could look like.</h2>
          <p className="px-sub" data-px-reveal>
            These are <strong>fictional businesses</strong>, built with the same template your site would use. They are examples, not client work, and they carry no reviews, prices or promises.
            Your site is built from your own services, area and style.
          </p>
          <div className="px-tiers px-examples" data-testid="examples-grid">
            {exampleSites.map((site) => (
              <article className="px-tier" data-px-reveal data-px-spot data-testid="example-card" key={site.slug}>
                <span className="px-badge">Example site</span>
                <img className="px-example-shot" src={`/examples/thumbs/${site.slug}.png`} width={640} height={400} loading="lazy" alt={`Screenshot of the example site for ${site.name}, a fictional ${site.type.toLowerCase()}.`} />
                <h3>{site.name}</h3>
                <p className="px-out">{site.type}</p>
                <p>{site.blurb}</p>
                <a className="px-btn px-ghost" href={`/examples/${site.slug}/`}>Open the example <ArrowRight size={16} /></a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className="px-wrap">
        <div className="px-cta-band" data-px-reveal>
          <h2>Want one for your business?</h2>
          <p className="px-sub">Tell us what you do and where. We set it up with you and look after it every month. The first month is free for new local clients.</p>
          <div className="px-btns">
            <a className="px-btn px-gold" data-px-wipe href="/contact">Talk to us <ArrowRight size={16} /></a>
            <a className="px-btn px-ghost" data-px-wipe href="/plans">See plans</a>
          </div>
        </div>
      </div>

      <footer>
        <div className="px-wrap px-foot">
          <span>NXQX · NXQX-Web</span>
          <span>Example sites are fictional</span>
          <PublicFooterLinks />
        </div>
      </footer>
    </main>
  );
}
