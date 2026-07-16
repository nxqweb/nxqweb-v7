import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, GitBranch, LockKeyhole, RefreshCcw, Rocket, Save } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientRow = {
  id: string;
  business_name: string;
};

type ProjectRow = {
  id: string;
  client_id: string;
  website_status: string;
};

type DeploymentConfigRow = {
  id: string;
  project_id: string;
  client_id: string;
  github_owner: string | null;
  github_repo: string | null;
  production_branch: string;
  netlify_site_id: string | null;
  production_url: string | null;
  auto_publish_locked: boolean;
  last_deployed_commit: string | null;
  last_deployment_status: string;
  updated_at: string;
};

type DeploymentRow = {
  id: string;
  deployment_config_id: string;
  project_id: string;
  client_id: string;
  trigger_source: string;
  deploy_kind: string;
  branch: string;
  git_commit_sha: string | null;
  deploy_url: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
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
  return value ? value.slice(0, 8) : "None yet";
}

export function OwnerDeployments() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [configs, setConfigs] = useState<DeploymentConfigRow[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [productionBranch, setProductionBranch] = useState("main");
  const [netlifySiteId, setNetlifySiteId] = useState("");
  const [productionUrl, setProductionUrl] = useState("");
  const [autoPublishLocked, setAutoPublishLocked] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadDeploymentData() {
    setIsLoading(true);
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet.");
      setIsLoading(false);
      return;
    }

    const [clientResult, projectResult, configResult, deploymentResult] = await Promise.all([
      supabase.from("clients").select("id, business_name").order("business_name"),
      supabase.from("projects").select("id, client_id, website_status"),
      supabase
        .from("project_deployment_configs")
        .select(
          "id, project_id, client_id, github_owner, github_repo, production_branch, netlify_site_id, production_url, auto_publish_locked, last_deployed_commit, last_deployment_status, updated_at"
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("project_deployments")
        .select(
          "id, deployment_config_id, project_id, client_id, trigger_source, deploy_kind, branch, git_commit_sha, deploy_url, status, error_message, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const firstError =
      clientResult.error || projectResult.error || configResult.error || deploymentResult.error;

    if (firstError) {
      setErrorMessage(firstError.message || "Unable to load deployment data.");
      setIsLoading(false);
      return;
    }

    setClients((clientResult.data || []) as ClientRow[]);
    setProjects((projectResult.data || []) as ProjectRow[]);
    setConfigs((configResult.data || []) as DeploymentConfigRow[]);
    setDeployments((deploymentResult.data || []) as DeploymentRow[]);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadDeploymentData();
  }, []);

  const clientNameById = useMemo(
    () => new Map(clients.map((client) => [client.id, client.business_name])),
    [clients]
  );

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );

  const visibleConfigs = configs.filter(
    (config) => !selectedClientId || config.client_id === selectedClientId
  );

  const visibleDeployments = deployments.filter(
    (deployment) => !selectedClientId || deployment.client_id === selectedClientId
  );

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const selectedConfig = configs.find((config) => config.project_id === selectedProjectId) || null;

  function loadProjectIntoForm(projectId: string) {
    setSelectedProjectId(projectId);
    setActionMessage("");
    setErrorMessage("");

    const existingConfig = configs.find((config) => config.project_id === projectId);

    if (!existingConfig) {
      setGithubOwner("");
      setGithubRepo("");
      setProductionBranch("main");
      setNetlifySiteId("");
      setProductionUrl("");
      setAutoPublishLocked(true);
      return;
    }

    setGithubOwner(existingConfig.github_owner || "");
    setGithubRepo(existingConfig.github_repo || "");
    setProductionBranch(existingConfig.production_branch || "main");
    setNetlifySiteId(existingConfig.netlify_site_id || "");
    setProductionUrl(existingConfig.production_url || "");
    setAutoPublishLocked(existingConfig.auto_publish_locked);
  }

  async function saveConnection() {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!selectedProject) {
      setErrorMessage("Pick a project before saving a deployment connection.");
      return;
    }

    const cleanGithubOwner = githubOwner.trim();
    const cleanGithubRepo = githubRepo.trim();
    const cleanProductionBranch = productionBranch.trim() || "main";
    const cleanNetlifySiteId = netlifySiteId.trim();
    const cleanProductionUrl = productionUrl.trim();

    if ((cleanGithubOwner && !cleanGithubRepo) || (!cleanGithubOwner && cleanGithubRepo)) {
      setErrorMessage("GitHub owner and repository must either both be filled in or both be blank.");
      return;
    }

    if (cleanProductionUrl) {
      try {
        const parsedUrl = new URL(cleanProductionUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          throw new Error("Unsupported URL protocol.");
        }
      } catch {
        setErrorMessage("Production URL must be a valid http or https URL.");
        return;
      }
    }

    setIsSaving(true);
    setActionMessage("");
    setErrorMessage("");

    const saveResult = await supabase
      .from("project_deployment_configs")
      .upsert(
        {
          project_id: selectedProject.id,
          client_id: selectedProject.client_id,
          github_owner: cleanGithubOwner || null,
          github_repo: cleanGithubRepo || null,
          production_branch: cleanProductionBranch,
          netlify_site_id: cleanNetlifySiteId || null,
          production_url: cleanProductionUrl || null,
          auto_publish_locked: autoPublishLocked,
          last_deployment_status: selectedConfig?.last_deployment_status || "not_configured",
          last_deployed_commit: selectedConfig?.last_deployed_commit || null,
        },
        { onConflict: "project_id" }
      )
      .select(
        "id, project_id, client_id, github_owner, github_repo, production_branch, netlify_site_id, production_url, auto_publish_locked, last_deployed_commit, last_deployment_status, updated_at"
      )
      .single();

    setIsSaving(false);

    if (saveResult.error) {
      setErrorMessage(`Connection save failed: ${saveResult.error.message}`);
      return;
    }

    const savedConfig = saveResult.data as DeploymentConfigRow;
    setConfigs((current) => [
      savedConfig,
      ...current.filter((config) => config.project_id !== savedConfig.project_id),
    ]);
    setActionMessage(
      `${clientNameById.get(savedConfig.client_id) || "Project"} deployment connection saved. No deploy was triggered.`
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Rocket size={22} />
            <div>
              <h1>Build and deployments</h1>
              <p className="subtle">
                Owner-controlled GitHub and Netlify tracking. No deploy action is enabled yet.
              </p>
            </div>
          </div>

          <div className="client-control-row">
            <a className="icon-btn" href="/owner">
              <ArrowLeft size={16} />
              Owner portal
            </a>
            <button className="icon-btn" onClick={loadDeploymentData} type="button">
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
            <h2>Connect a client project</h2>
          </div>

          <div className="message-filter-row">
            <select
              className="message-filter-select"
              value={selectedProjectId}
              onChange={(event) => loadProjectIntoForm(event.target.value)}
            >
              <option value="">Pick a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {clientNameById.get(project.client_id) || "Unknown client"} ·{" "}
                  {formatStatus(project.website_status)}
                </option>
              ))}
            </select>
          </div>

          <div className="owner-reply-box">
            <label htmlFor="github-owner">GitHub owner or organization</label>
            <input
              id="github-owner"
              value={githubOwner}
              onChange={(event) => setGithubOwner(event.target.value)}
              placeholder="nxqweb"
              disabled={!selectedProjectId}
            />

            <label htmlFor="github-repo">GitHub repository</label>
            <input
              id="github-repo"
              value={githubRepo}
              onChange={(event) => setGithubRepo(event.target.value)}
              placeholder="client-business-website"
              disabled={!selectedProjectId}
            />

            <label htmlFor="production-branch">Production branch</label>
            <input
              id="production-branch"
              value={productionBranch}
              onChange={(event) => setProductionBranch(event.target.value)}
              placeholder="main"
              disabled={!selectedProjectId}
            />

            <label htmlFor="netlify-site-id">Netlify site ID</label>
            <input
              id="netlify-site-id"
              value={netlifySiteId}
              onChange={(event) => setNetlifySiteId(event.target.value)}
              placeholder="Netlify site ID"
              disabled={!selectedProjectId}
            />

            <label htmlFor="production-url">Production URL</label>
            <input
              id="production-url"
              type="url"
              value={productionUrl}
              onChange={(event) => setProductionUrl(event.target.value)}
              placeholder="https://clientwebsite.com"
              disabled={!selectedProjectId}
            />

            <label>
              <input
                type="checkbox"
                checked={autoPublishLocked}
                onChange={(event) => setAutoPublishLocked(event.target.checked)}
                disabled={!selectedProjectId}
              />{" "}
              Auto publishing is locked
            </label>

            <button
              className="wide-btn"
              type="button"
              onClick={() => void saveConnection()}
              disabled={!selectedProjectId || isSaving}
            >
              <Save size={16} />
              {isSaving ? "Saving connection..." : "Save connection"}
            </button>

            <small>
              This stores configuration only. It does not create a repository, change Netlify, or
              trigger a deployment.
            </small>
          </div>
        </section>

        <section className="panel">
          <div className="message-filter-row">
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

          {isLoading ? <div className="empty-state">Loading deployment records...</div> : null}

          {!isLoading && visibleConfigs.length === 0 ? (
            <div className="empty-state">
              No deployment configuration records yet. This is expected until a project is connected.
            </div>
          ) : null}

          <div className="owner-message-list">
            {visibleConfigs.map((config) => {
              const project = projectById.get(config.project_id);
              const repository =
                config.github_owner && config.github_repo
                  ? `${config.github_owner}/${config.github_repo}`
                  : "Not connected";

              return (
                <article className="owner-message-card" key={config.id}>
                  <div className="owner-message-top">
                    <strong>{clientNameById.get(config.client_id) || "Unknown client"}</strong>
                    <span>{formatDateTime(config.updated_at)}</span>
                  </div>

                  <p>
                    Project: {project?.website_status ? formatStatus(project.website_status) : "Unknown"}
                  </p>
                  <small>GitHub: {repository}</small>
                  <small>
                    <GitBranch size={14} /> Branch: {config.production_branch}
                  </small>
                  <small>Netlify site: {config.netlify_site_id || "Not connected"}</small>
                  <small>Status: {formatStatus(config.last_deployment_status)}</small>
                  <small>Last commit: {shortCommit(config.last_deployed_commit)}</small>
                  <small>
                    <LockKeyhole size={14} /> Auto publish: {config.auto_publish_locked ? "Locked" : "Unlocked"}
                  </small>

                  {config.production_url ? (
                    <a
                      className="wide-btn"
                      href={config.production_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={16} />
                      Open production site
                    </a>
                  ) : null}

                  <button
                    className="wide-btn"
                    type="button"
                    onClick={() => {
                      loadProjectIntoForm(config.project_id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Edit connection
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <Rocket size={20} />
            <h2>Recent deployment history</h2>
          </div>

          {!isLoading && visibleDeployments.length === 0 ? (
            <div className="empty-state">No preview or production deployment history yet.</div>
          ) : null}

          <div className="owner-message-list">
            {visibleDeployments.map((deployment) => (
              <article className="owner-message-card" key={deployment.id}>
                <div className="owner-message-top">
                  <strong>{clientNameById.get(deployment.client_id) || "Unknown client"}</strong>
                  <span>{formatDateTime(deployment.created_at)}</span>
                </div>
                <p>
                  {formatStatus(deployment.deploy_kind)} · {formatStatus(deployment.status)}
                </p>
                <small>Branch: {deployment.branch}</small>
                <small>Commit: {shortCommit(deployment.git_commit_sha)}</small>
                <small>Triggered by: {formatStatus(deployment.trigger_source)}</small>
                {deployment.error_message ? <small>Error: {deployment.error_message}</small> : null}
                {deployment.deploy_url ? (
                  <a
                    className="wide-btn"
                    href={deployment.deploy_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} />
                    Open deployment
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
