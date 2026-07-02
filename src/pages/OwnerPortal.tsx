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
  notes: string | null;
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
type AiTaskOutputRow = {
  id: string;
  task_id: string | null;
  client_id: string | null;
  project_id: string | null;
  output_type: string;
  title: string;
  content: string;
  status: string;
  needs_owner_review: boolean;
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

type PaymentRecordRow = {
  id: string;
  client_id: string | null;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  note: string | null;
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

function isAiTaskApproval(approval: ApprovalRow) {
  return approval.request_type === "ai_task_approval";
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
function getDomainFromApproval(approval: ApprovalRow) {
  const text = [approval.summary, approval.recommended_action || ""].join("\n");
  const domainMatch = text.match(/Domain:\s*([a-z0-9.-]+\.[a-z]{2,})/i);

  if (domainMatch?.[1]) {
    return domainMatch[1].trim().toLowerCase();
  }

  const fallbackMatch = text.match(/\b([a-z0-9-]+\.[a-z]{2,})\b/i);
  return fallbackMatch?.[1]?.trim().toLowerCase() || "";
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
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecordRow[]>([]);
  const [clientMessages, setClientMessages] = useState<ClientMessageRow[]>([]);
  const [aiTaskOutputs, setAiTaskOutputs] = useState<AiTaskOutputRow[]>([]);
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
      .filter((client) => client.status === "active")
      .reduce((total, client) => total + Number(client.monthly_price || 0), 0);
  }, [clients]);

  const pipelineMonthlyValue = useMemo(() => {
    return clients.reduce((total, client) => total + Number(client.monthly_price || 0), 0);
  }, [clients]);

  const filteredClientMessages = useMemo(() => {
    if (!selectedMessageClientId) {
      return [];
    }

    return clientMessages.filter((message) => message.client_id === selectedMessageClientId);
  }, [clientMessages, selectedMessageClientId]);

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

  function getClientForPayment(payment: PaymentRecordRow) {
    return clients.find((client) => client.id === payment.client_id) || null;
  }


function parseBuildPlanSections(content: string) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sections: { title: string; body: string }[] = [];
  let currentTitle = "Client summary";
  let currentBody: string[] = [];

  function pushSection() {
    const body = currentBody.join("\n").trim();

    if (!body && sections.length > 0) return;

    sections.push({
      title: currentTitle,
      body: body || "No details provided yet.",
    });
  }

  for (const line of lines) {
    if (line === "NXQ PROJECT BUILD PLAN") continue;

    const isHeading = line.endsWith(":") && line.length <= 72;

    if (isHeading) {
      pushSection();
      currentTitle = line.replace(/:$/, "");
      currentBody = [];
      continue;
    }

    currentBody.push(line);
  }

  pushSection();

  return sections.length > 0
    ? sections
    : [{ title: "Build plan", body: content || "No build plan content yet." }];
}

  function confirmHighRiskAction(action: "accept" | "deny", clientName: string) {
    const actionLabel = action === "accept" ? "ACCEPT" : "DENY";

    return window.confirm(
      `Confirm ${actionLabel}\n\nClient: ${clientName}\n\nThis will update the approval request in Supabase. Continue?`
    );
  }

  function useLatestAiDraft() {
    if (!selectedReplyClientId) {
      setErrorMessage("Pick a client before loading an AI draft.");
      return;
    }

    const draft = aiTaskOutputs.find(
      (output) =>
        output.client_id === selectedReplyClientId &&
        output.output_type === "client_reply_draft" &&
        output.status === "draft_ready"
    );

    if (!draft) {
      setErrorMessage("No ready AI draft found for this selected client yet.");
      return;
    }

    setErrorMessage("");
    setOwnerReplyText(draft.content);
    setActionMessage("AI draft loaded into the reply box. Review it before sending.");
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
          "id, business_name, contact_name, contact_email, business_type, status, monthly_price, notes"
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


      const paymentResult = await supabase
        .from("payment_records")
        .select("id, client_id, provider, status, amount, currency, note, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (paymentResult.error) {
        setErrorMessage(`Payment records load failed: ${paymentResult.error.message}`);
      } else {
        setPaymentRecords((paymentResult.data || []) as PaymentRecordRow[]);
      }

      const outputResult = await supabase
        .from("ai_task_outputs")
        .select(
          "id, task_id, client_id, project_id, output_type, title, content, status, needs_owner_review, created_at"
        )
        .in("output_type", ["client_reply_draft", "project_build_plan"])
        .order("created_at", { ascending: false })
        .limit(10);

      if (outputResult.error) {
        setErrorMessage(`AI outputs load failed: ${outputResult.error.message}`);
      } else {
        setAiTaskOutputs((outputResult.data || []) as AiTaskOutputRow[]);
      }

      const messageResult = await supabase
  .from("client_messages")
  .select(
    "id, client_id, sender_type, message, needs_owner_review, ai_handled, created_at"
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

      let domainDecisionMessage: string | null = null;

      if (isDomainConnectionReview(approval)) {
        const domainName = getDomainFromApproval(approval);

        if (!domainName) {
          setErrorMessage(
            "Approval was saved, but NXQ could not find the domain name in the approval text."
          );
          return;
        }

        if (status === "accepted") {
          const domainUpdate = await supabase
            .from("client_domains")
            .update({
              status: "waiting_dns",
              reviewed_at: new Date().toISOString(),
              dns_instructions:
                "NXQ reviewed this client-owned domain request. DNS instructions are pending. Client keeps ownership of the domain and should not transfer ownership to NXQ.",
              owner_notes: ownerResponse,
              updated_at: new Date().toISOString(),
            })
            .eq("client_id", approval.client_id)
            .eq("domain_name", domainName);

          if (domainUpdate.error) {
            setErrorMessage(`Domain status update failed: ${domainUpdate.error.message}`);
            return;
          }

          domainDecisionMessage = `${domainName} moved to waiting DNS.`;
        }

        if (status === "denied") {
          const domainUpdate = await supabase
            .from("client_domains")
            .update({
              status: "failed",
              owner_notes: ownerResponse,
              reviewed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("client_id", approval.client_id)
            .eq("domain_name", domainName);

          if (domainUpdate.error) {
            setErrorMessage(`Domain denial update failed: ${domainUpdate.error.message}`);
            return;
          }

          domainDecisionMessage = `${domainName} marked as failed/denied.`;
        }
      }

      await supabase.from("activity_logs").insert({
        client_id: approval.client_id,
        actor_type: "owner",
        action: `approval_${status}`,
        details: {
          approval_id: approval.id,
          owner_response: ownerResponse,
          domain_decision: domainDecisionMessage,
        },
      });

      setActionMessage(
        domainDecisionMessage
          ? `Saved: ${ownerResponse} ${domainDecisionMessage}`
          : `Saved: ${ownerResponse}`
      );

      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown update error";
      setErrorMessage(`Action failed: ${message}`);
    }
  }

  async function requestMoreSetupInfo(
    approval: ApprovalRow,
    client: ClientRow | null,
    clientName: string
  ) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("Cannot request more setup info because the client record was not found.");
      return;
    }

    const requestedInfo = window.prompt(
      `What information do you need from ${clientName}?`,
      "Please add the missing project details before NXQ continues the build plan."
    );

    if (requestedInfo === null) return;

    const cleanRequestedInfo = requestedInfo.trim();

    if (!cleanRequestedInfo) {
      setErrorMessage("More info request cancelled because no reason was entered.");
      return;
    }

    const confirmed = window.confirm(
      `Ask for more setup info\n\nClient: ${clientName}\n\nReason:\n${cleanRequestedInfo}\n\nThis will reopen the client setup sheet by moving the client back to intake_sent. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const ownerResponse = `Owner requested more setup information: ${cleanRequestedInfo}`;
      const existingNotes = client.notes || "";
      const moreInfoNote = [
        "NXQ MORE INFO REQUEST",
        `Requested info: ${cleanRequestedInfo}`,
        `Requested at: ${new Date().toISOString()}`,
      ].join("\n");
      const nextClientNotes = existingNotes
        ? `${existingNotes.trim()}\n\n${moreInfoNote}`
        : moreInfoNote;

      const approvalResult = await supabase
        .from("owner_approval_requests")
        .update({
          status: "more_info_requested",
          owner_response: ownerResponse,
        })
        .eq("id", approval.id);

      if (approvalResult.error) {
        setErrorMessage(`Approval update failed: ${approvalResult.error.message}`);
        return;
      }

      if (isWebsiteSetupReport(approval)) {
        const clientResult = await supabase
          .from("clients")
          .update({
            status: "intake_sent",
            notes: nextClientNotes,
          })
          .eq("id", client.id);

        if (clientResult.error) {
          setErrorMessage(`Client setup reset failed: ${clientResult.error.message}`);
          return;
        }

        await supabase.from("activity_logs").insert({
          client_id: client.id,
          actor_type: "owner",
          action: "setup_more_info_requested",
          details: {
            approval_id: approval.id,
            previous_approval_status: approval.status,
            next_client_status: "intake_sent",
            owner_requested_info: cleanRequestedInfo,
            note: "Owner requested more setup information and reopened the client setup sheet.",
          },
        });
      }

      setActionMessage(`More setup info requested for ${clientName}. Client setup sheet reopened.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown setup reset error";
      setErrorMessage(`Setup reset failed: ${message}`);
    }
  }

  async function updateClientStatus(
    client: ClientRow,
    nextStatus: string,
    actionLabel: string
  ) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const confirmed = window.confirm(
      `${actionLabel}\n\nClient: ${client.business_name}\n\nSupabase will update the client status only. This will not charge, launch, mark paid, freeze billing, or delete project data. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const statusResult = await supabase.rpc("update_client_status", {
        target_client_id: client.id,
        next_client_status: nextStatus,
        action_label: actionLabel,
      });

      if (statusResult.error) {
        setErrorMessage(`Client status update failed: ${statusResult.error.message}`);
        return;
      }

      const resultData = statusResult.data as { message?: string } | null;

      setActionMessage(resultData?.message || `${client.business_name}: ${actionLabel} complete.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown client status update error";
      setErrorMessage(`Client status update failed: ${message}`);
    }
  }

  async function approveLaunchPreview(approval: ApprovalRow, clientName: string) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const previewUrl = getLaunchPreviewUrl(approval);

    const ownerNotes = window.prompt(
      `Approve website preview for launch?\n\nClient: ${clientName}\nPreview: ${previewUrl || "No preview URL found"}\n\nThis approves the preview gate only. It does not automatically deploy or launch the live website.`,
      "Owner inspected preview link and approved this website preview for launch."
    );

    if (ownerNotes === null) return;

    const cleanOwnerNotes = ownerNotes.trim();

    if (!cleanOwnerNotes) {
      setErrorMessage("Preview approval cancelled because no owner note was entered.");
      return;
    }

    const confirmed = window.confirm(
      `Confirm preview approval\n\nClient: ${clientName}\nPreview: ${previewUrl || "No preview URL found"}\n\nYou are confirming that you opened the preview link and checked the website. This will allow the project to move live later, but it will NOT launch automatically. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const previewResult = await supabase.rpc("approve_launch_preview", {
        approval_request_id: approval.id,
        owner_notes: cleanOwnerNotes,
      });

      if (previewResult.error) {
        setErrorMessage(`Preview approval failed: ${previewResult.error.message}`);
        return;
      }

      const resultData = previewResult.data as { message?: string } | null;

      setActionMessage(
        resultData?.message ||
          `${clientName}: website preview approved for launch.`
      );

      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown preview approval error";
      setErrorMessage(`Preview approval failed: ${message}`);
    }
  }
  async function createProjectForClient(client: ClientRow) {
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
      `Create project\n\nClient: ${client.business_name}\n\nSupabase will create a website project record only. This will not launch, charge, mark paid, activate billing, or freeze anything. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const projectResult = await supabase.rpc("create_project_for_client", {
        target_client_id: client.id,
      });

      if (projectResult.error) {
        setErrorMessage(`Project create failed: ${projectResult.error.message}`);
        return;
      }

      const resultData = projectResult.data as { message?: string } | null;

      setActionMessage(resultData?.message || `${client.business_name}: project created.`);
      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown project create error";
      setErrorMessage(`Project create failed: ${message}`);
    }
  }
  async function acceptApprovalAndStartPipelineCloud(
    approval: ApprovalRow,
    client: ClientRow | null,
    clientName: string
  ) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("Cannot start backend pipeline because the client record was not found.");
      return;
    }

    setActionMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("approve_website_setup", {
        approval_request_id: approval.id,
      });

      if (error) {
        setErrorMessage(`Backend approval workflow failed: ${error.message}`);
        return;
      }

      const result = data as { message?: string } | null;

      setActionMessage(
        result?.message ||
          `${clientName}: approved, moved into planning, and build plan created by Supabase.`
      );

      await loadOwnerData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown backend workflow error";
      setErrorMessage(`Backend approval workflow failed: ${message}`);
    }
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

  async function activateManualSubscription(client: ClientRow) {
    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    const confirmed = window.confirm(
      `Activate manual subscription\n\nClient: ${client.business_name}\nAmount: ${formatMoney(Number(client.monthly_price || 0))}/mo\n\nThis is MANUAL/CASH tracking only. Supabase will mark the client active and save a manual payment record. If a project already exists, live/launch-ready projects will stay in their current stage instead of being moved backward. If no project exists yet, Supabase may create one in building.\n\nThis will NOT charge a card, PayPal, Stripe, bank account, or any online payment method. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const activationResult = await supabase.rpc("activate_manual_subscription", {
        target_client_id: client.id,
      });

      if (activationResult.error) {
        setErrorMessage(`Manual activation failed: ${activationResult.error.message}`);
        return;
      }

      const resultData = activationResult.data as { message?: string } | null;

      setActionMessage(
        resultData?.message ||
          `${client.business_name} subscription manually activated. No online charge was processed.`
      );

      await loadOwnerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown manual activation error";
      setErrorMessage(`Manual activation failed: ${message}`);
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
      `${actionLabel}\n\nClient: ${client.business_name}\nProject stage: ${nextStage}\n\nSupabase will update the project stage only. This will not launch, charge, mark paid, or freeze billing. Continue?`
    );

    if (!confirmed) return;

    setActionMessage("");
    setErrorMessage("");

    try {
      const stageResult = await supabase.rpc("update_project_stage", {
        target_client_id: client.id,
        next_website_status: nextStage,
      });

      if (stageResult.error) {
        setErrorMessage(`Project stage update failed: ${stageResult.error.message}`);
        return;
      }

      const resultData = stageResult.data as { message?: string } | null;

      setActionMessage(
        resultData?.message ||
          `${client.business_name}: ${actionLabel} complete.`
      );

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

  const recentCompletedApprovals = completedApprovals.slice(0, 4);

  const latestProjectBuildPlans = aiTaskOutputs
    .filter((output) => output.output_type === "project_build_plan")
    .reduce<AiTaskOutputRow[]>((latestPlans, output) => {
      const existingIndex = latestPlans.findIndex(
        (plan) => plan.client_id === output.client_id
      );

      if (existingIndex === -1) {
        return [...latestPlans, output];
      }

      const existingPlan = latestPlans[existingIndex];
      const outputDate = new Date(output.created_at).getTime();
      const existingDate = new Date(existingPlan.created_at).getTime();

      if (outputDate <= existingDate) {
        return latestPlans;
      }

      const nextPlans = [...latestPlans];
      nextPlans[existingIndex] = output;
      return nextPlans;
    }, []);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner APS</p>
            <h1>{ownerView === "aps" ? "NXQ command chat" : "NXQ client chat"}</h1>
            <p className="subtle">
              {ownerView === "aps" ? "AI approval cockpit and owner decisions." : "Pick one client and text them directly."}
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
              Client chat
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
          <section className="panel panel-large" style={{ display: ownerView === "aps" ? undefined : "none" }}>
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

                    <div className="approval-actions">
                      <button
                        type="button"
                        onClick={() => {
                          if (isLaunchPreviewReview(approval)) {
                            approveLaunchPreview(approval, clientName);
                            return;
                          }

                          if (!confirmHighRiskAction("accept", clientName)) return;

                          if (isPipelineStartApproval(approval)) {
                            acceptApprovalAndStartPipeline(approval, client, clientName);
                            return;
                          }

                          if (isAiTaskApproval(approval) || !isPipelineStartApproval(approval)) {
                            updateApprovalStatus(
                              approval,
                              "accepted",
                              "Owner accepted this approval request."
                            );
                            return;
                          }

                          acceptApprovalAndStartPipelineCloud(approval, client, clientName);
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
                        onClick={() => requestMoreSetupInfo(approval, client, clientName)}
                      >
                        Ask More
                      </button>
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

              {latestProjectBuildPlans.map((output) => (
                  <article className="build-plan-card" key={output.id}>
                    <div className="approval-top">
                      <span>{output.title}</span>
                      <small>{output.status}</small>
                    </div>

          <div className="build-plan-sections">
            {parseBuildPlanSections(output.content).map((section) => (
              <section className="build-plan-section" key={`${output.id}-${section.title}`}>
                <div className="build-plan-section-title">
                  <span>{section.title}</span>
                </div>
                <pre>{section.body}</pre>
              </section>
            ))}
          </div>
                  </article>
                ))}
            </div>
          </section>

          <aside className="panel" style={{ display: ownerView === "aps" ? undefined : "none" }}>
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
                      onClick={() => requestMoreInfoFromClientCard(client)}
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

          <section className="panel panel-large owner-chat-panel-hidden" style={{ display: ownerView === "chat" ? undefined : "none", gridColumn: "1 / -1" }}>
  <div className="panel-title panel-title-row">
    <div className="panel-title">
      <MessageSquareText size={20} />
      <h2>Client chat</h2>
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
                <option value="">Pick a client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.business_name}
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
                onClick={useLatestAiDraft}
                type="button"
                disabled={!selectedReplyClientId || aiTaskOutputs.length === 0}
              >
                Use latest AI draft
              </button>

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

          <aside className="panel" style={{ display: ownerView === "aps" ? undefined : "none" }}>
            <div className="panel-title panel-title-row">
              <div className="panel-title">
                <Clock size={20} />
                <h2>Payment records</h2>
              </div>

              <button className="icon-btn" onClick={loadOwnerData} type="button">
                <RefreshCcw size={16} />
              </button>
            </div>

            <div className="owner-message-list">
              {paymentRecords.length === 0 && !isLoading ? (
                <div className="empty-state">No payment records yet.</div>
              ) : null}

              {paymentRecords.map((payment) => {
                const client = getClientForPayment(payment);

                return (
                  <article className="owner-message-card" key={payment.id}>
                    <div className="owner-message-top">
                      <strong>{client?.business_name || "Unknown client"}</strong>
                      <span>{formatDateTime(payment.created_at)}</span>
                    </div>

                    <p>
                      {payment.provider} · {formatStatus(payment.status)} ·{" "}
                      {formatMoney(Number(payment.amount || 0))}
                    </p>

                    <small>{payment.note || "No payment note saved."}</small>
                  </article>
                );
              })}
            </div>

            <div className="history-item">
              <CheckCircle2 size={16} />
              <p>Manual, PayPal, and Stripe payments will appear here.</p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
































































































































