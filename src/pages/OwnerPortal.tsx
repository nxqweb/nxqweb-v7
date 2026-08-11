import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  MessageSquareText,
  RefreshCcw,
  ShoppingBag,
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
  billing_status: string;
  billing_provider: string | null;
  billing_overdue_since: string | null;
  billing_frozen_at: string | null;
  notes: string | null;
  qa_only: boolean;
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
    options: {
    preview_id?: string;
    preview_url?: string;
    checklist?: string[];
    launch_block_rule?: string;
  } | null;
  created_at: string;
};
type ClientMessageRow = {
  id: string;
  client_id: string | null;
  sender_type: "owner" | "client" | "ai" | "system";
  message: string;
  needs_owner_review: boolean;
  ai_handled: boolean;
  owner_seen_at: string | null;
  created_at: string;
};

type ProjectRow = {
  id: string;
  client_id: string | null;
  website_status: string;
  build_plan: Record<string, unknown> | null;
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

function formatClientOnboardingStatus(status: string) {
  if (status === "lead") return "Waiting for client intake";
  if (["intake_received", "needs_owner_review"].includes(status)) return "Ready for owner review";
  return formatStatus(status);
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

function isDomainConnectionReview(approval: ApprovalRow) {
  return approval.request_type === "domain_connection_review";
}

function isLaunchPreviewReview(approval: ApprovalRow) {
  return approval.request_type === "launch_preview_review";
}

function getLaunchPreviewUrl(approval: ApprovalRow) {
  return approval.options?.preview_url || "";
}

function getLaunchPreviewChecklist(approval: ApprovalRow) {
  return Array.isArray(approval.options?.checklist) ? approval.options.checklist : [];
}

function isPipelineStartApproval(approval: ApprovalRow) {
  return isWebsiteSetupReport(approval);
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
      const shouldPreserveLineBreak =
        line.startsWith("- ") ||
        lastField.label === "Selected package capabilities" ||
        lastField.label === "Package AI/service rules";

      if (!lastField.value) {
        lastField.value = line;
      } else if (shouldPreserveLineBreak) {
        lastField.value = `${lastField.value}\n${line}`;
      } else {
        lastField.value = `${lastField.value} ${line}`;
      }
    }
  }

  return fields;
}

function findSetupField(fields: { label: string; value: string }[], label: string) {
  const normalizedLabel = label.toLowerCase();

  return fields.find((field) => field.label.toLowerCase() === normalizedLabel);
}

