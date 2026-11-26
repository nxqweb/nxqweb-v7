import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarCheck, Copy, ExternalLink, Trash2 } from "lucide-react";
import { serviceKeyFromName, timeZoneChoices, weekdayDisplayOrder, weekdayNames } from "../lib/bookingForm";
import { defaultDay, draftToHours, hoursProblem, hoursToDraft, type DayDraft } from "../lib/bookingHours";
import { formatSlot, isValidTimeZone, type HoursPeriod } from "../lib/bookingTime";
import { bookingStatusLabel, emptyBookingSetup, friendlyOwnerBookingError, type BookingRequestRow, type BookingRequestStatus, type BookingSetup, type OwnerBookingGateway } from "../lib/bookingGateway";

// Request-only booking for the business: set up the page, then answer the requests that come in. Nothing here confirms, charges or messages anyone.
export function ClientBooking({ gateway }: { gateway: OwnerBookingGateway | null }) {
  const [setup, setSetup] = useState<BookingSetup>(emptyBookingSetup);
  const [requests, setRequests] = useState<BookingRequestRow[]>([]);
  const [filter, setFilter] = useState<BookingRequestStatus | "">("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const [zone, setZone] = useState("America/Los_Angeles");
  const [page, setPage] = useState({ displayName: "", intro: "", publicSlug: "", timezone: "America/Los_Angeles", lead: "120", advance: "90", policy: "" });
  const [service, setService] = useState({ name: "", minutes: "60" });
  const [days, setDays] = useState<DayDraft[]>(() => Array.from({ length: 7 }, () => ({ ...defaultDay })));
  const [extras, setExtras] = useState<HoursPeriod[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Always shows the latest saved state. The page-settings form and the hours editor are only refreshed when asked (right after THEY were saved or on first load),
  // so something typed in one section is never wiped by saving or clicking in another.
  const adopt = useCallback((next: BookingSetup, refresh: { settings?: boolean; hours?: boolean } = {}) => {
    setSetup(next);
    if (refresh.settings) setPage({ displayName: next.displayName, intro: next.intro, publicSlug: next.publicSlug, timezone: next.timezone, lead: String(next.minimumLeadMinutes), advance: String(next.maximumAdvanceDays), policy: next.cancellationPolicy });
    if (refresh.hours) { const draft = hoursToDraft(next.hours); setDays(draft.days); setExtras(draft.extras); }
  }, []);
  const requestSeq = useRef(0);
  const loadRequests = useCallback(async (status: BookingRequestStatus | "") => {
    if (!gateway) return;
    const mine = ++requestSeq.current; // a slower, older answer must never replace a newer one
    try { const rows = await gateway.listRequests(status); if (mine === requestSeq.current) setRequests(rows); }
    catch { if (mine === requestSeq.current) setError("Your requests could not be loaded right now. Please try again shortly."); }
  }, [gateway]);
  useEffect(() => {
    (async () => {
      if (!gateway) { setLoaded(true); return; }
      try { const next = await gateway.load(); adopt(next, { settings: true, hours: true }); if (next.hasWorkspace) await loadRequests(""); } catch { setError("Your booking settings could not be loaded right now. Please try again shortly."); }
      setLoaded(true);
    })();
    return () => window.clearTimeout(copiedTimer.current);
  }, [gateway, adopt, loadRequests]);

  async function run(key: string, work: () => Promise<void>, message: string) {
    if (busy) return;
    setBusy(key); setError(""); setNotice("");
    try { await work(); if (message) setNotice(message); } catch (failure) { setError(friendlyOwnerBookingError(failure instanceof Error ? failure.message : "")); }
    setBusy("");
  }

  const publicUrl = setup.publicSlug ? `${window.location.origin}/book/${setup.publicSlug}` : "";
  async function copyLink() {
    try { await navigator.clipboard.writeText(publicUrl); setCopied(true); window.clearTimeout(copiedTimer.current); copiedTimer.current = window.setTimeout(() => setCopied(false), 2500); }
    catch { setError("Could not copy automatically. Select the link and copy it by hand."); }
  }

  function saveSettings() {
    const lead = Number(page.lead); const advance = Number(page.advance);
    if (!Number.isInteger(lead) || lead < 0 || lead > 43200) { setError("Notice time must be a whole number of minutes between 0 and 43200 (30 days)."); return; }
    if (!Number.isInteger(advance) || advance < 1 || advance > 365) { setError("How far ahead people can ask must be between 1 and 365 days."); return; }
    if (!isValidTimeZone(page.timezone)) { setError("Choose a valid time zone."); return; }
    if (setup.displayName && !page.displayName.trim()) { setError("Your page needs a name. Type one before saving."); return; }
    if (setup.publicSlug && !page.publicSlug.trim()) { setError("Your page needs an address. Type one before saving."); return; }
    void run("settings", async () => adopt(await gateway!.saveSettings({ displayName: page.displayName, intro: page.intro, timezone: page.timezone, minimumLeadMinutes: lead, maximumAdvanceDays: advance, cancellationPolicy: page.policy, publicSlug: page.publicSlug.trim().toLowerCase() }), { settings: true }), "Saved.");
  }
  function addService() {
    const minutes = Number(service.minutes);
    if (service.name.trim().length < 2) { setError("Give the service a name (at least 2 characters)."); return; }
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) { setError("A service must last between 5 minutes and 8 hours."); return; }
    void run("service", async () => { adopt(await gateway!.saveService({ serviceKey: serviceKeyFromName(service.name, setup.services.map((s) => s.serviceKey)), name: service.name.trim(), durationMinutes: minutes, active: true })); setService({ name: "", minutes: "60" }); }, "Service added.");
  }
  function toggleService(key: string, active: boolean) {
    const found = setup.services.find((s) => s.serviceKey === key); if (!found) return;
    void run("service", async () => adopt(await gateway!.saveService({ serviceKey: key, name: found.name, durationMinutes: found.durationMinutes, active })), active ? "Service shown on your page." : "Service hidden from your page.");
  }
  function saveHours() {
    const problem = hoursProblem(days);
    if (problem) { setError(problem); return; }
    void run("hours", async () => {
      const wasOn = setup.publicEnabled;
      const next = await gateway!.saveHours(draftToHours(days, extras));
      adopt(next, { hours: true });
      if (wasOn && !next.publicEnabled) { setNotice("Opening hours saved. Your booking page was turned off because it needs opening hours. Add hours and turn it on again."); }
      else setNotice("Opening hours saved.");
    }, "");
  }
  function updateRequest(row: BookingRequestRow, status: BookingRequestStatus) {
    void run(`req-${row.id}`, async () => { await gateway!.updateRequest(row.id, status, notes[row.id] ?? row.ownerNote); await loadRequests(filter); adopt(await gateway!.load()); }, `Marked as ${bookingStatusLabel[status].toLowerCase()}.`);
  }
  function removeRequest(row: BookingRequestRow) {
    if (!window.confirm(`Delete this request from ${row.contactName}? Their name and contact details will be erased. This cannot be undone.`)) return;
    void run(`req-${row.id}`, async () => { await gateway!.deleteRequest(row.id); await loadRequests(filter); adopt(await gateway!.load()); }, "Request deleted.");
  }

  const ready = setup.hasWorkspace;
  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row">
        <div className="panel-title"><CalendarCheck size={22} /><div><h1>Appointment requests</h1><p className="subtle">Customers pick a time and send a request. You reply yourself. Nothing is confirmed or charged automatically.</p></div></div>
        <div className="client-control-row"><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Portal</a></div>
      </div>
      {!gateway ? <div className="empty-state" role="status" data-testid="booking-unavailable">This feature is not open yet. Check back soon.</div> : null}
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {notice ? <div className="auth-success" role="status">{notice}</div> : null}
      {gateway && !loaded ? <div className="empty-state" role="status">Loading...</div> : null}

      {gateway && loaded && !ready ? (
        <section className="panel panel-wide" data-testid="booking-start">
          <h2>Start taking appointment requests</h2>
          <p className="subtle">Choose your time zone. You can change everything later.</p>
          <label className="auth-label" htmlFor="start-zone"><span>Your time zone</span></label>
          <select id="start-zone" className="auth-input" value={zone} onChange={(e) => setZone(e.target.value)}>{timeZoneChoices.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}</select>
          <button className="wide-btn" type="button" disabled={Boolean(busy)} onClick={() => void run("ensure", async () => { adopt(await gateway.ensure(zone), { settings: true, hours: true }); await loadRequests(""); }, "Booking is set up. Add your services and hours below.")}>{busy === "ensure" ? "Setting up..." : "Set up booking"}</button>
        </section>
      ) : null}

      {gateway && loaded && ready ? <>
        <section className="panel panel-wide" data-testid="booking-status">
          <h2>Your booking page is {setup.publicEnabled ? "on" : "off"}</h2>
          {setup.publicEnabled && publicUrl ? <>
            <label className="auth-label" htmlFor="book-link"><span>Link to share</span></label>
            <input id="book-link" className="auth-input" readOnly value={publicUrl} onFocus={(e) => e.currentTarget.select()} />
            <div className="review-actions">
              <button className="wide-btn" type="button" onClick={() => void copyLink()}><Copy size={16} /> {copied ? "Link copied" : "Copy link"}</button>
              <a className="icon-btn" href={publicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Open my page</a>
            </div>
            {!setup.services.some((x) => x.active) ? <p className="auth-error" role="status" data-testid="booking-no-active-service">Your page shows as closed to visitors until at least one service is shown. Show a service below.</p> : null}
          </> : <p className="subtle">Fill in the page name, address, a service and your hours below, then turn it on.</p>}
          <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => void run("public", async () => adopt(await gateway.setPublic(!setup.publicEnabled)), setup.publicEnabled ? "Your page is off. Visitors can no longer send requests." : "Your page is on. Share the link.")}>{setup.publicEnabled ? "Turn page off" : "Turn page on"}</button>
        </section>

        <section className="panel panel-wide" data-testid="booking-requests">
          <h2>Requests {setup.newRequests > 0 ? <span className="status-summary">{setup.newRequests} new</span> : null}</h2>
          <label className="auth-label" htmlFor="req-filter"><span>Show</span></label>
          <select id="req-filter" className="auth-input" value={filter} onChange={(e) => { const next = e.target.value as BookingRequestStatus | ""; setFilter(next); void loadRequests(next); }}>
            <option value="">All requests</option><option value="requested">New</option><option value="needs_review">In progress</option><option value="declined">Declined</option><option value="cancelled">Cancelled</option>
          </select>
          {requests.length === 0 ? <div className="empty-state">No requests yet. When someone asks for a time, it shows up here.</div> : requests.map((row) => (
            <article className="owner-message-card booking-request" key={row.id} data-testid="booking-request">
              <strong>{row.contactName}</strong> <span className="status-summary">{bookingStatusLabel[row.status] ?? row.status}</span>
              <div>{row.serviceName || "Service removed"} · {Number.isNaN(Date.parse(row.requestedStartAt)) ? "" : formatSlot(Date.parse(row.requestedStartAt), row.timezone || setup.timezone, true)}</div>
              <div className="subtle">{row.contactEmail ? <a href={`mailto:${row.contactEmail}`}>{row.contactEmail}</a> : null}{row.contactEmail && row.contactPhone ? " · " : ""}{row.contactPhone ? <a href={`tel:${row.contactPhone.replace(/[^0-9+]/g, "")}`}>{row.contactPhone}</a> : null}</div>
              {row.notes ? <p className="subtle">“{row.notes}”</p> : null}
              <label className="auth-label" htmlFor={`note-${row.id}`}><span>Your note (only you see this)</span></label>
              <input id={`note-${row.id}`} className="auth-input" maxLength={500} value={notes[row.id] ?? row.ownerNote} onChange={(e) => setNotes((c) => ({ ...c, [row.id]: e.target.value }))} />
              <div className="review-actions">
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => updateRequest(row, "needs_review")}>I'm on it</button>
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => updateRequest(row, "declined")}>Decline</button>
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => updateRequest(row, "cancelled")}>Mark cancelled</button>
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => updateRequest(row, "requested")}>Mark new</button>
                <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => removeRequest(row)}><Trash2 size={16} /> Delete</button>
              </div>
            </article>
          ))}
          {requests.length >= 200 ? <p className="subtle" data-testid="booking-requests-capped">Showing the newest 200 requests. Delete old ones to see earlier ones.</p> : null}
          <p className="subtle">Reply to each person yourself by email or phone. NXQX-Web does not confirm appointments, send reminders or take payments.</p>
        </section>

        <section className="panel panel-wide" data-testid="booking-page-settings">
          <h2>Your page</h2>
          <label className="auth-label" htmlFor="bk-name"><span>Page name (customers see this)</span></label>
          <input id="bk-name" className="auth-input" maxLength={80} value={page.displayName} onChange={(e) => setPage((c) => ({ ...c, displayName: e.target.value }))} />
          <label className="auth-label" htmlFor="bk-intro"><span>Short intro (optional)</span></label>
          <textarea id="bk-intro" className="auth-input" rows={3} maxLength={600} value={page.intro} onChange={(e) => setPage((c) => ({ ...c, intro: e.target.value }))} />
          <label className="auth-label" htmlFor="bk-slug"><span>Page address</span></label>
          <input id="bk-slug" className="auth-input" maxLength={60} placeholder="my-salon" value={page.publicSlug} onChange={(e) => setPage((c) => ({ ...c, publicSlug: e.target.value }))} />
          <p className="subtle">Your link will be {window.location.origin}/book/{page.publicSlug.trim().toLowerCase() || "your-address"}</p>
          <label className="auth-label" htmlFor="bk-zone"><span>Time zone</span></label>
          <select id="bk-zone" className="auth-input" value={page.timezone} onChange={(e) => setPage((c) => ({ ...c, timezone: e.target.value }))}>
            {(timeZoneChoices.some((z) => z.value === page.timezone) ? timeZoneChoices : [{ value: page.timezone, label: page.timezone }, ...timeZoneChoices]).map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
          </select>
          <label className="auth-label" htmlFor="bk-lead"><span>Minimum notice (minutes)</span></label>
          <input id="bk-lead" className="auth-input" inputMode="numeric" value={page.lead} onChange={(e) => setPage((c) => ({ ...c, lead: e.target.value }))} />
          <label className="auth-label" htmlFor="bk-adv"><span>How far ahead people can ask (days)</span></label>
          <input id="bk-adv" className="auth-input" inputMode="numeric" value={page.advance} onChange={(e) => setPage((c) => ({ ...c, advance: e.target.value }))} />
          <label className="auth-label" htmlFor="bk-policy"><span>Cancellation note (optional, shown to customers)</span></label>
          <textarea id="bk-policy" className="auth-input" rows={2} maxLength={600} value={page.policy} onChange={(e) => setPage((c) => ({ ...c, policy: e.target.value }))} />
          <button className="wide-btn" type="button" disabled={Boolean(busy)} onClick={saveSettings}>{busy === "settings" ? "Saving..." : "Save page settings"}</button>
        </section>

        <section className="panel panel-wide" data-testid="booking-services">
          <h2>Services</h2>
          {setup.services.length === 0 ? <div className="empty-state">No services yet. Add the first one below.</div> : setup.services.map((s) => (
            <div className="owner-message-card" key={s.serviceKey}><strong>{s.name}</strong> · {s.durationMinutes} min {s.active ? null : <span className="status-summary">hidden</span>}
              <div><button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => toggleService(s.serviceKey, !s.active)}>{s.active ? "Hide from page" : "Show on page"}</button></div></div>
          ))}
          <label className="auth-label" htmlFor="svc-name"><span>New service name</span></label>
          <input id="svc-name" className="auth-input" maxLength={120} placeholder="Haircut" value={service.name} onChange={(e) => setService((c) => ({ ...c, name: e.target.value }))} />
          <label className="auth-label" htmlFor="svc-min"><span>How long it takes (minutes)</span></label>
          <input id="svc-min" className="auth-input" inputMode="numeric" value={service.minutes} onChange={(e) => setService((c) => ({ ...c, minutes: e.target.value }))} />
          <button className="wide-btn" type="button" disabled={Boolean(busy)} onClick={addService}>{busy === "service" ? "Saving..." : "Add service"}</button>
        </section>

        <section className="panel panel-wide" data-testid="booking-hours">
          <h2>Opening hours</h2>
          <p className="subtle">Customers can only ask for times inside these hours, in {setup.timezone.replace(/_/g, " ")}.</p>
          {weekdayDisplayOrder.map((weekday) => (
            <div className="booking-hours-row" key={weekday}>
              <label className="booking-hours-day"><input type="checkbox" checked={days[weekday].open} onChange={(e) => setDays((c) => c.map((d, i) => (i === weekday ? { ...d, open: e.target.checked } : d)))} /> <span>{weekdayNames[weekday]}</span></label>
              {days[weekday].open ? <>
                <input className="auth-input" type="time" step={300} aria-label={`${weekdayNames[weekday]} opens`} value={days[weekday].start} onChange={(e) => setDays((c) => c.map((d, i) => (i === weekday ? { ...d, start: e.target.value } : d)))} />
                <span aria-hidden="true">to</span>
                <input className="auth-input" type="time" step={300} aria-label={`${weekdayNames[weekday]} closes`} value={days[weekday].end} onChange={(e) => setDays((c) => c.map((d, i) => (i === weekday ? { ...d, end: e.target.value } : d)))} />
              </> : <span className="subtle">Closed</span>}
            </div>
          ))}
          {extras.length > 0 ? <p className="subtle">Some days have a second opening period (such as after a lunch break). It is kept when you save.</p> : null}
          <button className="wide-btn" type="button" disabled={Boolean(busy)} onClick={saveHours}>{busy === "hours" ? "Saving..." : "Save opening hours"}</button>
        </section>
      </> : null}
    </section></main>
  );
}
