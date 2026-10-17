import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Gift, RefreshCcw, Share2, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { creditEntryLabel, friendlyRewardsError, genericRewardsError, grantStatusSentence, money, referralStatusSentence, shareText, wholeDollars } from "../lib/rewardsCopy";
import { OptionalSection } from "../components/OptionalSection";

type Referral = { id: string; status: string; attributed_at: string; hold_until?: string | null };
type Ledger = { id: string; entry_type: string; status: string; amount: number; remaining_amount: number; description: string; created_at: string };
type Dashboard = {
  profile?: { referral_code?: string; status?: string };
  program?: { enabled?: boolean; reward?: number; first_month_discount?: number; minimum_payment?: number; hold_days?: number; grant_enrollment_open?: boolean; grant_monthly_cost_cap?: number };
  balances?: { pending?: number; available?: number; applied?: number };
  referrals?: Referral[];
  ledger?: Ledger[];
  grant_application?: { status?: string; cohort_position?: number } | null;
  grant_award?: { status?: string; monthly_nxq_cost_cap?: number } | null;
};

export function ClientRewards() {
  const [data, setData] = useState<Dashboard>({});
  const [code, setCode] = useState("");
  const [statement, setStatement] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setError("Rewards are unavailable right now."); setLoaded(true); return; }
    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) { window.location.replace("/portal/login"); return; }
    setBusy(true); setError("");
    const result = await supabase.rpc("nxq_referral_dashboard");
    setBusy(false); setLoaded(true);
    if (result.error) { setError(genericRewardsError); return; }
    setData((result.data || {}) as Dashboard);
  }, []);
  useEffect(() => { void load(); return () => window.clearTimeout(copiedTimer.current); }, [load]);

  async function call(name: string, args: Record<string, unknown>, message: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setNotice("");
    const result = await supabase.rpc(name, args);
    setBusy(false);
    if (result.error) { setError(friendlyRewardsError(result.error.message)); return; }
    setNotice(message);
    await load();
  }

  const program = data.program || {};
  const balances = data.balances || {};
  const shareUrl = data.profile?.referral_code ? `${window.location.origin}/portal/signup?ref=${data.profile.referral_code}` : "";
  const friendDiscount = wholeDollars(program.first_month_discount, 10);
  const reward = wholeDollars(program.reward, 10);
  const holdDays = Number(program.hold_days) > 0 ? Number(program.hold_days) : 14;

  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setError(""); window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); setError("Could not copy automatically. Select the link above and copy it by hand."); }
  }
  async function shareLink() {
    const text = shareText(shareUrl);
    try {
      if (typeof navigator.share === "function") await navigator.share({ title: "NXQX-Web", text, url: shareUrl });
      else await copyLink();
    } catch { /* the person closed the share sheet */ }
  }

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row">
        <div className="panel-title"><Gift size={22} /><div><h1>Rewards</h1><p className="subtle">Invite a friend. When they join and pay, you both get a discount on your NXQX-Web bill.</p></div></div>
        <div className="client-control-row"><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Portal</a><button className="icon-btn" type="button" onClick={() => void load()} disabled={busy}><RefreshCcw size={16} /> Refresh</button></div>
      </div>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {notice ? <div className="auth-success" role="status">{notice}</div> : null}
      {!loaded ? <div className="empty-state" role="status">Loading your rewards...</div> : null}

      {loaded ? <>
        <section className="panel panel-wide" data-testid="rewards-invite">
          <h2>Your invite link</h2>
          {program.enabled ? <>
            <ol className="rewards-steps">
              <li>Send your link to a friend who owns a business.</li>
              <li>They sign up with it and get <strong>{friendDiscount} off</strong> their first bill.</li>
              <li>After their first payment clears and a {holdDays}-day review, you get <strong>{reward} off</strong> your bill.</li>
            </ol>
            <label className="auth-label" htmlFor="rewards-link"><span>Your link</span></label>
            <input id="rewards-link" className="auth-input" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
            <div className="settings-grid">
              <button className="wide-btn" type="button" disabled={!shareUrl} onClick={() => void copyLink()}><Copy size={16} /> {copied ? "Link copied" : "Copy link"}</button>
              <button className="icon-btn" type="button" disabled={!shareUrl} onClick={() => void shareLink()}><Share2 size={16} /> Share</button>
            </div>
          </> : <div className="empty-state">Referrals are not open yet. Your link is saved and will work as soon as they open.</div>}
          <p className="subtle">Rewards are credit on your bill. They are not cash, cannot be transferred, and can never lower a bill below {money(program.minimum_payment || 10)}.</p>
        </section>

        <section className="panel panel-wide" data-testid="rewards-balance">
          <h2>Your credit</h2>
          <div className="client-control-row">
            <span className="status-summary">Ready to use {money(balances.available)}</span>
            <span className="status-summary">Waiting for review {money(balances.pending)}</span>
            <span className="status-summary">Already used {money(balances.applied)}</span>
          </div>
          <p className="subtle">Credit you have not used yet stays on your account and is taken off your next bill automatically.</p>
        </section>

        <OptionalSection defaultOpen={false} title="Did a friend give you a code?" hint="Type it here if you did not use their link.">
          <div className="client-control-row">
            <input className="auth-input" aria-label="Referral code" value={code} maxLength={20} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="Example: NXQ1A2B3C4D5" />
            <button className="wide-btn" type="button" disabled={busy || code.length < 8 || !program.enabled} onClick={() => void call("nxq_claim_referral", { target_referral_code: code }, `Code added. You get ${friendDiscount} off your first bill.`)}>Apply code</button>
          </div>
          {!program.enabled ? <p className="subtle">Codes can be added once referrals open.</p> : null}
        </OptionalSection>

        <section className="panel panel-wide" data-testid="rewards-friends">
          <h2>Your friends</h2>
          {(data.referrals || []).length === 0 ? <div className="empty-state">No friends yet. Share your link to get started.</div>
            : (data.referrals || []).map((row) => <div className="owner-message-card" key={row.id}><strong>{referralStatusSentence(row.status, row.hold_until)}</strong><span className="subtle rewards-meta">Joined with your link on {new Date(row.attributed_at).toLocaleDateString()}</span></div>)}
        </section>

        <OptionalSection defaultOpen={Boolean(data.grant_award || data.grant_application)} title="Founding Business Grant" hint="A small group of early clients may be chosen for a managed website grant.">
          <p className="subtle">Ten clients chosen by the owner among the first 10,000 paying clients. One basic website per business, up to {wholeDollars(program.grant_monthly_cost_cap, 50)} of NXQX cost a month. No cash value, and it does not cover domains, ads or outside fees.</p>
          {data.grant_award ? <div className="auth-success" role="status">{grantStatusSentence(data.grant_award.status)}</div>
            : data.grant_application ? <div className="status-summary">{grantStatusSentence(data.grant_application.status, data.grant_application.cohort_position)}</div>
            : program.grant_enrollment_open ? <>
              <label className="auth-label" htmlFor="grant-statement"><span>How would a managed website help your business?</span></label>
              <textarea id="grant-statement" className="auth-input" rows={4} value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="A few honest sentences is enough." />
              <p className="subtle">{statement.trim().length} of at least 30 characters</p>
              <button className="wide-btn" type="button" disabled={busy || statement.trim().length < 30} onClick={() => void call("nxq_submit_founding_grant_application", { target_statement: statement }, "Application sent. We will review it.")}><ShieldCheck size={16} /> Send application</button>
            </> : <div className="empty-state">Applications are not open yet.</div>}
        </OptionalSection>

        <OptionalSection defaultOpen={false} title="Credit history" hint="Every credit added or used on your account.">
          {(data.ledger || []).length === 0 ? <div className="empty-state">No credit entries yet.</div>
            : (data.ledger || []).map((row) => <div className="owner-message-card" key={row.id}><strong>{creditEntryLabel(row.description, row.status)}</strong><span className="subtle rewards-meta">{money(row.amount)} · {money(row.remaining_amount)} left · {new Date(row.created_at).toLocaleDateString()}</span></div>)}
        </OptionalSection>
      </> : null}
    </section></main>
  );
}
