import { useCallback, useState } from "react";
import { ArrowRight } from "lucide-react";
import { FoundingClientProgram } from "../components/FoundingClientProgram";
import { PortalPreviewDemo } from "../components/PortalPreviewDemo";
import { ProductFamilySignupSelector } from "../components/ProductFamilySignupSelector";
import { SecurityBand } from "../components/SecurityBand";
import { TrustedBy } from "../components/TrustedBy";
import { productTiers } from "../lib/productCatalog";
import {
  useCountUp,
  usePremiumRoot,
  useProcessLine,
  useScrollReveal,
  usePointerSpotlight,
  useStoryStage,
} from "../lib/premiumMotion";
import { usePageWipe } from "../lib/usePageWipe";

const comparisonRows = [
  { label: "Premium managed website", starter: "Included", growth: "Included", intelligence: "Included", enterprise: "Included" },
  { label: "Local SEO foundation", starter: "Basic", growth: "Expanded", intelligence: "Advanced", enterprise: "Custom" },
  { label: "Lead + conversion focus", starter: "Core", growth: "Expanded", intelligence: "Advanced", enterprise: "Custom" },
  { label: "Behavior analytics", starter: "—", growth: "Core analytics", intelligence: "Click + scroll", enterprise: "Custom" },
  { label: "Ongoing optimization", starter: "Maintenance", growth: "Monthly", intelligence: "Priority cycle", enterprise: "Custom cadence" },
  { label: "Multi-location scale", starter: "—", growth: "—", intelligence: "—", enterprise: "Available" },
];

const storyStages = [
  {
    eyebrow: "01 · Build",
    title: "Start with a site that already feels premium.",
    body: "NXQX-Web turns the business setup into a polished, responsive website structure instead of handing the owner a blank builder.",
    signal: "Launch foundation",
    detail: "Pages, brand direction, calls to action, and client controls stay connected to the same project.",
  },
  {
    eyebrow: "02 · Get found",
    title: "Structure the site around how customers actually search.",
    body: "Growth-focused plans organize service pages, local coverage, and SEO opportunities around the business instead of treating search visibility as an afterthought.",
    signal: "Search visibility",
    detail: "Service-area structure and content opportunities become part of the managed website cycle.",
  },
  {
    eyebrow: "03 · Convert",
    title: "Turn visits into clear next actions.",
    body: "The site is designed around calls, forms, estimate requests, and stronger customer paths so attention has somewhere useful to go.",
    signal: "Lead flow",
    detail: "Lead capture and conversion-focused layouts stay tied to the website instead of living in a disconnected tool.",
  },
  {
    eyebrow: "04 · Understand",
    title: "See what the website is actually doing.",
    body: "Higher tiers add progressively deeper reporting and behavior insight so decisions can be based on evidence instead of guesses.",
    signal: "Performance signals",
    detail: "Advanced tracking remains tier- and consent-gated rather than being silently enabled for every client.",
  },
  {
    eyebrow: "05 · Improve",
    title: "Keep the website moving after launch.",
    body: "NXQX-Web is designed around ongoing care: maintenance, content improvements, SEO opportunities, and higher-tier optimization cycles.",
    signal: "Ongoing care",
    detail: "The website stays part of an active managed system instead of becoming a forgotten one-time project.",
  },
];

const marqueeWords = ["Premium design", "Hosting + SSL", "Client portal", "SEO foundation", "Lead capture", "Ongoing care"];

