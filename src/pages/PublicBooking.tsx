import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { checkBookingRequest, friendlyBookingError, newIdempotencyKey, type BookingFieldErrors } from "../lib/bookingForm";
import { generateSlots } from "../lib/bookingTime";
import type { BookingPage, PublicBookingGateway } from "../lib/bookingGateway";

// The public "request an appointment" page (/book/<slug>). It sends a REQUEST: nothing is confirmed, paid or emailed by NXQX-Web. The business replies itself.
export function PublicBooking({ slug, gateway }: { slug: string; gateway: PublicBookingGateway | null }) {
  const [page, setPage] = useState<BookingPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "closed">("loading");
  const [serviceKey, setServiceKey] = useState("");
  const [dayKey, setDayKey] = useState("");
  const [startIso, setStartIso] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "", website: "" });
  const [errors, setErrors] = useState<BookingFieldErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ requestCode: string } | null>(null);
  const keyRef = useRef(newIdempotencyKey());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    setState("loading"); setPage(null); setDone(null); setServiceKey(""); setDayKey(""); setStartIso(""); setError(""); setErrors({}); setNowMs(Date.now());
    (async () => {
      if (!gateway) { setState("closed"); return; }
      try {
        const loaded = await gateway.loadPage(slug);
        if (!alive) return;
        if (!loaded || loaded.services.length === 0) { setState("closed"); return; }
        setPage(loaded); setServiceKey(loaded.services.length === 1 ? loaded.services[0].serviceKey : ""); setState("ready");
      } catch { if (alive) setState("closed"); }
    })();
    return () => { alive = false; };
  }, [gateway, slug]);

  const service = page?.services.find((s) => s.serviceKey === serviceKey) ?? null;
  const days = useMemo(() => (page && service ? generateSlots({ hours: page.hours, durationMinutes: service.durationMinutes, timeZone: page.timezone, nowMs, minimumLeadMinutes: page.minimumLeadMinutes, maximumAdvanceDays: page.maximumAdvanceDays, maxDays: 56 }) : []), [page, service, nowMs]);
  const day = days.find((d) => d.dateKey === dayKey) ?? null;

  const touch = () => { keyRef.current = newIdempotencyKey(); };
  function pickService(key: string) { touch(); setNowMs(Date.now()); setServiceKey(key); setDayKey(""); setStartIso(""); setErrors((e) => ({ ...e, service: undefined, time: undefined })); }
  function pickDay(key: string) { touch(); setNowMs(Date.now()); setDayKey(key); setStartIso(""); setErrors((e) => ({ ...e, time: undefined })); }
  const setField = (key: keyof typeof form, value: string) => { if (key !== "website") touch(); setForm((c) => ({ ...c, [key]: value })); if (key !== "website") setErrors((e) => ({ ...e, [key]: undefined, contact: key === "email" || key === "phone" ? undefined : e.contact })); };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !gateway || !page) return;
    setError("");
    const problems = checkBookingRequest({ serviceKey, startIso, name: form.name, email: form.email, phone: form.phone, notes: form.notes });
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      setError("Please check the details marked below.");
      const first = (["service", "time", "name", "contact", "email", "phone", "notes"] as const).find((k) => problems[k]);
      const target = first === "contact" ? "email" : first === "time" ? (dayKey ? "time" : "day") : first;
      if (target) window.setTimeout(() => document.getElementById(`book-${target}`)?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      const result = await gateway.submit({ slug, serviceKey, startIso, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), notes: form.notes.trim(), idempotencyKey: keyRef.current, website: form.website });
      setDone({ requestCode: result.requestCode });
    } catch (failure) { setError(friendlyBookingError(failure instanceof Error ? failure.message : "")); }
    setBusy(false);
  }
  function another() { keyRef.current = newIdempotencyKey(); setNowMs(Date.now()); setDone(null); setStartIso(""); setDayKey(""); setForm({ name: "", email: "", phone: "", notes: "", website: "" }); setErrors({}); setError(""); }

  if (state === "loading") return <main className="nxq-page store-theme"><section className="portal-shell"><div className="empty-state" role="status">Loading...</div></section></main>;
  if (state === "closed" || !page) return <main className="nxq-page store-theme"><section className="portal-shell"><div className="empty-state" role="status" data-testid="booking-closed">This booking page is not open right now. If someone sent you this link, please contact them another way.</div></section></main>;

  const zoneName = page.timezone.replace(/_/g, " ");
  return (
    <main className="nxq-page store-theme"><section className="portal-shell booking-shell">
      <div className="panel-title"><CalendarCheck size={24} /><div><h1>{page.displayName}</h1>{page.intro ? <p className="subtle">{page.intro}</p> : null}</div></div>

      {done ? (
        <section className="panel panel-wide" data-testid="booking-done" role="status">
          <h2>Request sent</h2>
          <p>Thank you! <strong>{page.displayName}</strong> will get back to you using the details you gave.</p>
          <p className="subtle">This is a <strong>request</strong>, not a confirmed appointment. Your request code is <strong data-testid="booking-code">{done.requestCode}</strong>. Keep it in case you need to ask about it.</p>
          <button className="icon-btn" type="button" onClick={another}>Send another request</button>
        </section>
      ) : (
        <form className="panel panel-wide booking-form" onSubmit={(event) => void submit(event)} noValidate data-testid="booking-form">
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <p className="subtle">Pick a service and a time that works for you. Times are in the business's time zone ({zoneName}). {page.displayName} will confirm with you directly.</p>

          <label className="auth-label" htmlFor="book-service"><span>Service</span></label>
          <select id="book-service" className="auth-input" value={serviceKey} onChange={(e) => pickService(e.target.value)} aria-invalid={Boolean(errors.service)} aria-describedby={errors.service ? "err-service" : undefined}>
            <option value="">Choose a service...</option>
            {page.services.map((s) => <option key={s.serviceKey} value={s.serviceKey}>{s.name} ({s.durationMinutes} min)</option>)}
          </select>
          {errors.service ? <p className="field-error" id="err-service" role="alert">{errors.service}</p> : null}

          {service ? <>
            <label className="auth-label" htmlFor="book-day"><span>Day</span></label>
            {days.length === 0 ? <p className="subtle" role="status" data-testid="booking-no-times">There are no open times in the next 8 weeks. Please contact {page.displayName} directly.</p> : <>
              <select id="book-day" className="auth-input" value={dayKey} onChange={(e) => pickDay(e.target.value)} aria-invalid={Boolean(errors.time) && !dayKey}>
                <option value="">Choose a day...</option>
                {days.map((d) => <option key={d.dateKey} value={d.dateKey}>{d.label}</option>)}
              </select>
              {day ? <fieldset className="booking-times" aria-describedby={errors.time ? "err-time" : undefined}>
                <legend>Time on {day.label}</legend>
                <div className="booking-slots">
                  {day.slots.map((s, index) => (
                    <label key={s.startIso} className={`booking-slot${startIso === s.startIso ? " is-picked" : ""}`}>
                      <input id={index === 0 ? "book-time" : undefined} type="radio" name="book-slot" value={s.startIso} checked={startIso === s.startIso} onChange={() => { touch(); setStartIso(s.startIso); setErrors((e) => ({ ...e, time: undefined })); }} />
                      <span>{s.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset> : null}
              {errors.time ? <p className="field-error" id="err-time" role="alert">{errors.time}</p> : null}
            </>}
          </> : null}

          <label className="auth-label" htmlFor="book-name"><span>Your name</span></label>
          <input id="book-name" className="auth-input" autoComplete="name" maxLength={120} value={form.name} onChange={(e) => setField("name", e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "err-name" : undefined} />
          {errors.name ? <p className="field-error" id="err-name" role="alert">{errors.name}</p> : null}
          <label className="auth-label" htmlFor="book-email"><span>Email</span></label>
          <input id="book-email" className="auth-input" type="email" inputMode="email" autoComplete="email" maxLength={254} value={form.email} onChange={(e) => setField("email", e.target.value)} aria-invalid={Boolean(errors.email || errors.contact)} aria-describedby={errors.email ? "err-email" : errors.contact ? "err-contact" : undefined} />
          {errors.email ? <p className="field-error" id="err-email" role="alert">{errors.email}</p> : null}
          <label className="auth-label" htmlFor="book-phone"><span>Phone (email or phone is needed)</span></label>
          <input id="book-phone" className="auth-input" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={(e) => setField("phone", e.target.value)} aria-invalid={Boolean(errors.phone || errors.contact)} aria-describedby={errors.phone ? "err-phone" : errors.contact ? "err-contact" : undefined} />
          {errors.phone ? <p className="field-error" id="err-phone" role="alert">{errors.phone}</p> : null}
          {errors.contact ? <p className="field-error" id="err-contact" role="alert">{errors.contact}</p> : null}
          <label className="auth-label" htmlFor="book-notes"><span>Anything we should know? (optional)</span></label>
          <textarea id="book-notes" className="auth-input" rows={3} maxLength={1000} value={form.notes} onChange={(e) => setField("notes", e.target.value)} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? "err-notes" : undefined} />
          {errors.notes ? <p className="field-error" id="err-notes" role="alert">{errors.notes}</p> : null}

          {/* A field real visitors never see or fill in: a simple trap for bots. */}
          <div className="booking-hp" aria-hidden="true" inert><label>Leave this empty<input tabIndex={-1} autoComplete="off" name="nxq_extra_field" value={form.website} onChange={(e) => setField("website", e.target.value)} /></label></div>

          {page.cancellationPolicy ? <p className="subtle" data-testid="booking-policy"><strong>Cancellation:</strong> {page.cancellationPolicy}</p> : null}
          <p className="subtle">Your name and contact details go to {page.displayName} so they can reply. Nothing is charged.</p>
          <button className="wide-btn" type="submit" disabled={busy}>{busy ? "Sending..." : "Send request"}</button>
        </form>
      )}
    </section></main>
  );
}
