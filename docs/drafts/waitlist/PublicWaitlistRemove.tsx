import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { footerLinks } from "../lib/legalContent";
import { waitlistGateway } from "../lib/waitlistConfig";
import { tokenFromSearch } from "../lib/waitlist";

// "Remove me from the waiting list" (DRAFT: docs/drafts/waitlist/; final home src/pages/PublicWaitlistRemove.tsx), reached from the link in a waiting-list email: /waitlist/remove?token=...
// Removing needs a CLICK on the button. Opening the link does nothing by itself, because email scanners and link previews open links automatically and must not remove anyone.
// While the switch in src/lib/waitlistConfig.ts is OFF the page says so and makes no request.
export function PublicWaitlistRemove() {
  const [token] = useState(() => tokenFromSearch(window.location.search));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => {
    const previous = document.title;
    document.title = "Leave the waiting list | NXQX-Web";
    return () => { document.title = previous; };
  }, []);

  async function remove() {
    if (!waitlistGateway || !token || busy) return;
    setBusy(true); setError("");
    try {
      const result = await waitlistGateway.remove(token);
      if (result.ok) setDone(result.message); else setError(result.message);
    } catch { setError("Something went wrong. Please try again."); }
    setBusy(false);
  }

  return (
    <main className="nxq-page"><section className="portal-shell info-page">
      <div className="panel-title panel-title-row">
        <div className="panel-title"><div><h1>Leave the waiting list</h1><p className="subtle">If you no longer want to hear from NXQX Web, you can remove your email address here. It is erased, not just hidden.</p></div></div>
        <a className="icon-btn" href="/"><ArrowLeft size={16} /> Home</a>
      </div>
      {!waitlistGateway ? (
        <div className="notice-card" role="status" data-testid="remove-closed"><strong>This page is not available right now.</strong> If you want to be removed, email us from the address you signed up with.</div>
      ) : !token ? (
        <div className="notice-card error" role="alert" data-testid="remove-no-token">This removal link is not valid. Please use the link from our email, or contact us.</div>
      ) : done ? (
        <div className="notice-card success" role="status" data-testid="remove-done">{done}</div>
      ) : (
        <section className="panel panel-wide" data-testid="remove-form">
          {error ? <div className="notice-card error" role="alert">{error}</div> : null}
          <p>Click the button to remove the email address linked to this message from our waiting list.</p>
          <button className="wide-btn" type="button" disabled={busy} onClick={() => void remove()}>{busy ? "Removing..." : "Remove me from the waiting list"}</button>
        </section>
      )}
      <nav className="info-footer-links" aria-label="Company and legal">
        {footerLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
      </nav>
    </section></main>
  );
}