function groupSetupReportFields(fields: { label: string; value: string }[]) {
  const groups = [
    {
      title: "Business",
      labels: [
        "Client",
        "Selected package",
        "Company scale",
        "Location setup",
        "Locations",
        "Business phone",
        "Business email",
        "Business address",
        "Business hours",
        "Emergency / after-hours availability",
        "Industry",
      ],
    },    {
      title: "Package Scope",
      labels: [
        "Package badge",
        "Selected package capabilities",
        "Package AI/service rules",
      ],
    },

    {
      title: "Website",
      labels: [
        "Services / products",
        "Pages / sections needed",
        "Style direction",
        "Brand difference / positioning",
        "Competitors / examples",
      ],
    },
    {
      title: "Lead Rules",
      labels: [
        "Lead handling rules",
        "Preferred contact method",
        "Urgent lead rules",
        "Jobs / customers to reject",
        "Areas not served",
      ],
    },
    {
      title: "Assistant Rules",
      labels: [
        "Website assistant rules",
        "Assistant can answer",
        "Assistant should never promise",
        "Escalation rules",
      ],
    },
    {
      title: "Agreement",
      labels: ["Agreement accepted", "Typed signature", "Signature date", "Payment note"],
    },
  ];

  const usedLabels = new Set<string>();

  const grouped = groups
    .map((group) => {
      const groupFields = group.labels
        .map((label) => findSetupField(fields, label))
        .filter((field): field is { label: string; value: string } => Boolean(field));

      groupFields.forEach((field) => usedLabels.add(field.label));

      return {
        title: group.title,
        fields: groupFields,
      };
    })
    .filter((group) => group.fields.length > 0);

  const otherFields = fields.filter((field) => !usedLabels.has(field.label));

  if (otherFields.length > 0) {
    grouped.push({
      title: "Other",
      fields: otherFields,
    });
  }

  return grouped;
}
export function OwnerPortal() {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clientMessages, setClientMessages] = useState<ClientMessageRow[]>([]);
  const [selectedMessageClientId, setSelectedMessageClientId] = useState("");
  const [ownerReplyText, setOwnerReplyText] = useState("");
  const [ownerView, setOwnerView] = useState<"aps" | "chat">("aps");
  const [nxqTheme, setNxqTheme] = useState<"dark" | "light">(() => {
    const savedTheme = window.localStorage.getItem("nxq-theme");
    const theme = savedTheme === "light" ? "light" : "dark";
    document.body.dataset.nxqTheme = theme;
    return theme;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  function toggleNxqTheme() {
    const nextTheme = nxqTheme === "dark" ? "light" : "dark";
    document.body.dataset.nxqTheme = nextTheme;
    window.localStorage.setItem("nxq-theme", nextTheme);
    setNxqTheme(nextTheme);
  }

  const activeMonthlyIncome = useMemo(() => {
    return clients
      .filter((client) => client.billing_status === "active")
      .reduce((total, client) => total + Number(client.monthly_price || 0), 0);
  }, [clients]);

  const pipelineMonthlyValue = useMemo(() => {
    const excludedStatuses = new Set(["archived", "denied", "dormant"]);

    return clients
      .filter((client) => !excludedStatuses.has(client.status))
      .reduce((total, client) => total + Number(client.monthly_price || 0), 0);
  }, [clients]);

  const filteredClientMessages = useMemo(() => {
    if (!selectedMessageClientId) {
      return [];
    }

    return clientMessages.filter((message) => message.client_id === selectedMessageClientId);
  }, [clientMessages, selectedMessageClientId]);

  const ownerReviewMessages = useMemo(() => {
    return clientMessages.filter(
      (message) => message.sender_type === "client" && !message.owner_seen_at
    );
  }, [clientMessages]);

  const unreadMessageCountByClient = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const message of ownerReviewMessages) {
      if (!message.client_id) {
        continue;
      }

      counts[message.client_id] = (counts[message.client_id] || 0) + 1;
    }

    return counts;
  }, [ownerReviewMessages]);

  async function openClientMessageThread(clientId: string | null) {
    if (!clientId) {
      setErrorMessage("This message is not linked to a client record.");
      return;
    }

    setSelectedMessageClientId(clientId);
    setOwnerView("chat");
    setActionMessage("Opened client chat thread.");

    if (!supabase) {
      return;
    }

    const seenResult = await supabase.rpc("mark_client_messages_seen", {
      target_client_id: clientId,
    });

    if (seenResult.error) {
      setErrorMessage(`Message seen update failed: ${seenResult.error.message}`);
      return;
    }

    const seenAt = new Date().toISOString();

    setClientMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.client_id === clientId &&
        message.sender_type === "client" &&
        !message.owner_seen_at
          ? { ...message, owner_seen_at: seenAt }
          : message
      )
    );

    await loadOwnerData();
  }
const selectedReplyClientId = useMemo(() => {
    return selectedMessageClientId || "";
  }, [selectedMessageClientId]);
  function getClientForApproval(approval: ApprovalRow) {
    return clients.find((client) => client.id === approval.client_id) || null;
  }

  function getProjectForClient(clientId: string) {
    return projects.find((project) => project.client_id === clientId) || null;
  }
  function getClientForMessage(message: ClientMessageRow) {
  return clients.find((client) => client.id === message.client_id) || null;
}

