import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  RefreshCcw,
  Rocket,
  SearchCheck,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientRow = {
  id: string;
  business_name: string;
};

type DeploymentConfigRow = {
  id: string;
  project_id: string;
  client_id: string;
  github_owner: string | null;
  github_repo: string | null;
  production_branch: string;
  auto_publish_locked: boolean;
};

type SafetyCheck = {
  ok: boolean;
  status: "pass" | "fail" | "not_configured";
  message: string;
};

type SafetyResult = {
  ok: boolean;
  request_id: string;
  project_id: string;
  client_id: string;
  passed: boolean;
  checked_at: string;
  safety_status: "passed" | "needs_attention";
  checks: Record<string, SafetyCheck>;
  note: string;
};

type ExecutionStatus =
  | "not_prepared"
  | "prepared"
  | "executing"
  | "published"
  | "failed"
  | "cancelled";

type PreviewRequestRow = {
  id: string;
  deployment_config_id: string;
  project_id: string;
  client_id: string;
  source_branch: string;
  requested_commit_sha: string | null;
  status: string;
  owner_decision_at: string | null;
  owner_decision_note: string | null;
  preview_deploy_id: string | null;
  preview_url: string | null;
  error_message: string | null;
  safety_checked_at: string | null;
  safety_status: "not_checked" | "passed" | "needs_attention";
  safety_details: Record<string, SafetyCheck> | null;
  execution_status: ExecutionStatus;
  execution_prepared_at: string | null;
  execution_deployment_id: string | null;
  execution_error: string | null;
  created_at: string;
  updated_at: string;
};

type PreparedExecutionResult = {
  ok: boolean;
  request_id: string;
  execution_status: "prepared";
  execution_prepared_at: string;
  deployment_record: {
    id: string;
    status: string;
    branch: string;
    git_commit_sha: string | null;
    created_at: string;
  };
  note: string;
};

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function shortCommit(value: string | null) {
  return value ? value.slice(0, 8) : "Not pinned";
}

const previewRequestSelect =
  "id, deployment_config_id, project_id, client_id, source_branch, requested_commit_sha, status, owner_decision_at, owner_decision_note, preview_deploy_id, preview_url, error_message, safety_checked_at, safety_status, safety_details, execution_status, execution_prepared_at, execution_deployment_id, execution_error, created_at, updated_at";

