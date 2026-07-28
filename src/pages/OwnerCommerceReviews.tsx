import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, RefreshCcw, RotateCcw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Review = {
  client_id: string;
  business_name: string;
  contact_email?: string | null;
  monthly_price: number;
  storefront_status?: string | null;
  product_count: number;
  missing_image_count: number;
  missing_category_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
  intake?: Record<string, unknown> | null;
};

const labels: Record<string, string> = {
  website_transition_mode: "Website transition",
  current_store_url: "Current website",
  layout_style: "Layout style",
  scroll_behavior: "Scroll behavior",
  animation_intensity: "Animation intensity",
  section_reveal_style: "Section reveal",
  page_transition_style: "Page transitions",
  product_card_hover_style: "Product-card hover",
  shipping_regions: "Shipping regions",
  requested_payment_provider: "Payment provider",
  required_pages: "Required pages",
  special_features: "Special features",
};

function human(value: unknown) {
  if (Array.isArray(value)) return value.join(", ") || "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "Not provided";
  return String(value).replaceAll("_", " ");
}

export function OwnerCommerceReviews() {
  const client = useMemo(() => (isSupabaseConfigured && supabase ? supabase : null), []);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true); setError("");
    if (!client) { setError("Supabase is not configured."); setLoading(false); return; }
    const result = await client.rpc("get_owner_commerce_reviews");
    if (result.error) setError(`Commerce reviews failed to load: ${result.error.message}`);
    else setReviews((result.data as Review[]) || []);
    setLoading(false);
  }

  async function decide(review: Review, decision: "request_revisions" | "mark_ready") {
    if (!client) return;
    const verb = decision === "mark_ready" ? "MARK READY FOR BUILD" : "REQUEST COMMERCE REVISIONS";
    if (!window.confirm(`${verb}\n\nClient: ${review.business_name}\n\nThis does not publish a storefront or activate checkout.`)) return;
    setError(""); setMessage("");
    const result = await client.rpc("resolve_owner_commerce_review", {
      target_client_id: review.client_id,
      decision,
      owner_note_text: notes[review.client_id] || null,
    });
    if (result.error) { setError(`Commerce review failed: ${result.error.message}`); return; }
    setMessage(decision === "mark_ready" ? "Commerce intake marked ready for build." : "Revision request sent to the client.");
    await load();
  }

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row">
        <div style={{display:"flex",gap:"0.75rem",alignItems:"center"}}><ClipboardCheck size={24}/><div><h1>Commerce reviews</h1><p className="subtle">Review client readiness before a separate storefront build begins.</p></div></div>
        <a className="icon-btn" href="/owner">← Back to owner</a>
      </div>
      <button className="icon-btn" onClick={() => void load()} type="button"><RefreshCcw size={16}/> Refresh</button>
      {message ? <div className="auth-success">{message}</div> : null}
      {error ? <div className="auth-error">{error}</div> : null}
      {loading ? <div className="empty-state">Loading Commerce reviews...</div> : null}
      {!loading && reviews.length === 0 ? <div className="empty-state">No Commerce clients are available for review.</div> : null}
      <div style={{display:"grid",gap:"1rem",marginTop:"1rem"}}>
        {reviews.map((review) => {
          const intake = review.intake || {};
          const readinessChecks = [
            Boolean(intake.store_name),
            intake.status === "submitted" || intake.status === "approved",
            review.product_count > 0,
            review.missing_image_count === 0 && review.product_count > 0,
            review.missing_category_count === 0 && review.product_count > 0,
          ];
          const score = Math.round((readinessChecks.filter(Boolean).length / readinessChecks.length) * 100);
          return <article className="panel panel-wide" key={review.client_id} style={{display:"grid",gap:"1rem"}}>
            <div className="panel-title panel-title-row"><div><h2>{review.business_name}</h2><p className="subtle">{review.contact_email || "No contact email"} · ${Number(review.monthly_price || 0).toFixed(0)}/mo</p></div><strong>{score}% ready</strong></div>
            <div className="owner-detail-grid">
              <div className="settings-card"><strong>{review.product_count}</strong><span className="subtle">Products</span></div>
              <div className="settings-card"><strong>{review.missing_image_count}</strong><span className="subtle">Missing photos</span></div>
              <div className="settings-card"><strong>{review.missing_category_count}</strong><span className="subtle">Missing categories</span></div>
              <div className="settings-card"><strong>{review.low_stock_count}</strong><span className="subtle">Low stock</span></div>
              <div className="settings-card"><strong>{review.out_of_stock_count}</strong><span className="subtle">Out of stock</span></div>
              <div className="settings-card"><strong>{human(intake.owner_review_status || "pending")}</strong><span className="subtle">Owner review</span></div>
            </div>
            <div className="owner-detail-grid">
              {Object.entries(labels).map(([key,label]) => <div className="settings-card" key={key}><strong>{label}</strong><p className="subtle">{human(intake[key])}</p></div>)}
            </div>
            <label><strong>Owner note</strong><textarea value={notes[review.client_id] || ""} onChange={(event) => setNotes((current) => ({...current,[review.client_id]:event.target.value}))} placeholder="Explain revisions or record the build handoff." /></label>
            <div className="panel-title-row" style={{gap:"0.75rem",flexWrap:"wrap"}}>
              <button className="icon-btn" onClick={() => void decide(review,"request_revisions")} type="button"><RotateCcw size={16}/> Request revisions</button>
              <button className="wide-btn" onClick={() => void decide(review,"mark_ready")} type="button"><CheckCircle2 size={16}/> Mark ready for build</button>
            </div>
            <p className="subtle" style={{margin:0}}>Marking ready generates a structured build plan. It does not create a repository, deploy a website, activate payments, or publish anything.</p>
          </article>;
        })}
      </div>
    </section></main>
  );
}
