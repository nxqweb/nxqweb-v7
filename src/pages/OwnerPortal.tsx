import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  MessageSquareText,
  RefreshCcw,
  Users,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ApprovalStatus =
  | "pending"
  | "accepted"
  | "denied"
  | "revision_requested"
  | "more_info_requested"
  | "cancelled";

type RiskLevel = "low" | "medium" | "high";

type ClientRow = {
  id: string;
  business_name: string;
  contact_name: string | null;
  contact_email: string | null;
  business_type: string | null;
  status: string;
  monthly_price: number;
};

type ApprovalRow = {
  id: string;
  client_id: string | null;
  project_id: string | null;
  request_type: string;
  title: string;
  summary: string;
  recommended_action: string | null;
  risk_level: RiskLevel;
  status: ApprovalStatus;
  owner_response: string | null;
  created_at: string;
};
type ClientMessageRow = {
  id: string;
  client_id: string | null;
  sender_type: "owner" | "client" | "ai" | "system";
  message: string;
  needs_owner_review: boolean;
  ai_handled: boolean;
  created_at: string;
};

type ProjectRow = {
  id: string;
  client_id: string | null;
  website_status: string;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function isWebsiteSetupReport(approval: ApprovalRow) {
  return (
    approval.request_type === "website_setup_review" ||
    approval.recommended_action?.includes("NXQ WEB WEBSITE SETUP REPORT")
  );
}

function parseSetupReport(report: string) {
  const lines = report
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const fields: { label: string; value: string }[] = [];
  let currentLabel = "";

  for (const line of lines) {
    if (line === "NXQ WEB WEBSITE SETUP REPORT") continue;

    if (line.endsWith(":")) {
      currentLabel = line.replace(":", "");
      fields.push({ label: currentLabel, value: "" });
      continue;
    }

    const colonIndex = line.indexOf(":");

    if (colonIndex > -1 && colonIndex < 35) {
      const label = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      fields.push({ label, value });
      currentLabel = label;
      continue;
    }

    if (currentLabel && fields.length > 0) {
      const lastField = fields[fields.length - 1];
      lastField.value = lastField.value ? `${lastField.value} ${line}` : line;
    }
  }

  return fields;
}
export function OwnerPortal() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clientMessages, setClientMessages] = useState<ClientMessageRow[]>([]);
  const [selectedMessageClientId, setSelectedMessageClientId] = useState("all");
  const [ownerReplyText, setOwnerReplyText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const monthlyIncome = useMemo(() => {
    return clients.reduce((total, client) => total + Number(client.monthly_price || 0), 0);
  }, [clients]);

  const filteredClientMessages = useMemo(() => {
    if (selectedMessageClientId === "all") {
      return clientMessages;
    }

    return clientMessages.filter((message) => message.client_id === selectedMessageClientId);
  }, [clientMessages, selectedMessageClientId]);

  const selectedReplyClientId = useMemo(() => {
    if (selectedMessageClientId !== "all") {
      return selectedMessageClientId;
    }

    return clients[0]?.id || "";
  }, [clients, selectedMessageClientId]);
  function getClientForApproval(approval: ApprovalRow) {
    return clients.find((client) => client.id === approval.client_id) || null;
  }

  function getProjectForClient(clientId: string) {
    return projects.find((project) => project.client_id === clientId) || null;
  }
  function getClientForMessage(message: ClientMessageRow) {
  return clients.find((client) => client.id === message.client_id) || null;
}

  function confirmHighRiskAction(action: "accept" | "deny", clientName: string) {
    const actionLabel = action === "accept" ? "ACCEPT" : "DENY";

    return window.confirm(
      `Confirm ${actionLabel}\n\nClient: ${clientName}\n\nThis will update the approval request in Supabase. Continue?`
    );
  }

  async function sendOwnerReply() {
    const trimmedMessage = ownerReplyText.trim();

    if (!selectedReplyClientId) {
      setErrorMessage("Pick a client before sending a reply.");
      return;
    }

    if (!trimmedMessage) {
      setErrorMessage("Type a reply before sending.");
      return;
    }

    setErrorMessage("");
    setActionMessage("");

    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const replyResult = await supabase.from("client_messages").insert({
      client_id: selectedReplyClientId,
      sender_type: "owner",
      message: trimmedMessage,
      needs_owner_review: false,
      ai_handled: false,
    });

    if (replyResult.error) {
      setErrorMessage(`Owner reply failed: ${replyResult.error.message}`);
      return;
    }

    setOwnerReplyText("");
    setActionMessage("Owner reply sent to client portal.");
    await loadOwnerData();
  }
  async function loadOwnerData() {
    setIsLoading(true);
    setErrorMessage("");
    setActionMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      setErrorMessage("Supabase is not configured yet. Check .env.local.");
      return;
    }

    try {
      const approvalResult = await supabase
        .from("owner_approval_requests")
        .select(
          "id, client_id, project_id, request_type, title, summary, recommended_action, risk_level, status, owner_response, created_at"
        )
        .order("created_at", { ascending: false });

      if (approvalResult.error) {
        setErrorMessage(`Approval load failed: ${approvalResult.error.message}`);
      } else {
        setApprovals((approvalResult.data || []) as ApprovalRow[]);
      }

      const clientResult = await supabase
        .from("clients")
        .select(
          "id, business_name, contact_name, contact_email, business_type, status, monthly_price"
        )
        .order("created_at", { ascending: false });

      if (clientResult.error) {
        setErrorMessage(`Client load failed: ${clientResult.error.message}`);
      } else {
        setClients((clientResult.data || []) as ClientRow[]);
      }      const projectResult = await supabase
        .from("projects")
        .select("id, client_id, website_status")
        .order("created_at", { ascending: false });

      if (projectResult.error) {
        setErrorMessage(`Project load failed: ${projectResult.error.message}`);
      } else {
        setProjects((projectResult.data || []) as ProjectRow[]);
      }


      const messageResult = await supabase
  .from("client_messages")
  .select(
    "id, client_id, sender_type, message, needs_owner_review, ai_handled, created_at"
  )
  .order("created_at", { ascending: false })
  .limit(8);

if (messageResult.error) {
  setErrorMessage(`Client messages load failed: ${messageResult.error.message}`);
} else {
  setClientMessages((messageResult.data || []) as ClientMessageRow[]);
}
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Supabase fetch error";
      setErrorMessage(`Supabase connection failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function updateApprovalStatus(
    approval: ApprovalRow,
    status: ApprovalStatus,
    ownerResponse: string
  ) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    setActionMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase
        .from("owner_approval_requests")
        .update({
          status,
          owner_response: ownerResponse,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", approval.id);

      if (error) {
        setErrorMessage(`Action failed: ${error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: approval.client_id,
        actor_type: "owner",
        action: `approval_${status}`,
        details: {
          approval_id: approval.id,
          title: approval.title,
          owner_response: ownerResponse,
        },
      });

      setActionMessage(`Saved: ${ownerResponse}`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown update error";
      setErrorMessage(`Action failed: ${message}`);
    }
  }  async function updateClientStatus(
    client: ClientRow,
    nextStatus: string,
    actionLabel: string
  ) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const confirmed = window.confirm(
      `${actionLabel}\n\nClient: ${client.business_name}\n\nThis will update the client record in Supabase. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    const updatePayload =
      nextStatus === "lead"
        ? {
            status: "lead",
            notes: null,
            business_type: "Website Client",
            service_area: "Not provided yet",
          }
        : {
            status: nextStatus,
          };

    try {
      const { error } = await supabase
        .from("clients")
        .update(updatePayload)
        .eq("id", client.id);

      if (error) {
        setErrorMessage(`Client update failed: ${error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "owner",
        action: `client_${nextStatus}`,
        details: {
          client_name: client.business_name,
          action_label: actionLabel,
        },
      });

      setActionMessage(`${client.business_name}: ${actionLabel} complete.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown client update error";
      setErrorMessage(`Client update failed: ${message}`);
    }
  }  async function createProjectForClient(client: ClientRow) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const existingProject = getProjectForClient(client.id);

    if (existingProject) {
      setErrorMessage(`${client.business_name} already has a project record.`);
      return;
    }

    const confirmed = window.confirm(
      `Create project\n\nClient: ${client.business_name}\n\nThis will create a website project record in Supabase. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          client_id: client.id,
          project_name: `${client.business_name} Website Project`,
          website_status: "planning",
        })
        .select("id")
        .single();

      if (error) {
        setErrorMessage(`Project create failed: ${error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "owner",
        action: "project_created",
        details: {
          client_name: client.business_name,
          project_id: data?.id,
          website_status: "planning",
        },
      });

      setActionMessage(`${client.business_name}: project created.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown project create error";
      setErrorMessage(`Project create failed: ${message}`);
    }
  }  async function acceptApprovalAndStartPipeline(
    approval: ApprovalRow,
    client: ClientRow | null,
    clientName: string
  ) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("Cannot start pipeline because the client record was not found.");
      return;
    }

    setActionMessage("");
    setErrorMessage("");

    try {
      const clientUpdate = await supabase
        .from("clients")
        .update({
          status: "approved",
        })
        .eq("id", client.id);

      if (clientUpdate.error) {
        setErrorMessage(`Client approval failed: ${clientUpdate.error.message}`);
        return;
      }

      const existingProject = getProjectForClient(client.id);

      if (existingProject) {
        const projectUpdate = await supabase
          .from("projects")
          .update({
            website_status: "planning",
          })
          .eq("id", existingProject.id);

        if (projectUpdate.error) {
          setErrorMessage(`Project update failed: ${projectUpdate.error.message}`);
          return;
        }
      } else {
        const projectCreate = await supabase
          .from("projects")
          .insert({
            client_id: client.id,
            project_name: `${client.business_name} Website Project`,
            website_status: "planning",
          })
          .select("id")
          .single();

        if (projectCreate.error) {
          setErrorMessage(`Project create failed: ${projectCreate.error.message}`);
          return;
        }
      }

      const approvalUpdate = await supabase
        .from("owner_approval_requests")
        .update({
          status: "accepted",
          owner_response: "Owner accepted this approval request and started the project pipeline.",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", approval.id);

      if (approvalUpdate.error) {
        setErrorMessage(`Approval update failed: ${approvalUpdate.error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "owner",
        action: "approval_accepted_pipeline_started",
        details: {
          approval_id: approval.id,
          client_name: clientName,
          client_status: "approved",
          project_status: "planning",
        },
      });

      setActionMessage(`${clientName}: approved and moved into planning.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown pipeline error";
      setErrorMessage(`Pipeline start failed: ${message}`);
    }
  }  async function activateManualSubscription(client: ClientRow) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const confirmed = window.confirm(
      `Activate subscription\n\nClient: ${client.business_name}\n\nThis is manual payment mode. It will mark the client active and move the project into building. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const clientUpdate = await supabase
        .from("clients")
        .update({
          status: "active",
        })
        .eq("id", client.id);

      if (clientUpdate.error) {
        setErrorMessage(`Client activation failed: ${clientUpdate.error.message}`);
        return;
      }

      const existingProject = getProjectForClient(client.id);

      if (existingProject) {
        const projectUpdate = await supabase
          .from("projects")
          .update({
            website_status: "building",
          })
          .eq("id", existingProject.id);

        if (projectUpdate.error) {
          setErrorMessage(`Project activation failed: ${projectUpdate.error.message}`);
          return;
        }
      } else {
        const projectCreate = await supabase
          .from("projects")
          .insert({
            client_id: client.id,
            project_name: `${client.business_name} Website Project`,
            website_status: "building",
          })
          .select("id")
          .single();

        if (projectCreate.error) {
          setErrorMessage(`Project create failed: ${projectCreate.error.message}`);
          return;
        }
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "owner",
        action: "manual_subscription_activated",
        details: {
          client_name: client.business_name,
          client_status: "active",
          project_status: "building",
          payment_mode: "manual",
          note: "Manual activation used while payment provider is not connected.",
        },
      });

      setActionMessage(`${client.business_name}: subscription activated manually.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown manual activation error";
      setErrorMessage(`Manual activation failed: ${message}`);
    }
  }







  async function updateProjectStage(
    client: ClientRow,
    nextStage: string,
    actionLabel: string
  ) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const project = getProjectForClient(client.id);

    if (!project) {
      setErrorMessage(`${client.business_name} does not have a project record yet.`);
      return;
    }

    const confirmed = window.confirm(
      `${actionLabel}\n\nClient: ${client.business_name}\nProject stage: ${nextStage}\n\nThis will update the project record in Supabase. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase
        .from("projects")
        .update({
          website_status: nextStage,
        })
        .eq("id", project.id);

      if (error) {
        setErrorMessage(`Project stage update failed: ${error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "owner",
        action: `project_${nextStage}`,
        details: {
          client_name: client.business_name,
          project_id: project.id,
          action_label: actionLabel,
          website_status: nextStage,
        },
      });

      setActionMessage(`${client.business_name}: ${actionLabel} complete.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown project update error";
      setErrorMessage(`Project stage update failed: ${message}`);
    }
  }

  useEffect(() => {
    loadOwnerData();
  }, []);

  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const completedApprovals = approvals.filter((approval) => approval.status !== "pending");

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner APS</p>
            <h1>NXQ command chat</h1>
            <p className="subtle">
              Live Supabase owner portal: AI approvals, client messages, and client overview.
            </p>
          </div>

          <div className="stat-card">
            <span>Monthly income</span>
            <strong>{formatMoney(monthlyIncome)}/mo</strong>
          </div>
        </div>

        {errorMessage ? <div className="notice-card error">{errorMessage}</div> : null}
        {actionMessage ? <div className="notice-card success">{actionMessage}</div> : null}

        <div className="owner-grid">
          <section className="panel panel-large">
            <div className="panel-title panel-title-row">
              <div className="panel-title">
                <Bot size={20} />
                <h2>AI approval chat</h2>
              </div>

              <button className="icon-btn" onClick={loadOwnerData} type="button">
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>

            <div className="chat-feed">
              <div className="ai-bubble">
                <strong>NXQ AI</strong>
                <p>
                  {isLoading
                    ? "Loading approval queue from Supabase..."
                    : `Approval queue loaded. ${pendingApprovals.length} pending item(s) need owner review.`}
                </p>
              </div>

              {!isLoading && pendingApprovals.length === 0 ? (
                <div className="empty-state">
                  No pending approvals right now. The AI agency manager is standing by.
                </div>
              ) : null}

              {pendingApprovals.map((approval) => {
                const client = getClientForApproval(approval);
                const clientName = client?.business_name || "Unknown client";

                return (
                  <div className="approval-card" key={approval.id}>
                    <div className="approval-top">
                      <span>{approval.title}</span>
                      <small>Risk: {approval.risk_level}</small>
                    </div>

                    <h3>{clientName}</h3>
                    <p>{approval.summary}</p>

                    {approval.recommended_action && isWebsiteSetupReport(approval) ? (
                      <div className="setup-report-viewer">
                        <div className="setup-report-header">
                          <strong>Website setup report</strong>
                          <span>Client submitted intake + agreement</span>
                        </div>

                        <div className="setup-report-grid">
                          {parseSetupReport(approval.recommended_action).map((field) => (
                            <div className="setup-report-field" key={`${approval.id}-${field.label}`}>
                              <span>{field.label}</span>
                              <p>{field.value || "Not provided"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : approval.recommended_action ? (
                      <p className="recommendation">
                        Recommended: {approval.recommended_action}
                      </p>
                    ) : null}

                    <div className="approval-actions">
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirmHighRiskAction("accept", clientName)) return;

                          acceptApprovalAndStartPipeline(approval, client, clientName);
                        }}
                      >
                        Accept
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!confirmHighRiskAction("deny", clientName)) return;

                          updateApprovalStatus(
                            approval,
                            "denied",
                            "Owner denied this approval request."
                          );
                        }}
                      >
                        Deny
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateApprovalStatus(
                            approval,
                            "revision_requested",
                            "Owner requested edits/revision."
                          )
                        }
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateApprovalStatus(
                            approval,
                            "more_info_requested",
                            "Owner asked AI/client for more information."
                          )
                        }
                      >
                        Ask More
                      </button>
                    </div>
                  </div>
                );
              })}

              {completedApprovals.length > 0 ? (
                <div className="completed-section">
                  <h3>Completed approvals</h3>

                  {completedApprovals.slice(0, 4).map((approval) => {
                    const client = getClientForApproval(approval);

                    return (
                      <div className="completed-row" key={approval.id}>
                        <span>{client?.business_name || "Unknown client"}</span>
                        <strong>{formatStatus(approval.status)}</strong>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </section>

          <aside className="panel">
            <div className="panel-title">
              <Users size={20} />
              <h2>Clients</h2>
            </div>

            <div className="client-list">
              {clients.length === 0 && !isLoading ? (
                <p className="subtle">No clients found yet.</p>
              ) : null}

              {clients.map((client) => (
                <article className="mini-client-card" key={client.id}>
                  <strong>{client.business_name}</strong>
                  <span>{client.business_type || "Business type missing"}</span>
                  <small>{formatStatus(client.status)}</small>
                  <b>{formatMoney(Number(client.monthly_price || 0))}/mo</b>

                  <div className="client-control-row">
                    <button
                      type="button"
                      onClick={() => updateClientStatus(client, "lead", "Reset setup")}
                    >
                      Reset
                    </button>

                    <button
                      type="button"
                      onClick={() => updateClientStatus(client, "approved", "Approve client")}
                    >
                      Approve
                    </button>

                    <button
                      type="button"
                      onClick={() => updateClientStatus(client, "needs_review", "Mark needs info")}
                    >
                      Needs Info
                    </button>

                    <button
                      type="button"
                      onClick={() => updateClientStatus(client, "archived", "Archive client")}
                    >
                      Archive
                    </button>
                  </div>

                  <div className="project-stage-box">
                    <span>
                      Project: {getProjectForClient(client.id)?.website_status
                        ? formatStatus(getProjectForClient(client.id)?.website_status || "")
                        : "No project yet"}
                    </span>

                    {!getProjectForClient(client.id) ? (
                      <button
                        className="create-project-btn"
                        type="button"
                        onClick={() => createProjectForClient(client)}
                      >
                        Create Project
                      </button>
                    ) : null}

                    <div className="project-stage-row">
                      <button
                        type="button"
                        onClick={() => updateProjectStage(client, "planning", "Move to planning")}
                      >
                        Planning
                      </button>

                      <button
                        type="button"
                        onClick={() => updateProjectStage(client, "building", "Move to building")}
                      >
                        Building
                      </button>

                      <button
                        type="button"
                        onClick={() => updateProjectStage(client, "live", "Move to live")}
                      >
                        Live
                      </button>

                      <button
                        type="button"
                        onClick={() => updateProjectStage(client, "frozen", "Freeze project")}
                      >
                        Frozen
                      </button>
                    </div>

                    {client.status === "active" ? (
                      <button
                        className="manual-activate-btn is-active"
                        type="button"
                        disabled
                      >
                        Subscription Active
                      </button>
                    ) : (
                      <button
                        className="manual-activate-btn"
                        type="button"
                        onClick={() => activateManualSubscription(client)}
                      >
                        Activate Subscription
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </aside>

          <aside className="panel">
  <div className="panel-title panel-title-row">
    <div className="panel-title">
      <MessageSquareText size={20} />
      <h2>Client messages</h2>
    </div>

    <button className="icon-btn" onClick={loadOwnerData} type="button">
      <RefreshCcw size={16} />
    </button>
  </div>

            <div className="message-filter-row">
              <select
                className="message-filter-select"
                value={selectedMessageClientId}
                onChange={(event) => setSelectedMessageClientId(event.target.value)}
              >
                <option value="all">All clients</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.business_name}
                  </option>
                ))}
              </select>
            </div>
  <div className="owner-message-list">
    {filteredClientMessages.length === 0 && !isLoading ? (
      <div className="empty-state">No client messages yet.</div>
    ) : null}

    {filteredClientMessages.map((message) => {
      const client = getClientForMessage(message);

      return (
        <article className="owner-message-card" key={message.id}>
          <div className="owner-message-top">
            <strong>{client?.business_name || "Unknown client"}</strong>
            <span>{formatDateTime(message.created_at)}</span>
          </div>

          <p>{message.message}</p>

          <small>
            {message.needs_owner_review
              ? "Needs owner review"
              : message.ai_handled
                ? "AI handled"
                : "No review needed"}
          </small>
        </article>
      );
    })}
  </div>

            <div className="owner-reply-box">
              <label htmlFor="owner-reply">Reply to selected client</label>

              <textarea
                id="owner-reply"
                value={ownerReplyText}
                onChange={(event) => setOwnerReplyText(event.target.value)}
                placeholder="Type your reply to the selected client..."
              />

              <button
                className="wide-btn"
                onClick={sendOwnerReply}
                type="button"
                disabled={!selectedReplyClientId}
              >
                Send reply
              </button>

              <small>
                Replies are saved to the Client Portal as owner messages.
              </small>
            </div>
  <div className="history-item">
    <Clock size={16} />
    <p>Newest client messages appear here from the Client Portal.</p>
  </div>

  <div className="history-item">
    <CheckCircle2 size={16} />
    <p>Accept and Deny require confirmation before saving.</p>
  </div>
</aside>
        </div>
      </section>
    </main>
  );
}







































