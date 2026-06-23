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

                          updateApprovalStatus(
                            approval,
                            "accepted",
                            "Owner accepted this approval request."
                          );
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













