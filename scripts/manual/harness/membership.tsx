// Manual-testing harness (never part of the production build): mounts the Members page over an in-memory "database" so a full flow can be run in a real browser
// before the database functions exist. ?gw=none (not connected), ?gw=fail (every write fails), ?seed=1 starts with tiers and members, ?reset=1 clears saved state.
// The in-memory rules copy the SQL draft (one row per email, 10 tiers, case-insensitive tier names, another tier cannot be used).
import { createRoot } from "react-dom/client";
import "../../../src/styles/nxq.css";
import "../../../src/styles/portal-premium.css";
import "../../../src/styles/portal-polish.css";
import "../../../src/styles/final-frontend-polish.css";
import "../../../src/styles/plan-forms.css";
import "../../../src/styles/nxqx-neural-glass.css";
import "../../../src/styles/premium-v2.css";
import { ClientMembership } from "../../../src/pages/ClientMembership";
import type { MemberRow, MemberTier, OwnerMembershipGateway } from "../../../src/lib/membershipGateway";

const params = new URLSearchParams(window.location.search);
const KEY = "membership-harness-v1";
type Db = { tiers: MemberTier[]; members: MemberRow[]; counter: number };
const iso = (offset: number) => { const d = new Date(Date.now() + offset * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const seeded = (): Db => ({
  tiers: [{ id: "t1", name: "Candle Club", perks: "Early access to new scents", active: true }, { id: "t2", name: "VIP", perks: "", active: true }],
  members: [
    { id: "m1", email: "mia@example.com", fullName: "Mia Rivera", phone: "(555) 010-1000", tierId: "t1", status: "active", renewsOn: iso(5), notes: "founding member" },
    { id: "m2", email: "sam@example.com", fullName: "", phone: "", tierId: "t2", status: "active", renewsOn: iso(40), notes: "" },
    { id: "m3", email: "old@example.com", fullName: "Old Timer", phone: "", tierId: "t1", status: "ended", renewsOn: iso(-90), notes: "" },
  ], counter: 10,
});
function loadDb(): Db {
  if (params.get("reset")) localStorage.removeItem(KEY);
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Db; } catch { /* start fresh */ }
  return params.get("seed") ? seeded() : { tiers: [], members: [], counter: 0 };
}
const db = loadDb();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };
const log = (name: string, payload: unknown) => { const w = window as unknown as Record<string, unknown[]>; w[name] = [...(w[name] || []), payload]; };
const failing = () => { if (params.get("gw") === "fail") throw new Error('duplicate key value violates unique constraint "commerce_members_pkey"'); };

const gateway: OwnerMembershipGateway | null = params.get("gw") === "none" ? null : {
  load: async () => JSON.parse(JSON.stringify({ tiers: db.tiers, members: db.members })),
  saveTier: async (input) => {
    failing(); log("__tiers", input);
    const name = input.name.trim();
    if (db.tiers.some((t) => t.id !== input.id && t.name.toLowerCase() === name.toLowerCase())) throw new Error("You already have a tier with that name.");
    if (!input.id) { if (db.tiers.length >= 10) throw new Error("You can have up to 10 tiers."); db.counter += 1; db.tiers.push({ id: `t${db.counter}`, name, perks: input.perks, active: input.active }); }
    else { const t = db.tiers.find((x) => x.id === input.id); if (!t) throw new Error("Tier not found."); Object.assign(t, { name, perks: input.perks, active: input.active }); }
    save();
  },
  saveMember: async (input) => {
    failing(); log("__members", input);
    if (!db.tiers.some((t) => t.id === input.tierId)) throw new Error("Choose one of your tiers.");
    if (db.members.some((m) => m.id !== input.id && m.email === input.email)) throw new Error("That email is already a member.");
    if (!input.id) { db.counter += 1; db.members.push({ id: `m${db.counter}`, email: input.email, fullName: input.fullName, phone: input.phone, tierId: input.tierId, status: input.status, renewsOn: input.renewsOn, notes: input.notes }); }
    else { const m = db.members.find((x) => x.id === input.id); if (!m) throw new Error("Member not found."); Object.assign(m, { email: input.email, fullName: input.fullName, phone: input.phone, tierId: input.tierId, status: input.status, renewsOn: input.renewsOn, notes: input.notes }); }
    save();
  },
  removeMember: async (id) => { failing(); log("__removed", id); db.members = db.members.filter((m) => m.id !== id); save(); },
};

createRoot(document.getElementById("root") as HTMLElement).render(<ClientMembership gateway={gateway} />);
