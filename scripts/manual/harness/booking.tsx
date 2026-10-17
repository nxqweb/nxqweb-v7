// Manual-testing harness (never part of the production build): mounts the public Booking page and the business Booking manager with ONE shared in-memory
// "database", so a full flow (a customer sends a request, the business answers it) can be run in a real browser before the database functions exist.
// ?view=public|owner (default public). ?gw=none (feature not connected), ?gw=fail (every write fails), ?seed=1 starts with a working, switched-on page.
// State lives in localStorage so moving between the two views keeps it. Reset it with ?reset=1.
import { createRoot } from "react-dom/client";
import "../../../src/styles/nxq.css";
import "../../../src/styles/portal-premium.css";
import "../../../src/styles/portal-polish.css";
import "../../../src/styles/final-frontend-polish.css";
import "../../../src/styles/plan-forms.css";
import "../../../src/styles/nxqx-neural-glass.css";
import "../../../src/styles/premium-v2.css";
import "../../../src/styles/storefront-theme.css";
import { ClientBooking } from "../../../src/pages/ClientBooking";
import { PublicBooking } from "../../../src/pages/PublicBooking";
import { emptyBookingSetup, type BookingPage, type BookingRequestRow, type BookingSetup, type OwnerBookingGateway, type PublicBookingGateway } from "../../../src/lib/bookingGateway";

const params = new URLSearchParams(window.location.search);
const KEY = "booking-harness-v1";
type Db = { setup: BookingSetup; requests: BookingRequestRow[]; keys: Record<string, string>; counter: number };
const seeded = (): Db => ({
  setup: { ...emptyBookingSetup, hasWorkspace: true, status: "ready", publicEnabled: true, publicSlug: "salon-one", displayName: "Book Salon One", intro: "Hair and nails, by request.", timezone: "America/Los_Angeles", cancellationPolicy: "Please tell us 24 hours ahead.",
    services: [{ serviceKey: "cut", name: "Haircut", durationMinutes: 60, active: true }, { serviceKey: "color", name: "Hair color", durationMinutes: 120, active: true }],
    hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) },
  requests: [{ id: "r1", requestCode: "BOOK-AAAAAAAAAAAA", status: "requested", serviceName: "Haircut", requestedStartAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), timezone: "America/Los_Angeles", contactName: "Sam Customer", contactEmail: "sam@example.com", contactPhone: "(555) 010-2000", notes: "First visit", ownerNote: "", createdAt: new Date().toISOString() }],
  keys: {}, counter: 1,
});
function loadDb(): Db {
  if (params.get("reset")) localStorage.removeItem(KEY);
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Db; } catch { /* start fresh */ }
  return params.get("seed") ? seeded() : { setup: { ...emptyBookingSetup }, requests: [], keys: {}, counter: 0 };
}
const db = loadDb();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };
const log = (name: string, payload: unknown) => { const w = window as unknown as Record<string, unknown[]>; w[name] = [...(w[name] || []), payload]; };
const failing = () => { if (params.get("gw") === "fail") throw new Error('duplicate key value violates unique constraint "booking_workspaces_pkey"'); };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const owner: OwnerBookingGateway | null = params.get("gw") === "none" ? null : {
  load: async () => clone(db.setup),
  ensure: async (timezone) => { failing(); if (!db.setup.hasWorkspace) db.setup = { ...emptyBookingSetup, hasWorkspace: true, status: "setup", timezone }; save(); log("__owner", { ensure: timezone }); return clone(db.setup); },
  saveSettings: async (input) => { failing(); db.setup = { ...db.setup, displayName: input.displayName, intro: input.intro, timezone: input.timezone, minimumLeadMinutes: input.minimumLeadMinutes, maximumAdvanceDays: input.maximumAdvanceDays, cancellationPolicy: input.cancellationPolicy, publicSlug: input.publicSlug }; save(); log("__owner", { settings: input }); return clone(db.setup); },
  saveService: async (input) => { failing(); const rest = db.setup.services.filter((s) => s.serviceKey !== input.serviceKey); const at = db.setup.services.findIndex((s) => s.serviceKey === input.serviceKey); const next = { ...input }; db.setup.services = at >= 0 ? db.setup.services.map((s) => (s.serviceKey === input.serviceKey ? next : s)) : [...rest, next]; save(); log("__owner", { service: input }); return clone(db.setup); },
  saveHours: async (hours) => { failing(); db.setup.hours = hours; if (hours.length === 0) { db.setup.publicEnabled = false; db.setup.status = "paused"; } save(); log("__owner", { hours }); return clone(db.setup); },
  setPublic: async (enabled) => {
    failing();
    if (enabled) { const s = db.setup; if (!s.publicSlug) throw new Error("Choose a page address first."); if (!s.displayName) throw new Error("Add a page name first."); if (!s.services.some((x) => x.active)) throw new Error("Add at least one service first."); if (s.hours.length === 0) throw new Error("Add your opening hours first."); }
    db.setup.publicEnabled = enabled; db.setup.status = enabled ? "ready" : "paused"; save(); log("__owner", { public: enabled }); return clone(db.setup);
  },
  listRequests: async (status) => clone(db.requests.filter((r) => !status || r.status === status)),
  updateRequest: async (id, status, note) => { failing(); db.requests = db.requests.map((r) => (r.id === id ? { ...r, status, ownerNote: note } : r)); db.setup.newRequests = db.requests.filter((r) => r.status === "requested").length; save(); log("__owner", { update: { id, status, note } }); },
  deleteRequest: async (id) => { failing(); db.requests = db.requests.filter((r) => r.id !== id); db.setup.newRequests = db.requests.filter((r) => r.status === "requested").length; save(); log("__owner", { delete: id }); },
};

const publicGateway: PublicBookingGateway | null = params.get("gw") === "none" ? null : {
  loadPage: async (slug) => {
    const s = db.setup;
    if (!s.hasWorkspace || !s.publicEnabled || s.publicSlug !== slug) return null;
    const page: BookingPage = { displayName: s.displayName, intro: s.intro, timezone: s.timezone, minimumLeadMinutes: s.minimumLeadMinutes, maximumAdvanceDays: s.maximumAdvanceDays, cancellationPolicy: s.cancellationPolicy, services: s.services.filter((x) => x.active), hours: s.hours };
    return clone(page);
  },
  submit: async (input) => {
    failing(); log("__submits", input);
    if (input.website) return { requestCode: "BOOK-RECEIVED", status: "requested" };
    if (db.keys[input.idempotencyKey]) return { requestCode: db.keys[input.idempotencyKey], status: "requested" };
    db.counter += 1;
    const code = `BOOK-${String(db.counter).padStart(12, "0")}`;
    const service = db.setup.services.find((x) => x.serviceKey === input.serviceKey);
    db.keys[input.idempotencyKey] = code;
    db.requests = [{ id: `r${db.counter + 1}`, requestCode: code, status: "requested", serviceName: service?.name || "", requestedStartAt: input.startIso, timezone: db.setup.timezone, contactName: input.name, contactEmail: input.email, contactPhone: input.phone, notes: input.notes, ownerNote: "", createdAt: new Date().toISOString() }, ...db.requests];
    db.setup.newRequests = db.requests.filter((r) => r.status === "requested").length; save();
    return { requestCode: code, status: "requested" };
  },
};

const view = params.get("view") === "owner" ? "owner" : "public";
createRoot(document.getElementById("root") as HTMLElement).render(view === "owner" ? <ClientBooking gateway={owner} /> : <PublicBooking slug={params.get("slug") || "salon-one"} gateway={publicGateway} />);
