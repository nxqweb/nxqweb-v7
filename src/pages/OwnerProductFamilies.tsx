import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Boxes,
  Building2,
  CalendarDays,
  CheckCircle2,
  LockKeyhole,
  MapPinned,
  Network,
  RefreshCcw,
  ShoppingBag,
  UtensilsCrossed,
  UsersRound,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type FamilyFoundation = {
  slug: string;
  name: string;
  description: string;
  public_status: string;
  foundation_status: string;
  launch_enabled: boolean;
  source_branch_prefix: string | null;
  template_key: string | null;
  worker_key: string | null;
  portal_modules: string[];
  required_clean_runs: number;
  verified_external_runs: number;
  next_gate: string;
};

type FamilyResponse = { families: FamilyFoundation[]; generated_at: string };

const fallbackFamilies: FamilyFoundation[] = [
  ["business", "NXQ Business", "Premium managed websites for service businesses and growing brands.", "available", "qa", "safe/family/business", "business-v1", "build-business-website", ["website", "leads", "locations", "changes", "analytics", "seo", "reports"]],
  ["booking", "NXQ Booking", "Appointments, availability, reminders, cancellations, and scheduling workflows.", "planned", "schema_design", "safe/family/booking", "booking-v1-blueprint", null, ["booking_setup", "services", "staff", "availability", "appointment_requests", "reminders"]],
  ["commerce", "NXQ Commerce", "Storefronts, catalogs, inventory, protected checkout, orders, and usage controls.", "planned", "qa", "safe/family/commerce", "commerce-v1", "provision-storefront", ["setup", "catalog", "products", "images", "inventory", "orders", "requests", "preview", "usage"]],
  ["menu", "NXQ Menu", "Digital menus, specials, hours, locations, and ordering integrations.", "planned", "scaffolded", "safe/family/menu", null, null, ["menu_setup", "sections", "items", "specials", "hours", "locations"]],
  ["property", "NXQ Property", "Searchable listings, agents, private inquiries, and inventory feeds.", "planned", "scaffolded", "safe/family/property", null, null, ["property_setup", "listings", "agents", "inquiries", "feeds"]],
  ["multi-location", "NXQ Multi-Location", "Location-specific content, teams, reporting, and local SEO under one system.", "planned", "schema_design", "safe/family/multi-location", null, null, ["locations", "regional_content", "local_seo", "teams", "reports"]],
  ["membership", "NXQ Membership", "Member accounts, access rules, renewals, dashboards, and gated content.", "planned", "scaffolded", "safe/family/membership", null, null, ["membership_setup", "levels", "members", "access", "renewals", "content"]],
  ["enterprise-systems", "NXQ Enterprise Systems", "Custom permissions, integrations, identity, departments, and infrastructure.", "private", "scaffolded", "safe/family/enterprise-systems", null, null, ["organizations", "roles", "integrations", "identity", "audit"]],
].map(([slug, name, description, publicStatus, foundationStatus, branch, template, worker, modules]) => ({
  slug: slug as string,
  name: name as string,
  description: description as string,
  public_status: publicStatus as string,
  foundation_status: foundationStatus as string,
  launch_enabled: false,
  source_branch_prefix: branch as string,
  template_key: template as string | null,
  worker_key: worker as string | null,
  portal_modules: modules as string[],
  required_clean_runs: 10,
  verified_external_runs: 0,
  next_gate: foundationStatus === "qa"
    ? "Complete verified disposable external lifecycle runs and resolve every blocker."
    : foundationStatus === "schema_design"
      ? "Finish tenant-safe client mutations, portal flows, and the distinct template."
      : "Approve the family-specific intake, data boundary, and safety contract.",
}));

const icons: Record<string, LucideIcon> = {
  business: Building2,
  booking: CalendarDays,
  commerce: ShoppingBag,
  menu: UtensilsCrossed,
  property: MapPinned,
  "multi-location": Network,
  membership: UsersRound,
  "enterprise-systems": Boxes,
};

