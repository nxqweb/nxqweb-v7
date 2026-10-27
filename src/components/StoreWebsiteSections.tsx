import { mailtoHref, telHref } from "../lib/storeProfile";
import { websiteHasInfo, websiteHasTop, type StoreWebsite } from "../lib/storeWebsiteContent";

// The owner's "Website content" shown on her public store page. All text is rendered as plain text (React escapes it); links come only from the checked helpers.
export function StoreAnnouncement({ website }: { website: StoreWebsite | null }) {
  if (!website?.announcement) return null;
  return <p className="store-announcement" role="note" data-testid="store-announcement">{website.announcement}</p>;
}

export function StoreMessageAndVerse({ website }: { website: StoreWebsite | null }) {
  if (!website || !websiteHasTop(website)) return null;
  return <>
    {website.message ? <section className="store-message" data-testid="store-message" aria-label={website.message.heading || "A message from the shop"}>
      {website.message.heading ? <h2>{website.message.heading}</h2> : null}
      <p>{website.message.body}</p>
    </section> : null}
    {website.verse ? <figure className="store-verse" data-testid="store-verse" aria-label="Verse">
      <blockquote><p>{website.verse.text}</p></blockquote>
      {website.verse.reference ? <figcaption>{website.verse.reference}</figcaption> : null}
      {website.verse.note ? <p>{website.verse.note}</p> : null}
    </figure> : null}
  </>;
}

export function StoreInfo({ website, storeName }: { website: StoreWebsite | null; storeName: string }) {
  if (!website || !websiteHasInfo(website)) return null;
  const facts: [string, string][] = [["Hours", website.hours], ["Pickup", website.pickup]];
  const shownFacts = facts.filter(([, value]) => value);
  return (
    <section className="store-info" data-testid="store-website-info" aria-label={`About ${storeName}`}>
      {website.story ? <><h2>{website.story.heading || "Our story"}</h2><p>{website.story.body}</p></> : <h2>About the shop</h2>}
      {shownFacts.length ? <dl className="store-facts">{shownFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
      {website.email || website.phone ? <ul className="store-contact-list">
        {website.email && mailtoHref(website.email) ? <li>Email <a href={mailtoHref(website.email)}>{website.email}</a></li> : null}
        {website.phone && telHref(website.phone) ? <li>Phone <a href={telHref(website.phone)}>{website.phone}</a></li> : null}
      </ul> : null}
      {website.policies.map((policy) => <details key={policy.label}><summary>{policy.label}</summary><p>{policy.text}</p></details>)}
      {website.social.length ? <ul className="store-social" aria-label="Find us online">{website.social.map((item) => <li key={item.label}><a href={item.href} target="_blank" rel="noopener noreferrer">{item.label}</a></li>)}</ul> : null}
    </section>
  );
}
