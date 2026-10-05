import { Eye, KeyRound, Lock, ShieldCheck, UserCheck, Globe2 } from "lucide-react";
import { clientDomainPolicy } from "../lib/appConfig";

// Plain-language summary of controls that exist in the product design. It describes how the system is
// built, not a guarantee, and avoids claims about audits, certifications or specific vendors.
const items = [
  {
    icon: Lock,
    title: "Every business is kept separate",
    body: "Each client workspace is protected by database-level access rules, so one business cannot see another business's information.",
  },
  {
    icon: ShieldCheck,
    title: "Checked on the server, not just hidden in the page",
    body: "Access to the client and owner areas is verified on the server. Hiding a button in the browser is never the only protection.",
  },
  {
    icon: UserCheck,
    title: "Owner review on high-impact steps",
    body: "Setup approvals and other higher-impact decisions are reviewed by the NXQ owner before protected automation moves forward.",
  },
  {
    icon: Eye,
    title: "Tracking is tier-gated and consent-gated",
    body: "Advanced behavior tracking is only available on the tiers that include it, and it stays consent-gated rather than being silently switched on.",
  },
  {
    icon: Globe2,
    title: "You own your domain",
    body: clientDomainPolicy.summary,
  },
  {
    icon: KeyRound,
    title: "Sensitive keys stay on the server",
    body: "Provider keys and other secrets are kept in protected server settings and are not shipped inside the website code.",
  },
];

export function SecurityBand() {
  return (
    <section className="px-sec-glass" id="security" aria-labelledby="px-security-title">
      <div className="px-wrap">
        <span className="px-kicker" data-px-reveal>Security and privacy</span>
        <h2 data-px-reveal id="px-security-title">Built so your business and your customers stay protected.</h2>
        <p className="px-sub" data-px-reveal>
          Here is how NXQ-Web is designed, in plain language. Security is an ongoing practice, so this describes our approach rather than promising that nothing can ever go wrong.
        </p>
        <div className="px-grid3">
          {items.map(({ icon: Icon, title, body }) => (
            <article className="px-card" data-px-reveal data-px-spot key={title}>
              <Icon size={24} />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
