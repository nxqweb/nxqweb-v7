import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { footerLinks } from "../lib/legalContent";
import { waitlistGateway } from "../lib/waitlistConfig";
import { WAITLIST_CONSENT_TEXT, emailProblem, sourceFromSearch } from "../lib/waitlist";

// Public sign-up for the pre-launch waiting list (DRAFT: docs/drafts/waitlist/; final home src/pages/PublicWaitlist.tsx). It collects ONE thing, an email address, plus which
// creator link brought the person. While the switch in src/lib/waitlistConfig.ts is OFF it shows "not open yet" and makes no request at all.
export function PublicWaitlist() {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => {
    const previous = document.title;
    document.title = "Join the waiting list | NXQX-Web";
    return () => { document.title = previous; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!waitlistGateway || busy) return;
    const problem = emailProblem(email);
    if (problem) { setError(problem); return; }
    if (!agreed) { setError("Please tick the box to say it is okay to email you."); return; }
    setBusy(true); setError("");
    try {
      const result = await waitlistGateway.join({ email: email.trim(), source: sourceFromSearch(window.location.search), honeypot });
      if (result.ok) setDone(result.message); else setError(result.message);
    } catch { setError("Something went wrong. Please try again."); }
    setBusy(false);
  }

  return (
    <main className="nxq-page"><section className="portal-shell info-page">
      <div className="panel-title panel-title-row">
        <div className="panel-title"><div><h1>Join the waiting list</h1><p className="subtle">NXQX Web builds and looks after websites for small businesses. Leave your email and we will write to you when it is time to set up your site.</p></div></div>
        <a className="icon-btn" href="/"><ArrowLeft size={16} /> Home</a>
      </div>
      {!waitlistGateway ? (
        <div className="notice-card" role="status" data-testid="waitlist-closed"><strong>The waiting list is not open yet.</strong> Please check back soon.</div>
      ) : done ? (
        <div className="notice-card success" role="status" data-testid="waitlist-done">{done}</div>
      ) : (
        <form className="panel panel-wide" onSubmit={(e) => void submit(e)} noValidate data-testid="waitlist-form">
          {error ? <div className="notice-card error" role="alert">{error}</div> : null}
          <label className="field">Email address
            <input type="email" name="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <div className="sr-only" aria-hidden="true">
            <label>Company website<input type="text" name="company_website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} /></label>
          </div>
          <label className="look-check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>{WAITLIST_CONSENT_TEXT}</span>
          </label>
          <button className="wide-btn" type="submit" disabled={busy}>{busy ? "Adding you..." : "Join the waiting list"}</button>
          <p className="subtle">We only keep your email address and the link you came from. See our <a href="/privacy">Privacy page</a>.</p>
        </form>
      )}
      <nav className="info-footer-links" aria-label="Company and legal">
        {footerLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
      </nav>
    </section></main>
  );
}