function parseBuildPlanSections(buildPlan: Record<string, unknown>) {
  return Object.entries(buildPlan).map(([key, value]) => ({
    title: formatStatus(key),
    body: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  }));
}

  function confirmHighRiskAction(action: "accept" | "deny", clientName: string) {
    const actionLabel = action === "accept" ? "APPROVE" : "DENY";

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

    const replyResult = await supabase.rpc("send_owner_portal_reply", {
      target_client_id: selectedReplyClientId,
      reply_message: trimmedMessage,
    });

    if (replyResult.error) {
      setErrorMessage(`Owner reply failed: ${replyResult.error.message}`);
      return;
    }

    const resultData = replyResult.data as { message?: string } | null;

    setOwnerReplyText("");
    setActionMessage(resultData?.message || "Owner reply sent to client portal.");
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
          "id, client_id, project_id, request_type, title, summary, recommended_action, risk_level, status, owner_response, options, created_at"
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
          "id, business_name, contact_name, contact_email, business_type, status, monthly_price, billing_status, billing_provider, billing_overdue_since, billing_frozen_at, notes, qa_only"
        )
        .order("created_at", { ascending: false });

      if (clientResult.error) {
        setErrorMessage(`Client load failed: ${clientResult.error.message}`);
      } else {
        setClients((clientResult.data || []) as ClientRow[]);
      }

      const projectResult = await supabase
        .from("projects")
        .select("id, client_id, website_status, build_plan")
        .order("created_at", { ascending: false });

      if (projectResult.error) {
        setErrorMessage(`Project load failed: ${projectResult.error.message}`);
      } else {
        setProjects((projectResult.data || []) as ProjectRow[]);
      }


      const messageResult = await supabase
  .from("client_messages")
  .select(
    "id, client_id, sender_type, message, needs_owner_review, ai_handled, owner_seen_at, created_at"
  )
  .order("created_at", { ascending: false })
  .limit(100);

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
      let decisionResult;
      if (isDomainConnectionReview(approval)) {
        decisionResult = await supabase.rpc("resolve_domain_connection_review", {
          target_approval_id: approval.id,
          decision_status: status,
          owner_response_text: ownerResponse,
        });
      } else if (isPipelineStartApproval(approval)) {
        if (status !== "denied") {
          setErrorMessage("Website setup acceptance must use the protected APPROVE workflow.");
          return;
        }
        decisionResult = await supabase.rpc("deny_website_setup", {
          approval_request_id: approval.id,
          denial_reason: ownerResponse,
        });
      } else {
        decisionResult = await supabase.rpc("resolve_owner_approval_decision", {
          target_approval_id: approval.id,
          decision_status: status,
          owner_response_text: ownerResponse,
        });
      }

      if (decisionResult.error) {
        setErrorMessage(`Action failed: ${decisionResult.error.message}`);
        return;
      }

      const resultData = decisionResult.data as { message?: string } | null;
      setActionMessage(resultData?.message || `Saved: ${ownerResponse}`);

      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown update error";
      setErrorMessage(`Action failed: ${message}`);
    }
  }

  async function requestMoreSetupInfo(
    _approval: ApprovalRow,
    client: ClientRow | null,
    clientName: string
  ) {
    if (!client) {
      setErrorMessage("Cannot request more setup info because the client record was not found.");
      return;
    }

    setActionMessage(`Opening targeted Needs Info flow for ${clientName}.`);
    await requestMoreInfoFromClientCard(client);
  }

  async function acceptApprovalAndStartPipeline(
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
      const pipelineResult = await supabase.rpc("approve_website_setup", {
        approval_request_id: approval.id,
      });

      if (pipelineResult.error) {
        setErrorMessage(`Supabase pipeline failed: ${pipelineResult.error.message}`);
        return;
      }

      const resultData = pipelineResult.data as {
        message?: string;
        project_id?: string;
        ai_task_output_id?: string;
      } | null;

      setActionMessage(
        resultData?.message ||
          `${clientName}: approved, moved into planning, and build plan created.`
      );

      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown pipeline error";
      setErrorMessage(`Pipeline start failed: ${message}`);
    }
  }

  async function requestMoreInfoFromClientCard(client: ClientRow) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const fieldChoice = window.prompt(
      [
        `What field needs more info from ${client.business_name}?`,
        "",
        "1 = Preferred contact method",
        "2 = Emergency / after-hours availability",
        "3 = Business hours",
        "4 = Locations or service areas",
        "5 = Services / products",
        "6 = Pages / sections needed",
        "7 = Website style direction",
        "8 = Website assistant rules",
        "9 = Other",
      ].join("\n"),
      "1"
    );

    if (fieldChoice === null) return;

    const normalizedChoice = fieldChoice.trim().toLowerCase();

    const fieldMap: Record<string, { key: string; label: string; defaultQuestion: string }> = {
      "1": {
        key: "preferred_contact_method",
        label: "Preferred contact method",
        defaultQuestion: "Please confirm the best customer contact method for quote requests and urgent jobs.",
      },
      "preferred contact method": {
        key: "preferred_contact_method",
        label: "Preferred contact method",
        defaultQuestion: "Please confirm the best customer contact method for quote requests and urgent jobs.",
      },
      "2": {
        key: "emergency_availability",
        label: "Emergency / after-hours availability",
        defaultQuestion: "Please confirm emergency service availability and after-hours rules.",
      },
      "emergency": {
        key: "emergency_availability",
        label: "Emergency / after-hours availability",
        defaultQuestion: "Please confirm emergency service availability and after-hours rules.",
      },
      "3": {
        key: "business_hours",
        label: "Business hours",
        defaultQuestion: "Please confirm normal business hours.",
      },
      "business hours": {
        key: "business_hours",
        label: "Business hours",
        defaultQuestion: "Please confirm normal business hours.",
      },
      "4": {
        key: "locations",
        label: "Locations or service areas",
        defaultQuestion: "Please confirm the exact locations or service areas this website should target.",
      },
      "service areas": {
        key: "locations",
        label: "Locations or service areas",
        defaultQuestion: "Please confirm the exact locations or service areas this website should target.",
      },
      "5": {
        key: "services",
        label: "Services / products",
        defaultQuestion: "Please confirm the services or products the website should explain.",
      },
      "services": {
        key: "services",
        label: "Services / products",
        defaultQuestion: "Please confirm the services or products the website should explain.",
      },
      "6": {
        key: "pages_needed",
        label: "Pages / sections needed",
        defaultQuestion: "Please confirm the pages or sections the website needs.",
      },
      "pages": {
        key: "pages_needed",
        label: "Pages / sections needed",
        defaultQuestion: "Please confirm the pages or sections the website needs.",
      },
      "7": {
        key: "style_direction",
        label: "Website style direction",
        defaultQuestion: "Please confirm the website style direction.",
      },
      "style": {
        key: "style_direction",
        label: "Website style direction",
        defaultQuestion: "Please confirm the website style direction.",
      },
      "8": {
        key: "assistant_rules",
        label: "Website assistant rules",
        defaultQuestion: "Please confirm what the future website assistant can answer, should never promise, or should escalate.",
      },
      "assistant": {
        key: "assistant_rules",
        label: "Website assistant rules",
        defaultQuestion: "Please confirm what the future website assistant can answer, should never promise, or should escalate.",
      },
      "9": {
        key: "other",
        label: "Other requested information",
        defaultQuestion: "Please provide the requested missing information.",
      },
      "other": {
        key: "other",
        label: "Other requested information",
        defaultQuestion: "Please provide the requested missing information.",
      },
    };

    const selectedField = fieldMap[normalizedChoice] || fieldMap["9"];

    const requestedInfo = window.prompt(
      `What should the client answer for ${selectedField.label}?`,
      selectedField.defaultQuestion
    );

    if (requestedInfo === null) return;

    const cleanRequestedInfo = requestedInfo.trim();

    if (!cleanRequestedInfo) {
      setErrorMessage("Needs Info requires a short reason so the client knows what to update.");
      return;
    }

    const confirmed = window.confirm(
      `Request targeted setup info\n\nClient: ${client.business_name}\n\nField: ${selectedField.label}\n\nRequested info:\n${cleanRequestedInfo}\n\nSupabase will reopen the requested field for the client. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const moreInfoResult = await supabase.rpc("request_targeted_more_info", {
        target_client_id: client.id,
        requested_field_key: selectedField.key,
        requested_field_label: selectedField.label,
        requested_info: cleanRequestedInfo,
      });

      if (moreInfoResult.error) {
        setErrorMessage(`Targeted more info request failed: ${moreInfoResult.error.message}`);
        return;
      }

      const resultData = moreInfoResult.data as { message?: string } | null;

      setActionMessage(
        resultData?.message ||
          `${client.business_name}: targeted more info requested for ${selectedField.label}.`
      );

      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown more info error";
      setErrorMessage(`Targeted more info request failed: ${message}`);
    }
  }
  useEffect(() => {
    loadOwnerData();
  }, []);

  const normalApprovalTypes = new Set(["website_setup_review", "commerce_intake_review"]);
  const pendingApprovals = approvals.filter(
    (approval) => approval.status === "pending" && normalApprovalTypes.has(approval.request_type)
  );
  const pendingExceptionApprovals = approvals.filter(
    (approval) => approval.status === "pending" && !normalApprovalTypes.has(approval.request_type)
  );
  const pendingIntakeClients = clients.filter((client) => client.status === "lead");
  const completedApprovals = approvals.filter((approval) => approval.status !== "pending");

  const recentCompletedApprovals = completedApprovals.slice(0, 4);

  const latestProjectBuildPlans = projects.filter(
    (project) => project.build_plan && Object.keys(project.build_plan).length > 0
  );

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner Portal</p>
            <h1>{ownerView === "aps" ? "NXQ approvals" : "NXQ client chat"}</h1>
            <p className="subtle">
              {ownerView === "aps" ? "One decision starts the normal autonomous workflow." : "Pick one client and text them directly."}
            </p>
          </div>

          <div className="stat-card">
            <span>☰ Owner menu</span>
            <button
              className="wide-btn"
              type="button"
              onClick={() => setOwnerView("aps")}
            >
              AI approvals
            </button>
            <button
              className="wide-btn"
              type="button"
              onClick={() => setOwnerView("chat")}
            >
              Client chat {ownerReviewMessages.length > 0 ? `(${ownerReviewMessages.length})` : ""}
            </button>
            <button className="wide-btn nxq-theme-toggle" onClick={toggleNxqTheme} type="button">
              {nxqTheme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <div className="owner-revenue-stack">
              <small>Active MRR: {formatMoney(activeMonthlyIncome)}/mo</small>
              <small>Pipeline value: {formatMoney(pipelineMonthlyValue)}/mo</small>
            </div>
          </div>
        </div>

        {errorMessage ? <div className="notice-card error">{errorMessage}</div> : null}
        {actionMessage ? <div className="notice-card success">{actionMessage}</div> : null}

        <div className="owner-grid">
          <section className="panel panel-large owner-approval-panel" style={{ display: ownerView === "aps" ? undefined : "none" }}>
            <div className="panel-title panel-title-row">
              <div className="panel-title">
                <Bot size={20} />
                <h2>Client approvals</h2>
              </div>

              <button className="icon-btn" onClick={loadOwnerData} type="button">
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>

            <div className="owner-message-ping-panel">


              <div className="owner-message-ping-header">


                <strong>Client message pings</strong>


                <span>{ownerReviewMessages.length} new</span>


              </div>



              {ownerReviewMessages.length === 0 ? (


                <p className="subtle">No client messages need owner review right now.</p>


              ) : (


                <div className="owner-message-ping-list">


                  {ownerReviewMessages.slice(0, 6).map((message) => {


                    const client = getClientForMessage(message);



                    return (


                      <button


                        className="owner-message-ping"


                        key={message.id}


                        type="button"


                        onClick={() => openClientMessageThread(message.client_id)}


                      >


                        <span>


                          <strong>{client?.business_name || "Unknown client"}</strong>


                          <small>{formatDateTime(message.created_at)}</small>


                        </span>


                        <p>{message.message}</p>


                      </button>


                    );


                  })}


                </div>


              )}


            </div>



            <div className="chat-feed">


              <div className="ai-bubble">
                <strong>NXQ AI</strong>
                <p>
                  {isLoading
                    ? "Loading approval queue from Supabase..."
                    : `${pendingApprovals.length} ready for your decision · ${pendingIntakeClients.length} waiting for client intake.`}
                </p>
              </div>

              {!isLoading && pendingApprovals.length === 0 ? (
                <div className="empty-state">
                  No completed intake is waiting for approval right now.
                </div>
              ) : null}

              {!isLoading && pendingIntakeClients.length > 0 ? (
                <div className="completed-section owner-intake-waiting-list">
                  <h3>Waiting for client intake</h3>
                  <p className="subtle">
                    These accounts are created, but APPROVE appears only after the client submits their setup details and agreement.
                  </p>
                  {pendingIntakeClients.map((client) => (
                    <div className="completed-row" key={`intake-${client.id}`}>
                      <span>{client.business_name}</span>
                      <strong>{formatMoney(Number(client.monthly_price || 0))}/mo</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              {pendingApprovals.map((approval) => {
                const client = getClientForApproval(approval);
                const clientName = client?.business_name || "Unknown client";
                const isSetupReportApproval = isWebsiteSetupReport(approval);
                const isSetupResubmission =
                  approval.title.toLowerCase().includes("resubmitted") ||
                  approval.summary.toLowerCase().includes("resubmitted");
                const setupReportGroups =
                  approval.recommended_action && isSetupReportApproval
                    ? groupSetupReportFields(parseSetupReport(approval.recommended_action))
                    : [];

                return (
                  <div className="approval-card" key={approval.id}>
                    <div className="approval-top">
                      <span>{approval.title}{isSetupResubmission ? " • Resubmission" : ""}</span>
                      <small>Risk: {approval.risk_level}</small>
                    </div>

                    <h3>{clientName}</h3>
                    {isSetupResubmission ? (
                      <p className="recommendation">
                        Resubmission: This is an updated setup sheet after NXQ requested more information.
                      </p>
                    ) : null}
                    <p>{approval.summary}</p>

                    {isLaunchPreviewReview(approval) ? (
                      <div className="setup-report-viewer launch-preview-review">
                        <div className="setup-report-header">
                          <strong>Website launch preview</strong>
                          <span>Owner review required before live launch</span>
                        </div>

                        <p className="recommendation">
                          {approval.options?.launch_block_rule ||
                            "Website cannot move live until this preview is approved by owner."}
                        </p>

                        {getLaunchPreviewUrl(approval) ? (
                          <a
                            className="launch-preview-link"
                            href={getLaunchPreviewUrl(approval)}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open website preview
                          </a>
                        ) : (
                          <p className="recommendation">No preview URL was attached.</p>
                        )}

                        <div className="launch-preview-checklist">
                          {getLaunchPreviewChecklist(approval).map((item) => (
                            <span key={`${approval.id}-${item}`}>✓ {item}</span>
                          ))}
                        </div>
                      </div>
                    ) : approval.recommended_action && isWebsiteSetupReport(approval) ? (
                      <div className="setup-report-viewer">
                        <div className="setup-report-header">
                          <strong>Website setup report</strong>
                          <span>{isSetupResubmission ? "Client resubmitted intake + agreement" : "Client submitted intake + agreement"}</span>
                        </div>

                        <div className="setup-report-sections">
                          {setupReportGroups.map((group) => (
                            <section className="setup-report-section" key={`${approval.id}-${group.title}`}>
                              <div className="setup-report-section-title">
                                <span>{group.title}</span>
                                <small>{group.fields.length} item(s)</small>
                              </div>

                              <div className="setup-report-grid">
                                {group.fields.map((field) => (
                                  <div className="setup-report-field" key={`${approval.id}-${group.title}-${field.label}`}>
                                    <span>{field.label}</span>
                                    <p>{field.value || "Not provided"}</p>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      </div>
                    ) : approval.recommended_action ? (
                      <p className="recommendation">
                        Recommended: {approval.recommended_action}
                      </p>
                    ) : null}

                    {approval.request_type === "client_plan_change" ? (

                      <div className="plan-change-review-only">

                        <p className="recommendation">

                          Plan changes require pricing, fee, and scope review through the dedicated guarded workflow.

                        </p>

                        <a className="wide-btn" href="/owner/plan-changes">

                          Review plan change

                        </a>

                      </div>

                    ) : null}


                    <div

                      className={`approval-actions ${

                        approval.request_type === "client_plan_change" ||
                        isLaunchPreviewReview(approval)

                          ? "plan-change-generic-actions-hidden"

                          : ""

                      }`}

                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirmHighRiskAction("accept", clientName)) return;

                          if (isPipelineStartApproval(approval)) {
                            acceptApprovalAndStartPipeline(approval, client, clientName);
                            return;
                          }

                          updateApprovalStatus(
                            approval,
                            "accepted",
                            "Owner accepted this approval request."
                          );
                        }}
                      >
                        APPROVE
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const enteredReason = window.prompt(
                            `Why are you denying ${clientName}?`,
                            "The project was not accepted. Please contact NXQ Web support if you believe this decision was made in error."
                          );

                          if (enteredReason === null) return;

                          const denialReason = enteredReason.trim();

                          if (!denialReason) {
                            setErrorMessage("A denial reason is required.");
                            return;
                          }

                          if (!confirmHighRiskAction("deny", clientName)) return;

                          updateApprovalStatus(
                            approval,
                            "denied",
                            denialReason
                          );
                        }}
                      >
                        DENY
                      </button>

                      {isPipelineStartApproval(approval) ? (
                        <button
                          type="button"
                          onClick={() => requestMoreSetupInfo(approval, client, clientName)}
                        >
                          Ask More
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}


              {recentCompletedApprovals.length > 0 ? (
                <div className="completed-section">
                  <h3>Completed approvals</h3>

                  {recentCompletedApprovals.map((approval) => {
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

                    <section
            className="panel owner-tools-panel"
            style={{ display: ownerView === "aps" ? undefined : "none" }}
          >
            <div className="panel-title">
              <h2>Owner tools</h2>
            </div>

            <div className="client-control-row">
              <a className="icon-btn" href="/owner/commerce">
                <ShoppingBag size={16} /> Commerce
              </a>

              <a className="icon-btn" href="/owner/files">
                Client files
              </a>
            </div>

            <details className="owner-system-tools">
              <summary>
                System and exception tools{pendingExceptionApprovals.length ? ` (${pendingExceptionApprovals.length})` : ""}
              </summary>
              <p className="subtle">
                These are for setup, outages, billing exceptions, and launch diagnostics—not the normal client workflow.
              </p>
              <div className="client-control-row">
                <a className="icon-btn" href="/owner/automation-health">Automation health</a>
                <a className="icon-btn" href="/owner/providers">Provider health</a>
                <a className="icon-btn" href="/owner/exceptions">Exceptions</a>
                <a className="icon-btn" href="/owner/billing">Billing exceptions</a>
                <a className="icon-btn" href="/owner/launch-readiness">Launch readiness</a>
                <a className="icon-btn" href="/owner/product-families">Product families</a>
                <a className="icon-btn" href="/owner/plan-changes">Plan changes</a>
                <a className="icon-btn" href="/owner/sales">Sales pipeline</a>
              </div>
            </details>
          </section>

          <section className="panel build-plan-panel" style={{ display: ownerView === "aps" ? undefined : "none" }}>
            <div className="panel-title panel-title-row">
              <div className="panel-title">
                <Bot size={20} />
                <h2>Project build plans</h2>
              </div>

              <button className="icon-btn" onClick={loadOwnerData} type="button">
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>

            <div className="build-plan-feed">
              {latestProjectBuildPlans.length === 0 ? (
                <div className="empty-state">
                  No project build plans yet. Accept a website setup approval to generate one.
                </div>
              ) : null}

              {latestProjectBuildPlans.map((project) => {
                const client = project.client_id
                  ? clients.find((clientItem) => clientItem.id === project.client_id) || null
                  : null;
                const enrichment = project.build_plan?.ai_enrichment as
                  | Record<string, unknown>
                  | undefined;
                const planStatus = typeof enrichment?.status === "string"
                  ? enrichment.status
                  : "saved";

                return (
                  <article className="build-plan-card" key={project.id}>
                    <div className="approval-top">
                      <span>{client?.business_name || "Business"} build plan</span>
                      <small>Canonical plan: {formatStatus(planStatus)}</small>
                    </div>

                    <div className="project-stage-box">
                      <span>
                        Current client: {client?.status ? formatStatus(client.status) : "Unknown"}
                      </span>
                      <span>
                        Current project: {project?.website_status ? formatStatus(project.website_status) : "No project yet"}
                      </span>
                    </div>

                    <div className="build-plan-sections">
                      {parseBuildPlanSections(project.build_plan || {}).map((section) => (
                        <section className="build-plan-section" key={`${project.id}-${section.title}`}>
                          <div className="build-plan-section-title">
                            <span>{section.title}</span>
                          </div>
                          <pre>{section.body}</pre>
                        </section>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="panel owner-clients-panel" style={{ display: ownerView === "aps" ? undefined : "none" }}>
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
                  <span>{client.business_type || (client.status === "lead" ? "Setup not submitted yet" : "Business details pending")}</span>
                  <small>{formatClientOnboardingStatus(client.status)}</small>
                  <b>{client.qa_only ? "Disposable QA · billing locked" : `${formatMoney(Number(client.monthly_price || 0))}/mo`}</b>

                  <div className="project-stage-box">
                    <span>
                      Project: {getProjectForClient(client.id)?.website_status
                        ? formatStatus(getProjectForClient(client.id)?.website_status || "")
                        : "No project yet"}
                    </span>
                    <small>
                      {client.qa_only
                        ? "Manual client, project, and billing controls are disabled for disposable QA."
                        : client.status === "lead"
                        ? "The client must finish intake before an approval decision is created."
                        : "APPROVE or DENY owns the client lifecycle; automation owns project stages."}
                    </small>
                  </div>

                  <div className="project-stage-box">
                    <span>Billing: {formatStatus(client.billing_status || "not_configured")}</span>
                    <small>Billing exceptions are handled from System and exception tools.</small>
                  </div>
                </article>
              ))}
            </div>
          </aside>

          <section className="panel panel-large owner-chat-panel-hidden" style={{ display: ownerView === "chat" ? undefined : "none", gridColumn: "1 / -1" }}>
  <div className="panel-title panel-title-row">
    <div className="panel-title">
      <MessageSquareText size={20} />
      <h2>Client chat</h2>
    </div>

    <button aria-label="Refresh client chat" className="icon-btn" onClick={loadOwnerData} type="button">
      <RefreshCcw size={16} />
    </button>
  </div>

            <div className="message-filter-row">
              <select
                className="message-filter-select"
                value={selectedMessageClientId}
                onChange={(event) => void openClientMessageThread(event.target.value || null)}
              >
                <option value="">Pick a client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.business_name}
                    {unreadMessageCountByClient[client.id]
                      ? ` (${unreadMessageCountByClient[client.id]})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
  <div className="owner-message-list">
    {filteredClientMessages.length === 0 && !isLoading ? (
      <div className="empty-state">Pick a client to open their private message thread.</div>
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
              <label htmlFor="owner-reply">Direct reply to selected client</label>

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
</section>

        </div>
      </section>
    </main>
  );
}
































































































































