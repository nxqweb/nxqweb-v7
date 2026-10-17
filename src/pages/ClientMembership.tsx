import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Trash2, Users } from "lucide-react";
import { dueSoon, emptyMembership, friendlyMembershipError, maxMembers, maxTiers, memberProblem, memberStatusLabel, renewalLabel, todayLocal, type MemberInput, type MemberRow, type MemberStatus, type MembershipData, type OwnerMembershipGateway, type TierInput } from "../lib/membershipGateway";

const blankMember: MemberInput = { id: null, email: "", fullName: "", phone: "", tierId: "", status: "active", renewsOn: "", notes: "" };
const blankTier: TierInput = { id: null, name: "", perks: "", active: true };

// Track a club or loyalty membership for the business's own customers. It only keeps the list: it does not charge anyone, send email or lock products.
export function ClientMembership({ gateway }: { gateway: OwnerMembershipGateway | null }) {
  const [data, setData] = useState<MembershipData>(emptyMembership);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tier, setTier] = useState<TierInput>(blankTier);
  const [member, setMember] = useState<MemberInput>(blankMember);
  const [filter, setFilter] = useState<MemberStatus | "">("");
  const [search, setSearch] = useState("");
  const today = todayLocal();

  const reload = useCallback(async () => { if (gateway) setData(await gateway.load()); }, [gateway]);
  useEffect(() => {
    (async () => {
      if (!gateway) { setLoaded(true); return; }
      try { await reload(); } catch (failure) { setError(friendlyMembershipError(failure instanceof Error ? failure.message : "")); }
      setLoaded(true);
    })();
  }, [gateway, reload]);

  async function run(key: string, work: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(key); setError(""); setNotice("");
    try { await work(); await reload(); if (message) setNotice(message); } catch (failure) { setError(friendlyMembershipError(failure instanceof Error ? failure.message : "")); }
    setBusy("");
  }

  const tierName = useMemo(() => new Map(data.tiers.map((t) => [t.id, t.name])), [data.tiers]);
  const activeTiers = data.tiers.filter((t) => t.active);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.members.filter((m) => (!filter || m.status === filter) && (!q || m.email.includes(q) || m.fullName.toLowerCase().includes(q)));
  }, [data.members, filter, search]);
  const due = dueSoon(data.members, today);

  function saveTier() {
    const name = tier.name.trim();
    if (!name || name.length > 80) { setError("Give the tier a name of 1 to 80 characters."); return; }
    if (tier.perks.trim().length > 500) { setError("Perks must be 500 characters or fewer."); return; }
    void run("tier", async () => { await gateway!.saveTier({ ...tier, name, perks: tier.perks.trim() }); setTier(blankTier); }, tier.id ? "Tier saved." : "Tier added.");
  }
  function toggleTier(id: string, active: boolean) {
    const found = data.tiers.find((t) => t.id === id); if (!found) return;
    void run("tier", async () => gateway!.saveTier({ id, name: found.name, perks: found.perks, active }), active ? "Tier is on again." : "Tier paused. Its members stop counting as active members.");
  }
  function saveMember() {
    const input = { ...member, email: member.email.trim().toLowerCase() };
    const problem = memberProblem(input, today);
    if (problem) { setError(problem); return; }
    void run("member", async () => { await gateway!.saveMember(input); setMember(blankMember); }, member.id ? "Member saved." : "Member added.");
  }
  function editMember(row: MemberRow) { setMember({ id: row.id, email: row.email, fullName: row.fullName, phone: row.phone, tierId: row.tierId, status: row.status, renewsOn: row.renewsOn, notes: row.notes }); setError(""); setNotice(""); document.getElementById("mem-email")?.focus(); }
  function removeMember(row: MemberRow) {
    if (!window.confirm(`Remove ${row.fullName || row.email}? Their details will be erased from your list. This cannot be undone.`)) return;
    void run(`mem-${row.id}`, async () => { await gateway!.removeMember(row.id); if (member.id === row.id) setMember(blankMember); }, "Member removed.");
  }

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row">
        <div className="panel-title"><Users size={22} /><div><h1>Members</h1><p className="subtle">Keep a list of your club or loyalty members, their tier and when they renew. You bill them yourself. Nothing here charges anyone or sends messages.</p></div></div>
        <div className="client-control-row"><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Portal</a></div>
      </div>
      {!gateway ? <div className="empty-state" role="status" data-testid="membership-unavailable">This feature is not open yet. Check back soon.</div> : null}
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {notice ? <div className="auth-success" role="status">{notice}</div> : null}
      {gateway && !loaded ? <div className="empty-state" role="status">Loading...</div> : null}

      {gateway && loaded ? <>
        <section className="panel panel-wide" data-testid="membership-summary">
          <h2>At a glance</h2>
          <p><strong>{data.members.filter((m) => m.status === "active").length}</strong> active members · <strong>{data.tiers.filter((t) => t.active).length}</strong> tiers</p>
          {due.length > 0 ? <p className="subtle" data-testid="membership-due">{due.length} {due.length === 1 ? "member renews" : "members renew"} within 2 weeks or {due.length === 1 ? "is" : "are"} overdue: {due.slice(0, 5).map((m) => m.fullName || m.email).join(", ")}{due.length > 5 ? "..." : ""}.</p> : <p className="subtle">No renewals due in the next 2 weeks.</p>}
        </section>

        <section className="panel panel-wide" data-testid="membership-tiers">
          <h2>Tiers</h2>
          {data.tiers.length === 0 ? <div className="empty-state">No tiers yet. Add your first one below, like "Candle Club".</div> : data.tiers.map((t) => (
            <div className="owner-message-card" key={t.id}><strong>{t.name}</strong> {t.active ? null : <span className="status-summary">paused</span>}
              {t.perks ? <div className="subtle">{t.perks}</div> : null}
              <div className="review-actions">
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => { setTier({ id: t.id, name: t.name, perks: t.perks, active: t.active }); setError(""); setNotice(""); document.getElementById("tier-name")?.focus(); }}>Edit</button>
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => toggleTier(t.id, !t.active)}>{t.active ? "Pause tier" : "Turn tier on"}</button>
              </div>
            </div>
          ))}
          <h3>{tier.id ? "Edit tier" : "Add a tier"}</h3>
          <label className="auth-label" htmlFor="tier-name"><span>Tier name</span></label>
          <input id="tier-name" className="auth-input" maxLength={80} value={tier.name} onChange={(e) => setTier((c) => ({ ...c, name: e.target.value }))} />
          <label className="auth-label" htmlFor="tier-perks"><span>What members get (optional, just a note for you)</span></label>
          <textarea id="tier-perks" className="auth-input" rows={2} maxLength={500} value={tier.perks} onChange={(e) => setTier((c) => ({ ...c, perks: e.target.value }))} />
          <div className="review-actions">
            <button className="wide-btn" type="button" disabled={Boolean(busy) || (!tier.id && data.tiers.length >= maxTiers)} onClick={saveTier}>{busy === "tier" ? "Saving..." : tier.id ? "Save tier" : "Add tier"}</button>
            {tier.id ? <button className="icon-btn" type="button" onClick={() => setTier(blankTier)}>Cancel</button> : null}
          </div>
          {data.tiers.length >= maxTiers ? <p className="subtle">You have the most tiers you can have ({maxTiers}).</p> : null}
        </section>

        <section className="panel panel-wide" data-testid="membership-members">
          <h2>Members</h2>
          <label className="auth-label" htmlFor="mem-filter"><span>Show</span></label>
          <select id="mem-filter" className="auth-input" value={filter} onChange={(e) => setFilter(e.target.value as MemberStatus | "")}>
            <option value="">Everyone</option><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option>
          </select>
          <label className="auth-label" htmlFor="mem-search"><span>Search by name or email</span></label>
          <input id="mem-search" className="auth-input" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
          {data.members.length === 0 ? <div className="empty-state">No members yet. Add the first one below.</div> : shown.length === 0 ? <div className="empty-state">No members match.</div> : shown.map((m) => (
            <article className="owner-message-card" key={m.id} data-testid="membership-member">
              <strong>{m.fullName || m.email}</strong> <span className="status-summary">{memberStatusLabel[m.status]}</span>
              <div>{tierName.get(m.tierId) ?? "Tier removed"} · {m.status === "active" ? renewalLabel(m.renewsOn, today) : m.renewsOn || "No renewal date"}</div>
              <div className="subtle"><a href={`mailto:${m.email}`}>{m.email}</a>{m.phone ? <> · <a href={`tel:${m.phone.replace(/[^0-9+]/g, "")}`}>{m.phone}</a></> : null}</div>
              {m.notes ? <p className="subtle">{m.notes}</p> : null}
              <div className="review-actions">
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => editMember(m)}>Edit</button>
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => removeMember(m)}><Trash2 size={16} /> Remove</button>
              </div>
            </article>
          ))}

          <h3>{member.id ? "Edit member" : "Add a member"}</h3>
          {activeTiers.length === 0 && !member.id ? <p className="subtle" data-testid="membership-needs-tier">Add a tier first, then you can add members.</p> : null}
          <label className="auth-label" htmlFor="mem-email"><span>Email</span></label>
          <input id="mem-email" className="auth-input" type="email" maxLength={254} value={member.email} onChange={(e) => setMember((c) => ({ ...c, email: e.target.value }))} />
          <label className="auth-label" htmlFor="mem-name"><span>Name (optional)</span></label>
          <input id="mem-name" className="auth-input" maxLength={160} value={member.fullName} onChange={(e) => setMember((c) => ({ ...c, fullName: e.target.value }))} />
          <label className="auth-label" htmlFor="mem-phone"><span>Phone (optional)</span></label>
          <input id="mem-phone" className="auth-input" maxLength={80} value={member.phone} onChange={(e) => setMember((c) => ({ ...c, phone: e.target.value }))} />
          <label className="auth-label" htmlFor="mem-tier"><span>Tier</span></label>
          <select id="mem-tier" className="auth-input" value={member.tierId} onChange={(e) => setMember((c) => ({ ...c, tierId: e.target.value }))}>
            <option value="">Choose a tier</option>
            {(member.tierId && !activeTiers.some((t) => t.id === member.tierId) ? data.tiers.filter((t) => t.id === member.tierId) : []).concat(activeTiers).map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (paused)"}</option>)}
          </select>
          <label className="auth-label" htmlFor="mem-status"><span>Status</span></label>
          <select id="mem-status" className="auth-input" value={member.status} onChange={(e) => setMember((c) => ({ ...c, status: e.target.value as MemberStatus }))}>
            <option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option>
          </select>
          <label className="auth-label" htmlFor="mem-renews"><span>Renews on (optional)</span></label>
          <input id="mem-renews" className="auth-input" type="date" value={member.renewsOn} onChange={(e) => setMember((c) => ({ ...c, renewsOn: e.target.value }))} />
          <label className="auth-label" htmlFor="mem-notes"><span>Notes (only you see these)</span></label>
          <textarea id="mem-notes" className="auth-input" rows={2} maxLength={500} value={member.notes} onChange={(e) => setMember((c) => ({ ...c, notes: e.target.value }))} />
          <div className="review-actions">
            <button className="wide-btn" type="button" disabled={Boolean(busy) || (!member.id && (activeTiers.length === 0 || data.members.length >= maxMembers))} onClick={saveMember}>{busy === "member" ? "Saving..." : member.id ? "Save member" : "Add member"}</button>
            {member.id ? <button className="icon-btn" type="button" onClick={() => setMember(blankMember)}>Cancel</button> : null}
          </div>
        </section>
      </> : null}
    </section></main>
  );
}
