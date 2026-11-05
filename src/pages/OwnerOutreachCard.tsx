import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { ReviewQr } from "../components/ReviewQr";
import { cardLimits, checkCard } from "../lib/outreachCard";

const storageKey = "nxq-owner-outreach-card-v1";
const empty = { name: "", phone: "", site: "" };

// Storage can be blocked (private mode); the card still works, it just forgets what was typed.
function readSaved(): typeof empty {
  try { const raw = window.localStorage.getItem(storageKey); if (!raw) return empty; const v = JSON.parse(raw) as Partial<typeof empty>; return { name: String(v.name ?? ""), phone: String(v.phone ?? ""), site: String(v.site ?? "") }; } catch { return empty; }
}

// A sheet of printable cards for door-to-door outreach: your name, your number, the plans page address and a code that opens it. Nothing here is sent or saved on a server.
export function OwnerOutreachCard() {
  const [form, setForm] = useState(() => { const saved = readSaved(); return saved.site ? saved : { ...saved, site: window.location.origin.startsWith("https://") ? window.location.origin : "" }; });
  useEffect(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(form)); } catch { /* it just will not be remembered */ } }, [form]);
  const result = useMemo(() => checkCard(form), [form]);
  const touched = Boolean(form.name || form.phone || form.site);

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row no-print">
        <div className="panel-title"><Printer size={22} /><div><h1>Outreach card</h1><p className="subtle">Type your name, number and website once. Print the sheet, cut the cards, and hand one to every owner you meet. Nothing is sent or saved on a server.</p></div></div>
        <div className="client-control-row"><a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Owner</a></div>
      </div>

      <section className="panel panel-wide no-print" data-testid="outreach-form">
        <label className="auth-label" htmlFor="oc-name"><span>Your name</span></label>
        <input id="oc-name" className="auth-input" maxLength={cardLimits.name} autoComplete="name" value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} />
        <label className="auth-label" htmlFor="oc-phone"><span>Phone or text number (optional)</span></label>
        <input id="oc-phone" className="auth-input" type="tel" maxLength={cardLimits.phone} autoComplete="tel" value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} />
        <label className="auth-label" htmlFor="oc-site"><span>Your website address</span></label>
        <input id="oc-site" className="auth-input" maxLength={cardLimits.site} placeholder="example.com" value={form.site} onChange={(e) => setForm((c) => ({ ...c, site: e.target.value }))} />
        {touched && !result.ok ? <div className="auth-error" role="alert" data-testid="outreach-error">{result.error}</div> : null}
        {!touched ? <p className="subtle">The card appears below as soon as the three boxes are filled in.</p> : null}
        <div className="review-actions">
          <button className="wide-btn" type="button" disabled={!result.ok} onClick={() => window.print()}><Printer size={16} /> Print the sheet</button>
        </div>
        <p className="subtle">The code opens your plans page, so check it by pointing a phone camera at the first card before you print a stack.</p>
      </section>

      {result.ok ? (
        <section className="outreach-sheet" aria-label="Printable sheet of outreach cards" data-testid="outreach-sheet">
          {Array.from({ length: 6 }, (_, index) => (
            <article className="outreach-card" key={index} aria-hidden={index === 0 ? undefined : true} data-testid="outreach-card">
              <h3>{result.name}</h3>
              <p className="outreach-lead">Simple, good-looking websites for local businesses, set up and looked after for you.</p>
              <p className="outreach-offer"><strong>First month free.</strong> After that $50 to $150 a month. Cancel any time.</p>
              <ReviewQr value={result.plansUrl} label={`Scan to see the plans at ${result.siteHost}`} />
              <p className="outreach-scan">Scan to see plans, or visit <strong>{result.siteHost}/plans</strong></p>
              {result.phone ? <p className="outreach-phone">Call or text <strong>{result.phone}</strong></p> : null}
            </article>
          ))}
        </section>
      ) : null}
    </section></main>
  );
}
