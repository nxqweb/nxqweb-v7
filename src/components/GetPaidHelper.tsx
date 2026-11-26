import { useState } from "react";
import { ExternalLink, Wallet } from "lucide-react";
import { checkRulesNote, otherWaysNote, payGuides, testablePayLink } from "../lib/getPaidHelp";
import type { PayProvider } from "../lib/getPaidHelp";

// Plain help for the payment boxes on the Live store page: pick how you get paid, follow three steps, then try your link in a new tab.
// It reads what is typed in the boxes above; it saves nothing and never talks to the server.
export function GetPaidHelper({ links }: { links: Record<PayProvider, string> }) {
  const [open, setOpen] = useState<PayProvider | null>(null);
  const guide = payGuides.find((item) => item.provider === open) || null;
  const test = guide ? testablePayLink(guide.provider, links[guide.provider]) : null;

  return (
    <div className="settings-card" data-testid="get-paid-helper" data-tour="live-get-paid" style={{ marginTop: ".75rem" }}>
      <div className="panel-title"><Wallet size={18} aria-hidden="true" /><div><strong>Need help getting a payment link?</strong><p className="subtle">You only need ONE. Pick the one you use and follow the steps.</p></div></div>
      <div className="settings-grid" role="group" aria-label="Payment link help">
        {payGuides.map((item) => (
          <button aria-expanded={open === item.provider} className={open === item.provider ? "wide-btn" : "icon-btn"} key={item.provider} type="button" onClick={() => setOpen(open === item.provider ? null : item.provider)}>
            {item.name}
          </button>
        ))}
      </div>
      {guide && test ? (
        <div data-testid="get-paid-steps" style={{ marginTop: ".75rem" }}>
          <p className="subtle">{guide.bestFor}</p>
          <ol>{guide.steps.map((line) => <li key={line}>{line}</li>)}</ol>
          {test.ok
            ? <a className="icon-btn" href={test.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" /> Test my {guide.name} link (opens in a new tab)</a>
            : <p className="subtle" role="status">{test.reason}</p>}
          {test.ok ? <p className="subtle" style={{ marginTop: ".5rem" }}>If the page that opens shows your name or your shop, the link works. Remember to press Save private draft.</p> : null}
        </div>
      ) : null}
      <p className="subtle" style={{ marginTop: ".75rem" }}>{otherWaysNote}</p>
      <p className="subtle">{checkRulesNote}</p>
    </div>
  );
}
