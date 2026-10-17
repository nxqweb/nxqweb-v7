import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Printer, Star } from "lucide-react";
import { ReviewQr } from "../components/ReviewQr";
import { checkBusinessName, checkReviewLink, reviewSiteName } from "../lib/reviewLink";
import { buildReviewTexts, reviewFairnessNotes } from "../lib/reviewCard";
import { emptyReviewSettings, friendlyReviewsError, type ReviewSettings, type ReviewsGateway } from "../lib/reviewsGateway";

// "Get more reviews": paste your review link once, get a printable card with a QR code plus a text message and an email you can send.
// Nothing is sent from here and nothing is public: the code and messages point straight at the client's own review page.
// Rows that fit the text even when it wraps on a narrow phone (a fixed height used to cut off the last line).
const fitRows = (text: string) => text.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 32)), 1);

export function ClientReviews({ gateway }: { gateway: ReviewsGateway | null }) {
  const [saved, setSaved] = useState<ReviewSettings>(emptyReviewSettings);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const copiedTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!gateway) { setLoaded(true); return; }
    try {
      const settings = await gateway.load();
      setSaved(settings); setLink(settings.reviewUrl); setName(settings.businessName);
    } catch { setError("Your review settings could not be loaded right now. Please try again shortly."); }
    setLoaded(true);
  }, [gateway]);
  useEffect(() => { void load(); return () => window.clearTimeout(copiedTimer.current); }, [load]);

  async function save() {
    if (!gateway || busy) return;
    setError(""); setNotice("");
    const checkedName = checkBusinessName(name);
    if (!checkedName.ok) { setError(checkedName.error); return; }
    if (!link.trim() && saved.hasSettings) {
      if (!window.confirm("Remove your review link and card? You can add it again any time.")) return;
    } else if (link.trim()) {
      const checked = checkReviewLink(link);
      if (!checked.ok) { setError(checked.error); return; }
    } else { setError("Paste the link where customers leave you a review."); return; }
    setBusy(true);
    try {
      const next = await gateway.save(link.trim(), checkedName.name);
      setSaved(next); setLink(next.reviewUrl); setName(next.businessName);
      setNotice(next.hasSettings ? "Saved. Your review card is ready below." : "Your review link was removed.");
    } catch (failure) { setError(friendlyReviewsError(failure instanceof Error ? failure.message : "")); }
    setBusy(false);
  }

  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setError(""); window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopied(""), 2500); }
    catch { setCopied(""); setError("Could not copy automatically. Select the text and copy it by hand."); }
  }

  const texts = saved.hasSettings ? buildReviewTexts(saved.businessName, saved.reviewUrl) : null;
  const site = saved.hasSettings ? reviewSiteName(saved.reviewUrl) : "";
  const dirty = link.trim() !== saved.reviewUrl || name.trim() !== saved.businessName;

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row no-print">
        <div className="panel-title"><Star size={22} /><div><h1>Get more reviews</h1><p className="subtle">Paste your review link once. Get a printable card with a QR code, and messages you can send.</p></div></div>
        <div className="client-control-row"><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Portal</a></div>
      </div>
      {!gateway ? <div className="empty-state" role="status" data-testid="reviews-unavailable">This feature is not open yet. Check back soon.</div> : null}
      {error ? <div className="auth-error no-print" role="alert">{error}</div> : null}
      {notice ? <div className="auth-success no-print" role="status">{notice}</div> : null}
      {gateway && !loaded ? <div className="empty-state" role="status">Loading...</div> : null}

      {gateway && loaded ? <>
        <section className="panel panel-wide no-print" data-testid="reviews-form">
          <h2>Your review link</h2>
          <ol className="rewards-steps">
            <li>Open your business on Google (or the site where you want reviews) and press <strong>Share</strong> or <strong>Get more reviews</strong>.</li>
            <li>Copy the link and paste it below.</li>
          </ol>
          <label className="auth-label" htmlFor="review-link"><span>Review link</span></label>
          <input id="review-link" className="auth-input" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://g.page/r/..." value={link} maxLength={500} onChange={(event) => setLink(event.target.value)} />
          <label className="auth-label" htmlFor="review-name"><span>Business name on the card (optional)</span></label>
          <input id="review-name" className="auth-input" autoComplete="organization" placeholder="Example: Light of the World Candles" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <div className="review-actions">
            <button className="wide-btn" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving..." : saved.hasSettings ? "Save changes" : "Save and make my card"}</button>
            {saved.hasSettings ? <a className="icon-btn" href={saved.reviewUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Test my link ({site})</a> : null}
          </div>
        </section>

        {texts ? <>
          <section className="panel panel-wide review-card-section" data-testid="review-card">
            <h2 className="no-print">Your review card</h2>
            <div className="review-card">
              <h3>{texts.heading}</h3>
              <p>{texts.line}</p>
              <ReviewQr value={saved.reviewUrl} label={`QR code that opens your ${site} review page`} />
              <p className="review-card-scan">{texts.scanLabel}</p>
            </div>
            <div className="review-actions no-print">
              <button className="wide-btn" type="button" onClick={() => window.print()}><Printer size={16} /> Print the card</button>
            </div>
            <p className="subtle no-print">Print it and keep it at the counter, put it in bags, or add it to receipts.</p>
          </section>

          <section className="panel panel-wide no-print" data-testid="review-messages">
            <h2>Messages you can send</h2>
            <label className="auth-label" htmlFor="review-sms"><span>Text message</span></label>
            <textarea id="review-sms" className="auth-input" rows={fitRows(texts.smsText)} readOnly value={texts.smsText} onFocus={(event) => event.currentTarget.select()} />
            <button className="icon-btn" type="button" onClick={() => void copy("sms", texts.smsText)}><Copy size={16} /> {copied === "sms" ? "Text copied" : "Copy text message"}</button>
            <label className="auth-label" htmlFor="review-email"><span>Email (subject: {texts.emailSubject})</span></label>
            <textarea id="review-email" className="auth-input" rows={fitRows(texts.emailBody)} readOnly value={texts.emailBody} onFocus={(event) => event.currentTarget.select()} />
            <button className="icon-btn" type="button" onClick={() => void copy("email", `Subject: ${texts.emailSubject}\n\n${texts.emailBody}`)}><Copy size={16} /> {copied === "email" ? "Email copied" : "Copy email"}</button>
          </section>
        </> : null}

        <section className="panel panel-wide no-print" data-testid="review-rules">
          <h2>Ask the right way</h2>
          <ul className="rewards-steps">{reviewFairnessNotes.map((note) => <li key={note}>{note}</li>)}</ul>
        </section>
      </> : null}
    </section></main>
  );
}