const workspaceLinks: Record<string, string> = { business: "/owner", commerce: "/owner/commerce" };
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function OwnerProductFamilies() {
  const [families, setFamilies] = useState<FamilyFoundation[]>(fallbackFamilies);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Live family readiness is unavailable until Supabase is configured. Showing the launch-safe blueprint included in this build.");
      setLoading(false);
      return;
    }
    const result = await supabase.rpc("owner_product_family_foundation_status");
    if (result.error) {
      setError(`Live family readiness could not load: ${result.error.message}. Showing the launch-safe blueprint included in this build.`);
    } else {
      const response = result.data as FamilyResponse;
      if (Array.isArray(response?.families) && response.families.length > 0) setFamilies(response.families);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const summary = useMemo(() => ({
    total: families.length,
    inQa: families.filter((family) => family.foundation_status === "qa").length,
    locked: families.filter((family) => !family.launch_enabled).length,
  }), [families]);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Building2 size={24} />
            <div>
              <h1>Product family readiness</h1>
              <p className="subtle">One premium control surface for every NXQ service line, its evidence, and its next safe gate.</p>
            </div>
          </div>
          <div className="client-control-row">
            <button className="icon-btn" type="button" onClick={() => void load()} disabled={loading}><RefreshCcw size={16} /> Refresh</button>
            <a className="icon-btn" href="/owner"><ArrowLeft size={16} /> Owner</a>
          </div>
        </div>

        {error ? <div className="notice-card" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state" role="status">Loading family readiness…</div> : null}

        <div className="owner-detail-grid" aria-label="Product family summary">
          <section className="panel"><Building2 size={22} /><h2>{summary.total}</h2><p className="subtle">Distinct family blueprints</p></section>
          <section className="panel"><CheckCircle2 size={22} /><h2>{summary.inQa}</h2><p className="subtle">Foundations in QA</p></section>
          <section className="panel"><LockKeyhole size={22} /><h2>{summary.locked}</h2><p className="subtle">Launch-locked families</p></section>
        </div>

        <section className="panel panel-wide" style={{ marginTop: "1rem" }}>
          <div className="panel-title">
            <LockKeyhole size={20} />
            <div>
              <h2>Independent by design</h2>
              <p className="subtle">Each family has its own intake, tenant boundary, template, protected worker, and failure suite. A local simulation never counts as external launch proof.</p>
            </div>
          </div>
        </section>

        <div className="portal-grid" style={{ marginTop: "1rem" }}>
          {families.map((family) => {
            const Icon = icons[family.slug] || Boxes;
            const href = workspaceLinks[family.slug];
            const evidenceComplete = family.verified_external_runs >= family.required_clean_runs;
            return (
              <article className="panel" key={family.slug}>
                <div className="panel-title panel-title-row">
                  <div className="panel-title">
                    <Icon size={20} />
                    <div><h2>{family.name}</h2><p className="subtle">{family.description}</p></div>
                  </div>
                  <span className="status-summary">{family.launch_enabled ? "Launch enabled" : "Launch locked"}</span>
                </div>
                <p><strong>{label(family.foundation_status)}</strong> · catalog {label(family.public_status)}</p>
                <p className="subtle">Modules: {family.portal_modules.length ? family.portal_modules.map(label).join(" · ") : "Contract pending"}</p>
                <div className={`notice-card ${evidenceComplete ? "success" : ""}`}>
                  <strong>{family.verified_external_runs}/{family.required_clean_runs} verified external runs</strong>
                  <p className="subtle">{family.next_gate}</p>
                </div>
                <p className="subtle">Protected branch: {family.source_branch_prefix || "Pending"}<br />Template: {family.template_key || "Pending"} · Worker: {family.worker_key || "Pending"}</p>
                {href ? (
                  <a className="wide-btn" href={href}>Open {family.name.replace("NXQ ", "")} workspace</a>
                ) : (
                  <button className="wide-btn" type="button" disabled><LockKeyhole size={16} /> Launch locked</button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
