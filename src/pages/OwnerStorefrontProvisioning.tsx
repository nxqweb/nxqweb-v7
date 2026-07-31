import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCcw, Rocket, RotateCcw, ServerCog } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ProvisioningJob = {
  id: string;
  client_id: string;
  storefront_id: string;
  project_id: string | null;
  status: string;
  attempt_count: number;
  repository_owner: string | null;
  repository_name: string | null;
  repository_url: string | null;
  netlify_site_id: string | null;
  netlify_site_name: string | null;
  preview_url: string | null;
  production_url: string | null;
  custom_domain: string | null;
  last_error: string | null;
  error_step: string | null;
  requested_at: string;
  updated_at: string;
};

type ClientName = { id: string; business_name: string };

function readableStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatTime(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function OwnerStorefrontProvisioning() {
  const [jobs, setJobs] = useState<ProvisioningJob[]>([]);
  const [clients, setClients] = useState<ClientName[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyJobId, setBusyJobId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const clientNames = useMemo(() => {
    return Object.fromEntries(clients.map((client) => [client.id, client.business_name]));
  }, [clients]);

  async function loadJobs() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      setLoading(false);
      return;
    }

    const [jobResult, clientResult] = await Promise.all([
      supabase.rpc("get_owner_storefront_provisioning_jobs"),
      supabase.from("clients").select("id, business_name"),
    ]);

    if (jobResult.error) setError(`Provisioning load failed: ${jobResult.error.message}`);
    else setJobs((jobResult.data || []) as ProvisioningJob[]);

    if (clientResult.error) setError(`Client names failed: ${clientResult.error.message}`);
    else setClients((clientResult.data || []) as ClientName[]);

    setLoading(false);
  }

  useEffect(() => {
    void loadJobs();
  }, []);

  async function retryJob(job: ProvisioningJob) {
    if (!supabase) return;
    if (!window.confirm(`Retry storefront provisioning for ${clientNames[job.client_id] || "this client"}?`)) return;

    setBusyJobId(job.id);
    setError("");
    setMessage("");

    const result = await supabase.rpc("retry_owner_storefront_provisioning", {
      target_job_id: job.id,
    });

    if (result.error) setError(`Retry failed: ${result.error.message}`);
    else setMessage("Provisioning job returned to the queue.");

    setBusyJobId("");
    await loadJobs();
  }

  async function approveLaunch(job: ProvisioningJob) {
    if (!supabase) return;
    const name = clientNames[job.client_id] || "this client";
    if (!window.confirm(`Approve launch for ${name}?\n\nPreview: ${job.preview_url || "Missing"}\n\nThis only releases the separate launch stage. It does not change billing or client data.`)) return;

    setBusyJobId(job.id);
    setError("");
    setMessage("");

    const result = await supabase.rpc("approve_owner_storefront_launch", {
      target_job_id: job.id,
    });

    if (result.error) setError(`Launch approval failed: ${result.error.message}`);
    else setMessage("Launch approved. The provisioning worker can now complete the production stage.");

    setBusyJobId("");
    await loadJobs();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ServerCog size={22} />
            <div>
              <h1>Automatic storefront provisioning</h1>
              <p className="subtle">Track GitHub repository creation, Netlify previews, failures, and final launch approval.</p>
            </div>
          </div>
          <a className="icon-btn" href="/owner/commerce"><ArrowLeft size={16} /> Commerce</a>
        </div>

        <div className="panel panel-wide">
          <div className="panel-title panel-title-row">
            <div>
              <h2>Provisioning queue</h2>
              <p className="subtle">Client approval queues a separate storefront automatically. Final production launch still requires your approval.</p>
            </div>
            <button className="icon-btn" onClick={() => void loadJobs()} disabled={loading} type="button">
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>
          {message ? <p className="status-message">{message}</p> : null}
          {error ? <p className="error-message">{error}</p> : null}
        </div>

        {loading ? <div className="panel panel-wide">Loading provisioning jobs…</div> : null}
        {!loading && jobs.length === 0 ? <div className="panel panel-wide"><h2>No provisioning jobs yet</h2><p className="subtle">The first approved Commerce client will appear here automatically after their storefront record exists.</p></div> : null}

        <div className="portal-grid">
          {jobs.map((job) => {
            const name = clientNames[job.client_id] || "Commerce client";
            const canRetry = job.status === "failed" || job.status === "cancelled";
            const canLaunch = job.status === "preview_ready" && Boolean(job.preview_url);

            return (
              <article className="panel" key={job.id}>
                <div className="panel-title">
                  <ServerCog size={20} />
                  <div>
                    <h2>{name}</h2>
                    <p className="subtle">Status: <strong>{readableStatus(job.status)}</strong></p>
                  </div>
                </div>

                <p className="subtle">Attempts: {job.attempt_count}</p>
                <p className="subtle">Updated: {formatTime(job.updated_at)}</p>
                {job.repository_url ? <a className="wide-btn" href={job.repository_url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open GitHub repository</a> : null}
                {job.preview_url ? <a className="wide-btn" href={job.preview_url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open preview</a> : null}
                {job.production_url ? <a className="wide-btn" href={job.production_url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open live site</a> : null}

                {job.last_error ? (
                  <div className="error-message">
                    <strong>{job.error_step ? `${readableStatus(job.error_step)}: ` : ""}</strong>{job.last_error}
                  </div>
                ) : null}

                {canRetry ? <button className="wide-btn" disabled={busyJobId === job.id} onClick={() => void retryJob(job)} type="button"><RotateCcw size={16} /> Retry safely</button> : null}
                {canLaunch ? <button className="wide-btn" disabled={busyJobId === job.id} onClick={() => void approveLaunch(job)} type="button"><Rocket size={16} /> Approve launch</button> : null}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
