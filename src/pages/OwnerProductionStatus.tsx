import { useEffect, useState } from "react";
import { ExternalLink, RefreshCcw, Rocket, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type LaunchRow = {
  id: string;
  production_branch: string;
  production_url: string | null;
  status: string;
  execution_started_at: string | null;
  execution_completed_at: string | null;
  netlify_build_id: string | null;
  netlify_deploy_id: string | null;
  published_url: string | null;
  error_message: string | null;
  created_at: string;
};

type StatusResult = {
  status: "launching" | "published" | "failed";
  production_published: boolean;
  build_done?: boolean;
  deploy_state?: string;
  deploy_context?: string | null;
  netlify_build_id: string;
  netlify_deploy_id: string | null;
  production_url?: string | null;
  production_url_status?: number;
  published_at?: string;
  error?: string;
  note?: string;
};

type PublishResult = {
  status: "launching" | "published";
  production_published: boolean;
  publish_requested: boolean;
  netlify_build_id?: string;
  netlify_deploy_id?: string;
  deploy_state?: string;
  production_url?: string | null;
  production_url_status?: number;
  published_at?: string | null;
  note?: string;
};

type Diagnostics = {
  buildDone?: boolean;
  deployState?: string;
  deployContext?: string | null;
  productionUrlStatus?: number;
  note?: string;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function OwnerProductionStatus() {
  const [launch, setLaunch] = useState<LaunchRow | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadLaunch() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const result = await supabase
      .from("production_launch_requests")
      .select(
        "id, production_branch, production_url, status, execution_started_at, execution_completed_at, netlify_build_id, netlify_deploy_id, published_url, error_message, created_at"
      )
      .in("status", ["launching", "published", "failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) {
      setError(result.error.message);
    } else {
      setLaunch((result.data as LaunchRow | null) || null);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadLaunch();
  }, []);

  async function checkStatus() {
    if (!supabase || !launch) return;

    setChecking(true);
    setError("");
    setMessage("");

    const result = await supabase.functions.invoke("check-production-netlify-status", {
      body: { launch_request_id: launch.id },
    });

    setChecking(false);

    if (result.error) {
      setError(`Status check failed: ${result.error.message}. No new build was started.`);
      return;
    }

    const status = result.data as StatusResult;

    setDiagnostics({
      buildDone: status.build_done,
      deployState: status.deploy_state,
      deployContext: status.deploy_context,
      productionUrlStatus: status.production_url_status,
      note: status.note,
    });

    setLaunch((current) =>
      current
        ? {
            ...current,
            status: status.status,
            netlify_build_id: status.netlify_build_id || current.netlify_build_id,
            netlify_deploy_id: status.netlify_deploy_id || current.netlify_deploy_id,
            published_url: status.production_published
              ? status.production_url || current.production_url
              : current.published_url,
            execution_completed_at:
              status.status === "published"
                ? status.published_at || new Date().toISOString()
                : current.execution_completed_at,
            error_message: status.status === "failed" ? status.error || "Production deployment failed." : null,
          }
        : current
    );

    if (status.status === "published") {
      setMessage("Production publication confirmed. The live production URL is reachable.");
    } else if (status.status === "failed") {
      setError(`Production deployment failed: ${status.error || "Unknown Netlify error."}`);
    } else if ((status.deploy_state || "").toLowerCase() === "ready") {
      setMessage(
        "The Netlify deploy is ready, but live publication has not been confirmed. It is eligible for the explicit owner publish checkpoint. No new build was started."
      );
    } else {
      setMessage(
        `Production is still processing. Netlify state: ${status.deploy_state || "unknown"}. No new build was started.`
      );
    }
  }

  async function publishDeploy() {
    if (!supabase || !launch) return;

    const confirmation = window.prompt(
      "LIVE ACTION: Publish the already-built ready production deploy? This will switch the live production site. Type PUBLISH_PRODUCTION_DEPLOY exactly to continue."
    );

    if (confirmation !== "PUBLISH_PRODUCTION_DEPLOY") {
      if (confirmation !== null) {
        setError("Exact publish confirmation was not entered. Nothing was published.");
      }
      return;
    }

    setPublishing(true);
    setError("");
    setMessage("");

    const result = await supabase.functions.invoke("publish-production-netlify-deploy", {
      body: {
        launch_request_id: launch.id,
        confirmation,
      },
    });

    setPublishing(false);

    if (result.error) {
      setError(`Production publish failed: ${result.error.message}. No new build was started.`);
      return;
    }

    const publish = result.data as PublishResult;

    setLaunch((current) =>
      current
        ? {
            ...current,
            status: publish.status,
            published_url: publish.production_published
              ? publish.production_url || current.production_url
              : current.published_url,
            execution_completed_at:
              publish.status === "published"
                ? publish.published_at || new Date().toISOString()
                : current.execution_completed_at,
          }
        : current
    );

    setDiagnostics((current) => ({
      ...current,
      deployState: publish.deploy_state || current?.deployState,
      productionUrlStatus: publish.production_url_status,
      note: publish.note,
    }));

    if (publish.status === "published" && publish.production_published) {
      setMessage("Production published successfully. The selected ready deploy is live and the production URL is reachable.");
    } else {
      setMessage(
        publish.note ||
          "Netlify accepted the publish request, but final live publication is not confirmed yet. Run the read-only status check once."
      );
    }
  }

  const readyToPublish =
    launch?.status === "launching" &&
    diagnostics?.deployState?.toLowerCase() === "ready" &&
    (diagnostics.deployContext || "production").toLowerCase() === "production";

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShieldCheck size={22} />
            <div>
              <h1>Production status</h1>
              <p className="subtle">Controlled tracking and explicit publication for the one production build already started.</p>
            </div>
          </div>
          <div className="client-control-row">
            <a className="icon-btn" href="/owner/production-launches">Back to launches</a>
            <button className="icon-btn" type="button" onClick={() => void loadLaunch()}>
              <RefreshCcw size={16} />Refresh record
            </button>
          </div>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}

        <section className="panel">
          {loading ? <div className="empty-state">Loading production status...</div> : null}
          {!loading && !launch ? <div className="empty-state">No started production build was found.</div> : null}

          {launch ? (
            <div className={launch.status === "failed" ? "auth-error" : "auth-success"}>
              <strong>Status: {launch.status.replaceAll("_", " ")}</strong>
              <small>Production branch: {launch.production_branch}</small>
              {launch.execution_started_at ? <small>Started: {formatDateTime(launch.execution_started_at)}</small> : null}
              {launch.execution_completed_at ? <small>Completed: {formatDateTime(launch.execution_completed_at)}</small> : null}
              {launch.netlify_build_id ? <small>Build: {launch.netlify_build_id.slice(0, 8)}</small> : null}
              {launch.netlify_deploy_id ? <small>Deploy: {launch.netlify_deploy_id.slice(0, 8)}</small> : null}
              <small>Live publication confirmed: {launch.status === "published" ? "Yes" : "No"}</small>

              {diagnostics ? (
                <div className="auth-success">
                  <strong>Latest read-only diagnostics</strong>
                  <small>Build finished: {diagnostics.buildDone === true ? "Yes" : diagnostics.buildDone === false ? "No" : "Unknown"}</small>
                  <small>Deploy state: {diagnostics.deployState || "Unknown"}</small>
                  <small>Deploy context: {diagnostics.deployContext || "Not reported"}</small>
                  <small>Deploy branch: {launch.production_branch}</small>
                  <small>
                    Production URL response: {typeof diagnostics.productionUrlStatus === "number" ? diagnostics.productionUrlStatus : "Not checked because publication is not confirmed"}
                  </small>
                  <small>Netlify result: {diagnostics.note || "No diagnostic note was returned."}</small>
                  {readyToPublish ? (
                    <small>Final condition: owner must explicitly publish this exact ready deploy.</small>
                  ) : null}
                </div>
              ) : null}

              {launch.status === "launching" ? (
                <button className="wide-btn" type="button" disabled={checking || publishing} onClick={() => void checkStatus()}>
                  <RefreshCcw size={16} />
                  {checking ? "Checking production status..." : "Check production status"}
                </button>
              ) : null}

              {readyToPublish ? (
                <>
                  <div className="auth-error">
                    <strong>Live production action</strong>
                    <small>This publishes the already-built deploy to the live production URL.</small>
                    <small>No second build will be started and auto-publish will remain locked.</small>
                  </div>
                  <button className="wide-btn" type="button" disabled={publishing || checking} onClick={() => void publishDeploy()}>
                    <Rocket size={16} />
                    {publishing ? "Publishing ready production deploy..." : "Publish ready production deploy"}
                  </button>
                </>
              ) : null}

              {launch.status === "published" && launch.published_url ? (
                <a href={launch.published_url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} />Open production website
                </a>
              ) : null}

              <small>This page cannot start another build or unlock auto-publish.</small>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
