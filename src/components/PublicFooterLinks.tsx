import { footerLinks } from "../lib/legalContent";

// Company and legal links for the bottom of public pages.
export function PublicFooterLinks() {
  return (
    <nav className="px-foot-links" aria-label="Company and legal">
      {footerLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
    </nav>
  );
}
