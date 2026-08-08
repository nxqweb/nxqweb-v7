import { useEffect, useMemo, useState } from "react";
import { Boxes, ExternalLink, LockKeyhole, RefreshCcw, Save, Send } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Review = {
  client_id: string;
  business_name: string;
  contact_email?: string | null;
  monthly_price?: number | null;
  intake?: Record<string, unknown> | null;
};

type BuildJob = {
  id: string;
  client_id: string;
  business_name: string;
  contact_email?: string | null;
  monthly_price?: number | null;
  status: string;
  repository_owner?: string | null;
  repository_name?: string | null;
  repository_url?: string | null;
  repository_default_branch?: string | null;
  preview_provider?: string | null;
  preview_site_id?: string | null;
  preview_url?: string | null;
  production_url?: string | null;
  domain_connection_status: string;
  checkout_activation_status: string;
  owner_note?: string | null;
  last_error?: string | null;
  queued_at?: string | null;
  updated_at?: string | null;
  build_snapshot?: Record<string, unknown> | null;
};

type MetadataDraft = {
  repository_owner: string;
  repository_name: string;
  repository_url: string;
  preview_provider: string;
  preview_site_id: string;
  preview_url: string;
  owner_note: string;
};

function human(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value).replaceAll("_", " ");
}

function draftFromJob(job: BuildJob): MetadataDraft {
  return {
    repository_owner: job.repository_owner || "",
    repository_name: job.repository_name || "",
    repository_url: job.repository_url || "",
    preview_provider: job.preview_provider || "",
    preview_site_id: job.preview_site_id || "",
    preview_url: job.preview_url || "",
    owner_note: job.owner_note || "",
  };
}