export function OwnerPreviewRequests() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [configs, setConfigs] = useState<DeploymentConfigRow[]>([]);
  const [requests, setRequests] = useState<PreviewRequestRow[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [requestedCommitSha, setRequestedCommitSha] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [decidingRequestId, setDecidingRequestId] = useState("");
  const [checkingRequestId, setCheckingRequestId] = useState("");
  const [preparingRequestId, setPreparingRequestId] = useState("");
  const [safetyByRequestId, setSafetyByRequestId] = useState<Record<string, SafetyResult>>({});
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadPreviewData() {
    setIsLoading(true);
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet.");
      setIsLoading(false);
      return;
    }

    const [clientResult, configResult, requestResult] = await Promise.all([
      supabase.from("clients").select("id, business_name").order("business_name"),
      supabase
        .from("project_deployment_configs")
        .select(
          "id, project_id, client_id, github_owner, github_repo, production_branch, auto_publish_locked"
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("preview_deployment_requests")
        .select(previewRequestSelect)
        .order("created_at", { ascending: false }),
    ]);

    const firstError = clientResult.error || configResult.error || requestResult.error;

    if (firstError) {
      setErrorMessage(firstError.message || "Unable to load preview requests.");
      setIsLoading(false);
      return;
    }

    setClients((clientResult.data || []) as ClientRow[]);
    setConfigs((configResult.data || []) as DeploymentConfigRow[]);
    setRequests((requestResult.data || []) as PreviewRequestRow[]);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadPreviewData();
  }, []);

  const clientNameById = useMemo(
    () => new Map(clients.map((client) => [client.id, client.business_name])),
    [clients]
  );

  const selectedConfig = configs.find((config) => config.id === selectedConfigId) || null;

  const visibleRequests = requests.filter(
    (request) => !selectedClientId || request.client_id === selectedClientId
  );

  async function createPreviewRequest() {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!selectedConfig) {
      setErrorMessage("Pick a connected project first.");
      return;
    }

    const cleanBranch = sourceBranch.trim();
    const cleanCommit = requestedCommitSha.trim();
    const cleanNote = requestNote.trim();

    if (!cleanBranch) {
      setErrorMessage("Enter the non-production branch that should be reviewed.");
      return;
    }

    if (cleanBranch.toLowerCase() === "main") {
      setErrorMessage("The main branch cannot be used for a preview request.");
      return;
    }

    if (cleanBranch === selectedConfig.production_branch) {
      setErrorMessage("The production branch cannot be used for a preview request.");
      return;
    }

    if (!selectedConfig.auto_publish_locked) {
      setErrorMessage("Auto publishing must be recorded as locked before creating a preview request.");
      return;
    }

    setIsCreating(true);
    setActionMessage("");
    setErrorMessage("");

    const result = await supabase
      .from("preview_deployment_requests")
      .insert({
        deployment_config_id: selectedConfig.id,
        project_id: selectedConfig.project_id,
        client_id: selectedConfig.client_id,
        source_branch: cleanBranch,
        requested_commit_sha: cleanCommit || null,
        owner_decision_note: cleanNote || null,
        status: "pending_owner_approval",
      })
      .select(previewRequestSelect)
      .single();

    setIsCreating(false);

    if (result.error) {
      setErrorMessage(`Preview request creation failed: ${result.error.message}`);
      return;
    }

    const created = result.data as PreviewRequestRow;
    setRequests((current) => [created, ...current]);
    setSourceBranch("");
    setRequestedCommitSha("");
    setRequestNote("");
    setActionMessage(
      `${clientNameById.get(created.client_id) || "Project"} preview request created. No deployment was triggered.`
    );
  }

  async function decidePreviewRequest(
    request: PreviewRequestRow,
    decision: "approved_for_preview" | "rejected"
  ) {
    if (!supabase) return;

    const notePrompt =
      decision === "approved_for_preview" ? "Optional approval note" : "Reason for rejection";
    const note = window.prompt(notePrompt, request.owner_decision_note || "");

    if (note === null) return;
    if (decision === "rejected" && !note.trim()) {
      setErrorMessage("A rejection reason is required.");
      return;
    }

    setDecidingRequestId(request.id);
    setActionMessage("");
    setErrorMessage("");

    const userResult = await supabase.auth.getUser();

    if (userResult.error || !userResult.data.user) {
      setDecidingRequestId("");
      setErrorMessage(userResult.error?.message || "Unable to confirm the owner account.");
      return;
    }

    const decisionAt = new Date().toISOString();
    const result = await supabase
      .from("preview_deployment_requests")
      .update({
        status: decision,
        owner_decision_by: userResult.data.user.id,
        owner_decision_at: decisionAt,
        owner_decision_note: note.trim() || null,
      })
      .eq("id", request.id)
      .eq("status", "pending_owner_approval")
      .select(previewRequestSelect)
      .single();

    setDecidingRequestId("");

    if (result.error) {
      setErrorMessage(`Preview decision failed: ${result.error.message}`);
      return;
    }

    const updated = result.data as PreviewRequestRow;
    setRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActionMessage(
      decision === "approved_for_preview"
        ? "Preview request approved for a future preview-only deploy. Nothing was deployed."
        : "Preview request rejected. Nothing was deployed."
    );
  }

  async function runSafetyCheck(request: PreviewRequestRow) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    setCheckingRequestId(request.id);
    setActionMessage("");
    setErrorMessage("");

    const result = await supabase.functions.invoke("check-preview-deployment-safety", {
      body: { request_id: request.id },
    });

    setCheckingRequestId("");

    if (result.error) {
      setErrorMessage(`Preview safety check failed: ${result.error.message}`);
      return;
    }

    const safety = result.data as SafetyResult;
    setSafetyByRequestId((current) => ({ ...current, [request.id]: safety }));
    setRequests((current) =>
      current.map((item) =>
        item.id === request.id
          ? {
              ...item,
              safety_checked_at: safety.checked_at,
              safety_status: safety.safety_status,
              safety_details: safety.checks,
            }
          : item
      )
    );
    setActionMessage(
      safety.passed
        ? "Preview safety check passed. Nothing was deployed."
        : "Preview safety check found items needing attention. Nothing was deployed."
    );
  }

  async function preparePreviewExecution(request: PreviewRequestRow) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const confirmed = window.confirm(
      "Prepare one internal queued preview execution record? This will not call Netlify or deploy anything."
    );

    if (!confirmed) return;

    setPreparingRequestId(request.id);
    setActionMessage("");
    setErrorMessage("");

    const result = await supabase.functions.invoke("prepare-preview-deployment-execution", {
      body: { request_id: request.id },
    });

    setPreparingRequestId("");

    if (result.error) {
      setErrorMessage(`Preview execution preparation failed: ${result.error.message}`);
      return;
    }

    const prepared = result.data as PreparedExecutionResult;
    setRequests((current) =>
      current.map((item) =>
        item.id === request.id
          ? {
              ...item,
              execution_status: prepared.execution_status,
              execution_prepared_at: prepared.execution_prepared_at,
              execution_deployment_id: prepared.deployment_record.id,
              execution_error: null,
            }
          : item
      )
    );
    setActionMessage(
      "Preview execution prepared as an internal queued record. Nothing was deployed."
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <ShieldCheck size={22} />
            <div>
              <h1>Preview requests</h1>
              <p className="subtle">
                Owner approval, safety verification, and internal preparation only. This page cannot publish a website.
              </p>
            </div>
          </div>

          <div className="client-control-row">
            <a className="icon-btn" href="/owner/deployments">
              <ArrowLeft size={16} />
              Deployments
            </a>
            <a className="icon-btn" href="/owner">
              <Rocket size={16} />
              Owner portal
            </a>
            <button className="icon-btn" onClick={() => void loadPreviewData()} type="button">
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
        </div>

        {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
        {actionMessage ? <div className="auth-success">{actionMessage}</div> : null}

        <section className="panel">
          <div className="panel-title">
            <GitBranch size={20} />
            <h2>Create preview request</h2>
          </div>

          <div className="owner-reply-box">
            <label htmlFor="preview-project">Connected project</label>
            <select
              id="preview-project"
              className="message-filter-select"
              value={selectedConfigId}
              onChange={(event) => {
                setSelectedConfigId(event.target.value);
                setErrorMessage("");
                setActionMessage("");
              }}
            >
              <option value="">Pick a connected project</option>
              {configs.map((config) => (
                <option key={config.id} value={config.id}>
                  {clientNameById.get(config.client_id) || "Unknown client"} · {config.github_owner || "No GitHub"}/{config.github_repo || "repo"}
                </option>
              ))}
            </select>

            <label htmlFor="preview-source-branch">Preview source branch</label>
            <input
              id="preview-source-branch"
              value={sourceBranch}
              onChange={(event) => setSourceBranch(event.target.value)}
              placeholder="preview/client-redesign"
              disabled={!selectedConfigId}
            />

            <label htmlFor="preview-commit">Commit SHA (optional)</label>
            <input
              id="preview-commit"
              value={requestedCommitSha}
              onChange={(event) => setRequestedCommitSha(event.target.value)}
              placeholder="Pin the preview to a specific commit"
              disabled={!selectedConfigId}
            />

            <label htmlFor="preview-note">Request note (optional)</label>
            <textarea
              id="preview-note"
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              placeholder="What should the owner review in this preview?"
              disabled={!selectedConfigId}
            />

            {selectedConfig ? (
              <small>
                Production branch: {selectedConfig.production_branch} · Auto publish: {selectedConfig.auto_publish_locked ? "Locked" : "Unlocked"}
              </small>
            ) : null}

            <button
              className="wide-btn"
              type="button"
              onClick={() => void createPreviewRequest()}
              disabled={!selectedConfigId || isCreating}
            >
              <ShieldCheck size={16} />
              {isCreating ? "Creating request..." : "Create approval request"}
            </button>

            <small>This creates a database record only. No preview or production deploy is triggered.</small>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title panel-title-row">
            <div className="panel-title">
              <ShieldCheck size={20} />
              <h2>Preview approval queue</h2>
            </div>

            <select
              className="message-filter-select"
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
            >
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.business_name}
                </option>
              ))}
            </select>
          </div>

          {isLoading ? <div className="empty-state">Loading preview requests...</div> : null}
          {!isLoading && visibleRequests.length === 0 ? (
            <div className="empty-state">No preview requests yet.</div>
          ) : null}

          <div className="owner-message-list">
            {visibleRequests.map((request) => {
              const liveSafety = safetyByRequestId[request.id];
              const checks = liveSafety?.checks || request.safety_details || null;

              return (
                <article className="owner-message-card" key={request.id}>
                  <div className="owner-message-top">
                    <strong>{clientNameById.get(request.client_id) || "Unknown client"}</strong>
                    <span>{formatDateTime(request.created_at)}</span>
                  </div>

                  <p>{formatStatus(request.status)}</p>
                  <small><GitBranch size={14} /> Source branch: {request.source_branch}</small>
                  <small>Requested commit: {shortCommit(request.requested_commit_sha)}</small>
                  {request.owner_decision_at ? (
                    <small>Decision recorded: {formatDateTime(request.owner_decision_at)}</small>
                  ) : null}
                  {request.owner_decision_note ? <small>Note: {request.owner_decision_note}</small> : null}
                  {request.error_message ? <div className="auth-error">{request.error_message}</div> : null}

                  {request.status === "pending_owner_approval" ? (
                    <div className="client-control-row">
                      <button
                        className="wide-btn"
                        type="button"
                        disabled={decidingRequestId === request.id}
                        onClick={() => void decidePreviewRequest(request, "approved_for_preview")}
                      >
                        <CheckCircle2 size={16} />
                        Approve preview request
                      </button>
                      <button
                        className="wide-btn danger"
                        type="button"
                        disabled={decidingRequestId === request.id}
                        onClick={() => void decidePreviewRequest(request, "rejected")}
                      >
                        <XCircle size={16} />
                        Reject request
                      </button>
                    </div>
                  ) : null}

                  {request.status === "approved_for_preview" ? (
                    <button
                      className="wide-btn"
                      type="button"
                      disabled={checkingRequestId === request.id}
                      onClick={() => void runSafetyCheck(request)}
                    >
                      <SearchCheck size={16} />
                      {checkingRequestId === request.id ? "Running safety check..." : "Run preview safety check"}
                    </button>
                  ) : null}

                  {request.status === "approved_for_preview" &&
                  request.safety_status === "passed" &&
                  request.execution_status === "not_prepared" ? (
                    <button
                      className="wide-btn"
                      type="button"
                      disabled={preparingRequestId === request.id}
                      onClick={() => void preparePreviewExecution(request)}
                    >
                      <ShieldCheck size={16} />
                      {preparingRequestId === request.id
                        ? "Preparing execution..."
                        : "Prepare preview execution"}
                    </button>
                  ) : null}

                  {request.execution_status === "prepared" ? (
                    <div className="auth-success">
                      <strong>Preview execution prepared</strong>
                      <small>Internal status: prepared · queued record created</small>
                      {request.execution_prepared_at ? (
                        <small>Prepared {formatDateTime(request.execution_prepared_at)}</small>
                      ) : null}
                      {request.execution_deployment_id ? (
                        <small>Record: {request.execution_deployment_id.slice(0, 8)}</small>
                      ) : null}
                      <small>No GitHub write or Netlify deployment occurred.</small>
                    </div>
                  ) : null}

                  {request.execution_error ? (
                    <div className="auth-error">{request.execution_error}</div>
                  ) : null}

                  {request.safety_checked_at ? (
                    <div className={request.safety_status === "passed" ? "auth-success" : "auth-error"}>
                      <strong>
                        Saved safety result: {request.safety_status === "passed" ? "All checks passed" : "Needs attention"}
                      </strong>
                      <small>Checked {formatDateTime(request.safety_checked_at)}</small>
                    </div>
                  ) : (
                    <small>Preview safety check: Not run yet</small>
                  )}

                  {checks ? (
                    <div className={request.safety_status === "passed" ? "auth-success" : "auth-error"}>
                      {Object.entries(checks).map(([name, check]) => (
                        <div key={name}>
                          {check.status === "pass" ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {formatStatus(name)}: {check.message}
                        </div>
                      ))}
                      <small>This safety check is read-only. No deployment was triggered.</small>
                    </div>
                  ) : null}

                  {request.preview_url ? (
                    <a className="wide-btn" href={request.preview_url} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      Open preview
                    </a>
                  ) : null}

                  <small>
                    This page can approve, verify, and prepare an internal queued record only. It cannot publish to Netlify.
                  </small>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
