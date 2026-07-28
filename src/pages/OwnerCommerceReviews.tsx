import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCcw, RotateCcw } from "lucide-react";
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
    setLoading(true);
    setError("");
    if (!client) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    const result = await client.rpc("get_owner_commerce_reviews");
    if (result.error) setError(`Commerce reviews failed to load: ${result.error.message}`);
    else setReviews((result.data as Review[]) || []);
    setLoading(false);
  }

  async function decide(review: Review, decision: "request_revisions" | "mark_ready") {
    if (!client) return;
    const verb = decision === "mark_ready" ? "MARK READY FOR BUILD" : "REQUEST COMMERCE REVISIONS";
    if (!window.confirm(`${verb}\n\nClient: ${review.business_name}\n\nThis does not publish a storefront or activate checkout.`)) return;
    setError("");
    setMessage("");
    const result = await client.rpc("resolve_owner_commerce_review", {
      target_client_id: review.client_id,
      decision,
      owner_note_text: notes[review.client_id] || null,
    });
    if (result.error) {
      setError(`Commerce review failed: ${result.error.message}`);
      return;
    }
    setMessage(decision === "mark_ready" ? "Commerce intake marked ready for build." : "Revision request sent to the client.");
    await load();
  }

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row">
        <div style={{display:"flex",gap:"0.75rem",alignItems:"center"}}>
          <ClipboardCheck size={24}/>
          <div>
            <h1>Commerce reviews</h1>
            <p className="subtle">Review client readiness before a separate storefront build begins.</p>
          </div>
        </div>
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
          const intakeSubmitted = intake.status === "submitted" || intake.status === "approved";
          const blockers = [
            !intakeSubmitted ? "Commerce setup sheet has not been submitted for review." : null,
            review.product_count <= 0 ? "No product drafts have been added." : null,
            review.missing_image_count > 0 ? `${review.missing_image_count} product(s) still need a photo.` : null,
            review.missing_category_count > 0 ? `${review.missing_category_count} product(s) still need a category.` : null,
          ].filter((item): item is string => Boolean(item));
          const warnings = [
            review.low_stock_count > 0 ? `${review.low_stock_count} variant(s) are low stock.` : null,
            review.out_of_stock_count > 0 ? `${review.out_of_stock_count} variant(s) are out of stock.` : null,
          ].filter((item): item is string => Boolean(item));
          const canMarkReady = blockers.length === 0;
          const setupChecks = [Boolean(intake.store_name), intakeSubmitted];
          const catalogChecks = [
            review.product_count > 0,
            review.missing_image_count === 0 && review.product_count > 0,
            review.missing_category_count === 0 && review.product_count > 0,
          ];
          const setupScore = Math.round((setupChecks.filter(Boolean).length / setupChecks.length) * 100);
          const catalogScore = Math.round((catalogChecks.filter(Boolean).length / catalogChecks.length) * 100);

          return <article className="panel panel-wide" key={review.client_id} style={{display:"grid",gap:"1rem"}}>
            <div className="panel-title panel-title-row">
              <div>
                <h2>{review.business_name}</h2>
                <p className="subtle">{review.contact_email || "No contact email"} · ${Number(review.monthly_price || 0).toFixed(0)}/mo</p>
              </div>
              <strong>{canMarkReady ? "Ready for owner approval" : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`}</strong>
            </div>

            <div className="owner-detail-grid">
              <div className="settings-card"><strong>{setupScore}%</strong><span className="subtle">Setup completion</span></div>
              <div className="settings-card"><strong>{catalogScore}%</strong><span className="subtle">Catalog readiness</span></div>
              <div className="settings-card"><strong>{review.product_count}</strong><span className="subtle">Products</span></div>
              <div className="settings-card"><strong>{review.missing_image_count}</strong><span className="subtle">Missing photos</span></div>
              <div className="settings-card"><strong>{review.missing_category_count}</strong><span className="subtle">Missing categories</span></div>
              <div className="settings-card"><strong>{human(intake.owner_review_status || "pending")}</strong><span className="subtle">Owner review</span></div>
            </div>

            {blockers.length > 0 ? <div className="auth-error" style={{textAlign:"left"}}>
              <strong>Build blockers</strong>
              <ul style={{margin:"0.65rem 0 0",paddingLeft:"1.25rem"}}>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div> : <div className="auth-success"><strong>Required setup and catalog checks are complete.</strong></div>}

            {warnings.length > 0 ? <div className="settings-card" style={{textAlign:"left"}}>
              <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}><AlertTriangle size={18}/><strong>Inventory warnings</strong></div>
              <ul style={{margin:"0.65rem 0 0",paddingLeft:"1.25rem"}}>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              <p className="subtle" style={{marginBottom:0}}>Warnings do not automatically block a build because made-to-order, preorder, and launch-later products may intentionally have no stock.</p>
            </div> : null}

            <details className="settings-card">
              <summary><strong>Review storefront, migration, and design details</strong></summary>
              <div className="owner-detail-grid" style={{marginTop:"1rem"}}>
                {Object.entries(labels).map(([key,label]) => <div className="settings-card" key={key}><strong>{label}</strong><p className="subtle">{human(intake[key])}</p></div>)}
              </div>
            </details>

            <label><strong>Owner note</strong><textarea value={notes[review.client_id] || ""} onChange={(event) => setNotes((current) => ({...current,[review.client_id]:event.target.value}))} placeholder="Explain revisions or record the build handoff." /></label>

            <div className="panel-title-row" style={{gap:"0.75rem",flexWrap:"wrap"}}>
              <button className="icon-btn" onClick={() => void decide(review,"request_revisions")} type="button"><RotateCcw size={16}/> Request revisions</button>
              <button className="wide-btn" disabled={!canMarkReady} onClick={() => void decide(review,"mark_ready")} type="button"><CheckCircle2 size={16}/> {canMarkReady ? "Mark ready for build" : "Resolve blockers first"}</button>
            </div>

            <p className="subtle" style={{margin:0}}>Marking ready generates a structured build plan. It does not create a repository, deploy a website, activate payments, or publish anything.</p>
          </article>;
        })}
      </div>
    </section></main>
  );
}