export function OwnerCommerceBuildQueue() {
  const client = useMemo(() => (isSupabaseConfigured && supabase ? supabase : null), []);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [jobs, setJobs] = useState<BuildJob[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MetadataDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial owner queue load only

  async function load() {
    setLoading(true);
    setError("");
    if (!client) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const [reviewResult, jobResult] = await Promise.all([
      client.rpc("get_owner_commerce_reviews"),
      client.rpc("get_owner_commerce_build_jobs"),
    ]);

    if (reviewResult.error) setError(`Commerce review queue failed to load: ${reviewResult.error.message}`);
    if (jobResult.error) setError(`Commerce build queue failed to load: ${jobResult.error.message}`);

    const nextReviews = (reviewResult.data as Review[]) || [];
    const nextJobs = (jobResult.data as BuildJob[]) || [];
    setReviews(nextReviews);
    setJobs(nextJobs);
    setDrafts(Object.fromEntries(nextJobs.map((job) => [job.id, draftFromJob(job)])));
    setLoading(false);
  }

  async function queue(review: Review) {
    if (!client) return;
    if (!window.confirm(`QUEUE SEPARATE STOREFRONT BUILD\n\nClient: ${review.business_name}\n\nThis only creates a locked build record. It does not create a repository, deploy a website, connect a domain, or activate checkout.`)) return;

    setBusyId(review.client_id);
    setError("");
    setMessage("");
    const result = await client.rpc("queue_commerce_storefront_build", {
      target_client_id: review.client_id,
      owner_note_text: null,
    });
    setBusyId("");

    if (result.error) {
      setError(`Storefront build could not be queued: ${result.error.message}`);
      return;
    }

    setMessage("Separate storefront build record queued safely.");
    await load();
  }

  async function saveMetadata(job: BuildJob) {
    if (!client) return;
    const draft = drafts[job.id] || draftFromJob(job);
    setBusyId(job.id);
    setError("");
    setMessage("");

    const result = await client.rpc("update_commerce_build_job_metadata", {
      target_job_id: job.id,
      repository_owner_text: draft.repository_owner || null,
      repository_name_text: draft.repository_name || null,
      repository_url_text: draft.repository_url || null,
      preview_provider_text: draft.preview_provider || null,
      preview_site_id_text: draft.preview_site_id || null,
      preview_url_text: draft.preview_url || null,
      owner_note_text: draft.owner_note || null,
    });
    setBusyId("");

    if (result.error) {
      setError(`Build metadata could not be saved: ${result.error.message}`);
      return;
    }

    setMessage("Build metadata saved. No repo or deployment action was triggered.");
    await load();
  }

  const queuedClientIds = new Set(jobs.filter((job) => !["cancelled", "failed"].includes(job.status)).map((job) => job.client_id));
  const readyToQueue = reviews.filter((review) => {
    const intake = review.intake || {};
    return intake.status === "approved" && intake.owner_review_status === "ready_for_build" && Boolean(intake.build_plan) && !queuedClientIds.has(review.client_id);
  });

  return (
    <main className="nxq-page"><section className="portal-shell">
      <div className="panel-title panel-title-row">
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <Boxes size={24} />
          <div>
            <h1>Storefront build queue</h1>
            <p className="subtle">Prepare separate client repositories and preview deployments behind explicit owner gates.</p>
          </div>
        </div>
        <a className="icon-btn" href="/owner">← Back to owner</a>
      </div>

      <div className="settings-card" style={{ marginTop: "1rem" }}>
        <strong><LockKeyhole size={17} style={{ verticalAlign: "text-bottom", marginRight: "0.4rem" }} />Automation is locked</strong>
        <p className="subtle" style={{ marginBottom: 0 }}>Queueing freezes an approved build snapshot. It does not create GitHub repositories, deploy Netlify previews, connect domains, publish products, or activate payments.</p>
      </div>

      <button className="icon-btn" onClick={() => void load()} type="button"><RefreshCcw size={16} /> Refresh</button>
      {message ? <div className="auth-success">{message}</div> : null}
      {error ? <div className="auth-error">{error}</div> : null}
      {loading ? <div className="empty-state">Loading storefront build queue...</div> : null}

      {!loading && readyToQueue.length > 0 ? (
        <section className="panel panel-wide" style={{ marginTop: "1rem" }}>
          <div className="panel-title"><h2>Approved clients waiting to queue</h2><p className="subtle">These clients passed Commerce readiness review but do not have an active storefront build record.</p></div>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {readyToQueue.map((review) => (
              <div className="settings-card" key={review.client_id}>
                <div className="panel-title-row">
                  <div><strong>{review.business_name}</strong><p className="subtle" style={{ margin: 0 }}>{review.contact_email || "No contact email"} · ${Number(review.monthly_price || 0).toFixed(0)}/mo</p></div>
                  <button className="icon-btn" disabled={busyId === review.client_id} onClick={() => void queue(review)} type="button"><Send size={16} /> {busyId === review.client_id ? "Queueing..." : "Queue locked build"}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && jobs.length === 0 ? <div className="empty-state">No storefront build jobs are queued yet. A Commerce client must first be marked ready for build.</div> : null}

      <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
        {jobs.map((job) => {
          const draft = drafts[job.id] || draftFromJob(job);
          const snapshot = job.build_snapshot || {};
          const buildPlan = (snapshot.build_plan as Record<string, unknown> | undefined) || {};
          return (
            <article className="panel panel-wide" key={job.id} style={{ display: "grid", gap: "1rem" }}>
              <div className="panel-title panel-title-row">
                <div><h2>{job.business_name}</h2><p className="subtle">{job.contact_email || "No contact email"} · queued {job.queued_at ? new Date(job.queued_at).toLocaleString() : "recently"}</p></div>
                <strong>{human(job.status)}</strong>
              </div>

              <div className="owner-detail-grid">
                <div className="settings-card"><strong>{human(job.domain_connection_status)}</strong><span className="subtle">Domain</span></div>
                <div className="settings-card"><strong>{human(job.checkout_activation_status)}</strong><span className="subtle">Checkout</span></div>
                <div className="settings-card"><strong>{human(buildPlan.product_count)}</strong><span className="subtle">Snapshot products</span></div>
                <div className="settings-card"><strong>{human(buildPlan.layout_style)}</strong><span className="subtle">Layout</span></div>
              </div>

              <div className="auth-success">Separate storefront code must live in its own repository. NXQ Web remains the control plane only.</div>

              <div className="owner-detail-grid">
                <label><strong>Repository owner</strong><input value={draft.repository_owner} onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: { ...draft, repository_owner: event.target.value } }))} placeholder="Example: nxqweb" /></label>
                <label><strong>Repository name</strong><input value={draft.repository_name} onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: { ...draft, repository_name: event.target.value } }))} placeholder="Example: client-storefront-slug" /></label>
                <label><strong>Repository URL</strong><input value={draft.repository_url} onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: { ...draft, repository_url: event.target.value } }))} placeholder="Not created yet" /></label>
                <label><strong>Preview provider</strong><input value={draft.preview_provider} onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: { ...draft, preview_provider: event.target.value } }))} placeholder="Example: Netlify" /></label>
                <label><strong>Preview site ID</strong><input value={draft.preview_site_id} onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: { ...draft, preview_site_id: event.target.value } }))} placeholder="Not created yet" /></label>
                <label><strong>Preview URL</strong><input value={draft.preview_url} onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: { ...draft, preview_url: event.target.value } }))} placeholder="Not deployed yet" /></label>
              </div>

              <label><strong>Owner build note</strong><textarea value={draft.owner_note} onChange={(event) => setDrafts((current) => ({ ...current, [job.id]: { ...draft, owner_note: event.target.value } }))} placeholder="Record template choice, repo naming, migration cautions, or handoff notes." /></label>

              <button className="wide-btn" disabled={busyId === job.id} onClick={() => void saveMetadata(job)} type="button"><Save size={16} /> {busyId === job.id ? "Saving..." : "Save metadata only"}</button>

              <details className="settings-card">
                <summary><strong>Inspect frozen build snapshot</strong></summary>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.8rem" }}>{JSON.stringify(snapshot, null, 2)}</pre>
              </details>

              {job.repository_url ? <a className="icon-btn" href={job.repository_url} rel="noreferrer" target="_blank"><ExternalLink size={16} /> Open repository</a> : null}
              {job.preview_url ? <a className="icon-btn" href={job.preview_url} rel="noreferrer" target="_blank"><ExternalLink size={16} /> Open protected preview</a> : null}
            </article>
          );
        })}
      </div>
    </section></main>
  );
}