export function PublicHome() {
  const [stage, setStage] = useState(0);
  const onStage = useCallback((index: number) => setStage(index), []);

  usePremiumRoot();
  useScrollReveal();
  useProcessLine();
  useCountUp();
  usePointerSpotlight();
  useStoryStage(onStage);
  usePageWipe();

  return (
    <main className="px">
      <header className="px-nav" aria-label="Primary">
        <a className="px-brand" href="/" aria-label="NXQX NXQX-Web home">
          <span className="px-mark">N</span>
          <span className="px-brandtext">
            <strong>NXQX</strong>
            <span>Web</span>
          </span>
        </a>
        <nav className="px-links" aria-label="Main navigation">
          <a href="#systems">Systems</a>
          <a href="#workspace">Workspace</a>
          <a href="#families">Families</a>
          <a href="#pricing">Pricing</a>
          <a href="#process">Process</a>
          <a className="px-cta" data-px-wipe href="/portal">Client portal</a>
        </nav>
      </header>

      <div className="px-hero">
        <div className="px-wrap px-center">
          <span className="px-eyebrow px-rise"><i />One vision. Limitless future.</span>
          <h1 className="px-rise px-d1">
            Your website should work <em>as hard as your business.</em>
          </h1>
          <p className="px-lede px-rise px-d2">
            NXQX-Web builds, manages, improves, and grows premium websites for businesses that do not want to babysit technology. Your site, client portal, updates, growth work, and ongoing care stay connected in one managed system.
          </p>
          <div className="px-btns px-rise px-d3">
            <a className="px-btn px-gold" data-px-wipe href="/portal/signup?family=business&tier=growth">
              Build my website <ArrowRight size={18} />
            </a>
            <a className="px-btn px-ghost" href="#systems">See how NXQX works</a>
          </div>
          <div className="px-chips px-rise px-d4" aria-label="NXQX-Web service principles">
            <span>Managed after launch</span>
            <span>Built to keep improving</span>
            <span>Owner-reviewed where it matters</span>
          </div>
        </div>
        <a className="px-cue" href="#systems" aria-label="Scroll down"><span />Scroll</a>
      </div>

      <div className="px-marquee" aria-hidden="true">
        <div>
          {[...marqueeWords, ...marqueeWords].map((word, index) => <span key={`${word}-${index}`}>{word}</span>)}
        </div>
      </div>

      <TrustedBy />

      <section className="px-sec-glass" id="systems">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>One system. Your website operation.</span>
          <h2 data-px-reveal>A premium site is only the beginning.</h2>
          <p className="px-sub" data-px-reveal>
            NXQX-Web is designed around the full lifecycle: getting your business online, helping customers find it, turning attention into leads, and keeping the site current instead of letting it age in place.
          </p>
          <div className="px-grid4">
            {[
              ["01", "Build", "Premium responsive presentation, secure client access, clear structure, and a managed setup process."],
              ["02", "Get found", "SEO foundations, service-area structure, stronger pages, and ongoing content opportunities."],
              ["03", "Convert", "Lead capture, stronger calls to action, conversion-focused layouts, and clearer customer paths."],
              ["04", "Improve", "Higher tiers add behavior insights, performance review, and an ongoing optimization cycle."],
            ].map(([number, title, body]) => (
              <article className="px-card" data-px-reveal data-px-spot key={title}>
                <span className="px-num">{number}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>

          <div className="px-story" aria-label="NXQX-Web managed website lifecycle demonstration">
            <div className="px-card px-story-card" aria-live="polite">
              {storyStages.map((item, index) => (
                <div className={`px-stage ${index === stage ? "px-on" : ""}`} key={item.eyebrow}>
                  <span className="px-kicker">{item.eyebrow}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <div className="px-signal"><span>{item.signal}</span><b>{item.detail}</b></div>
                </div>
              ))}
              <div className="px-dotsrow" aria-label="Lifecycle progress">
                {storyStages.map((item, index) => <i className={index <= stage ? "px-on" : ""} key={item.eyebrow} />)}
              </div>
            </div>
            <div className="px-story-steps">
              {storyStages.map((item, index) => (
                <article className={`px-card ${index === stage ? "px-on" : ""}`} data-px-story key={item.eyebrow}>
                  <span className="px-num">{item.eyebrow}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="workspace">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>Your client portal</span>
          <h2 data-px-reveal>See your website working, as it happens.</h2>
          <p className="px-sub" data-px-reveal>
            Health, leads, update requests, and the next improvement cycle in one calm workspace, with a live view of how your site is performing.
          </p>
          <PortalPreviewDemo />
        </div>
      </section>

      <section className="px-sec-glass" id="devices">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>Built to feel premium everywhere</span>
          <h2 data-px-reveal>Desktop, tablet, phone. Always on brand.</h2>
          <p className="px-sub" data-px-reveal>Responsive by default. Mobile-first presentation is part of every plan, from Starter up.</p>
          <div className="px-devs" data-px-reveal aria-label="Example website on desktop and phone">
            {[0, 1].map((variant) => {
              const sample = (
                <div className="px-scrollpage" aria-hidden="true">
                  <div className="px-mk-hero"><h4>Bright Smile Dental</h4><p>Family dentistry, booked online in minutes.</p><u>Book a visit</u></div>
                  <div className="px-mk-row"><div /><div /><div /></div>
                  <div className="px-mk-band" />
                  <div className="px-mk-foot"><div /><div /><div /></div>
                </div>
              );
              return variant === 0 ? (
                <div key="laptop">
                  <div className="px-laptop"><div className="px-bar"><i /><i /><i /></div><div className="px-viewport">{sample}</div></div>
                  <div className="px-laptop-base" />
                </div>
              ) : (
                <div className="px-phone" key="phone"><div className="px-viewport">{sample}</div></div>
              );
            })}
          </div>
          <p className="px-note">Example site for illustration only.</p>
        </div>
      </section>

      <section id="families">
        <div className="px-wrap">
          <ProductFamilySignupSelector />
        </div>
      </section>

      <section className="px-sec-glass" id="pricing">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>Pricing</span>
          <h2 data-px-reveal>Pick where you want your business to go.</h2>
          <p className="px-sub" data-px-reveal>
            Every tier keeps the managed foundation. Higher tiers add stronger visibility, measurement, and ongoing optimization instead of random feature clutter.
          </p>
          <div className="px-tiers">
            {productTiers.map((tier) => {
              const featured = tier.key === "growth";
              return (
                <article className={`px-tier ${featured ? "px-featured" : ""}`} data-px-reveal data-px-spot key={tier.key}>
                  <span className="px-badge">{tier.badge}</span>
                  <h3>{tier.name}</h3>
                  <p>{tier.description}</p>
                  <div className="px-price">{tier.priceLabel}</div>
                  <ul>
                    {tier.features.map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                  <div className="px-out">{tier.outcome}</div>
                  <a
                    className={`px-btn ${featured ? "px-gold" : "px-ghost"}`}
                    data-px-wipe
                    href={`/portal/signup?family=business&tier=${encodeURIComponent(tier.key)}`}
                  >
                    Choose {tier.name} <ArrowRight size={17} />
                  </a>
                </article>
              );
            })}
          </div>

          <div className="px-card px-cmp" data-px-reveal>
            <span className="px-kicker">Compare the outcome</span>
            <div className="px-cmp-head">
              <h3>See what changes as NXQX-Web takes on more of the growth work.</h3>
              <a className="px-btn px-ghost" href="/plans">Open full plans</a>
            </div>
            <table aria-label="NXQX-Web tier comparison">
              <thead>
                <tr><th>Capability</th><th>Starter</th><th>Growth</th><th>Intelligence</th><th>Enterprise</th></tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td><td>{row.starter}</td><td>{row.growth}</td><td>{row.intelligence}</td><td>{row.enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <FoundingClientProgram />

      <section id="process">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>How NXQX-Web works</span>
          <h2 data-px-reveal>Simple for the client. Controlled behind the scenes.</h2>
          <p className="px-sub" data-px-reveal>The client gets a clean guided experience while project approval and higher-impact decisions stay protected.</p>
          <div className="px-steps" data-px-steps>
            {[
              ["1", "Choose", "Select the website family and service tier that match the business."],
              ["2", "Tell us what matters", "Complete a project form that changes based on the selected family and tier."],
              ["3", "Review", "NXQX reviews the setup before protected build automation can move forward."],
              ["4", "Build + launch", "Approved projects move through the managed website workflow and ongoing care path."],
            ].map(([number, title, body]) => (
              <div className="px-step" data-px-reveal data-px-step key={title}>
                <b>{number}</b>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SecurityBand />

      <section className="px-sec-glass">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>Why managed beats DIY</span>
          <h2 data-px-reveal>Your time should go into the business, not babysitting a website builder.</h2>
          <p className="px-sub" data-px-reveal>
            DIY tools can help create pages. NXQX-Web is designed around the work that comes after that too: structure, client intake, updates, SEO, lead flow, monitoring, reports, and ongoing improvements.
          </p>
          <div className="px-vs">
            <div className="px-card" data-px-reveal>
              <h3>Doing it yourself</h3>
              <ul>
                <li>You build and rebuild the pages</li>
                <li>You chase hosting, SSL, and fixes</li>
                <li>SEO and lead flow are an afterthought</li>
                <li>Nobody reviews what the site is doing</li>
              </ul>
            </div>
            <div className="px-card px-nxq" data-px-reveal>
              <h3>With NXQX-Web</h3>
              <ul>
                <li>Premium presentation built for you</li>
                <li>Hosting, SSL, and maintenance handled</li>
                <li>Growth visibility and deeper insight on higher tiers</li>
                <li>High-impact steps reviewed before moving forward</li>
                <li>The site stays part of an active system after launch</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="faq">
        <div className="px-wrap">
          <span className="px-kicker" data-px-reveal>Questions</span>
          <h2 data-px-reveal>Good to know before you start.</h2>
          <div className="px-faq" data-px-reveal>
            <details><summary>What happens after I choose a plan?</summary><p>You complete a project form that adapts to the website family and tier. NXQX reviews the setup before protected build automation moves forward, then approved projects continue into the managed build and ongoing care path.</p></details>
            <details><summary>Can I ask for changes after launch?</summary><p>Yes. The client portal includes update requests, so changes stay connected to your project instead of getting lost in email.</p></details>
            <details><summary>Is advanced tracking always on?</summary><p>No. Behavior analytics such as click and scroll insight are tier-gated and consent-gated rather than silently enabled for every client.</p></details>
            <details><summary>When will the other NXQX-Web systems open?</summary><p>NXQX-Business is open now. The others are planned, and signup stays closed for each one until its experience is ready for clients.</p></details>
            <details><summary>Which plan should I start with?</summary><p>Starter is a polished managed site. Growth adds visibility and lead generation and is the most popular. Intelligence adds deeper insight and a monthly optimization cycle. Enterprise is custom for multi-location and larger teams.</p></details>
          </div>
        </div>
      </section>

      <div className="px-wrap" id="final">
        <div className="px-cta-band" data-px-reveal>
          <span className="px-kicker">Stop treating your website like a one-time project</span>
          <h2>Choose the system and tier that fit your business.</h2>
          <p className="px-sub">NXQX-Web keeps the website, project workflow, updates, and growth work connected after launch.</p>
          <div className="px-btns">
            <a className="px-btn px-gold" data-px-wipe href="/portal/signup?family=business&tier=growth">
              Start with NXQX-Business <ArrowRight size={18} />
            </a>
            <a className="px-btn px-ghost" href="#pricing">Compare plans</a>
          </div>
        </div>
      </div>

      <footer>
        <div className="px-wrap px-foot">
          <span>NXQX · NXQX-Web</span>
          <span>Premium managed website systems</span>
        </div>
      </footer>
    </main>
  );
}
