import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { appConfig } from "../lib/appConfig";
import { footerLinks, infoPages, legalLastUpdated, legalReviewComplete } from "../lib/legalContent";

type Slug = keyof typeof infoPages;

// One layout for About, Contact, Privacy and Terms. Legal pages carry a visible "draft" notice until legalReviewComplete is set to true.
export function PublicInfoPage({ slug }: { slug: Slug }) {
  const page = infoPages[slug];
  useEffect(() => {
    const previous = document.title;
    document.title = `${page.title} | NXQX-Web`;
    return () => { document.title = previous; };
  }, [page.title]);
  return (
    <main className="nxq-page"><section className="portal-shell info-page">
      <div className="panel-title panel-title-row">
        <div className="panel-title"><div><h1>{page.title}</h1><p className="subtle">{page.intro}</p></div></div>
        <a className="icon-btn" href="/"><ArrowLeft size={16} /> Home</a>
      </div>
      {page.legal && !legalReviewComplete ? <div className="notice-card info-draft" role="note" data-testid="legal-draft-notice"><strong>Draft, pending legal review.</strong> This page is written in plain words from how NXQX-Web really works, but it has not yet been reviewed by a lawyer. Items in [square brackets] are still to be confirmed.</div> : null}
      {page.sections.map((section) => (
        <section className="panel panel-wide" key={section.heading}>
          <h2>{section.heading}</h2>
          {(section.paragraphs || []).map((text) => <p key={text}>{text}</p>)}
          {section.bullets ? <ul className="info-list">{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          {slug === "contact" && section.heading === "Email" ? <p><a className="wide-btn" href={`mailto:${appConfig.supportEmail}`} data-testid="contact-email">{appConfig.supportEmail}</a></p> : null}
        </section>
      ))}
      {page.legal ? <p className="subtle">Last updated {legalLastUpdated}.</p> : null}
      <nav className="info-footer-links" aria-label="Company and legal">
        {footerLinks.map((link) => <a key={link.href} href={link.href} aria-current={window.location.pathname === link.href ? "page" : undefined}>{link.label}</a>)}
      </nav>
    </section></main>
  );
}
