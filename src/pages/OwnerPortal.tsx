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
import { getPaymentProvider } from "../services/paymentProviders";
import { classifyCapabilityRequest } from "../ai/capabilityRules";

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
      lastField.value = lastField.value ? `${lastField.value} ${line}` : line;
    }
  }

  return fields;
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

  const monthlyIncome = useMemo(() => {
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


  function confirmHighRiskAction(action: "accept" | "deny", clientName: string) {
    const actionLabel = action === "accept" ? "ACCEPT" : "DENY";

    return window.confirm(
      `Confirm ${actionLabel}\n\nClient: ${clientName}\n\nThis will update the approval request in Supabase. Continue?`
    );
  }

  function getSetupField(fields: { label: string; value: string }[], labelMatch: string) {
    return (
      fields.find((field) =>
        field.label.toLowerCase().includes(labelMatch.toLowerCase())
      )?.value || "Not provided"
    );
  }

  function formatCapabilityClassification(requestedText: string) {
    const classification = classifyCapabilityRequest(requestedText);

    const matchedFeatures =
      classification.matchedFeatures.length > 0
        ? classification.matchedFeatures.map((feature) => `- ${feature}`).join("\n")
        : "- No exact capability rule matched. Owner review required.";

    return [
      "Requested capability classification:",
      `Decision: ${classification.decision}`,
      `Highest capability level: ${classification.highestLevel}`,
      `Risk level: ${classification.riskLevel}`,
      `Owner approval required: ${classification.requiresOwnerApproval ? "yes" : "no"}`,
      `Custom quote required: ${classification.requiresCustomQuote ? "yes" : "no"}`,
      `Payment provider needed: ${classification.requiresPaymentProvider ? "yes" : "no"}`,
      `External API/integration needed: ${classification.requiresExternalApi ? "yes" : "no"}`,
      "",
      "Matched feature rules:",
      matchedFeatures,
      "",
      "Safe client-facing capability response:",
      classification.clientSafeSummary,
      "",
      "Owner internal capability note:",
      classification.ownerInternalSummary,
    ].join("\n");
  }

  function shouldRouteCapabilityApproval(decision: string) {
    return (
      decision === "owner_review_required" ||
      decision === "custom_quote_required" ||
      decision === "not_supported_yet"
    );
  }

  function createCapabilityReviewText(requestedText: string) {
    const classification = classifyCapabilityRequest(requestedText);

    const matchedFeatures =
      classification.matchedFeatures.length > 0
        ? classification.matchedFeatures.map((feature) => `- ${feature}`).join("\n")
        : "- No exact capability rule matched. Owner review required.";

    return [
      "NXQ ADVANCED CAPABILITY REVIEW",
      "",
      `Decision: ${classification.decision}`,
      `Highest capability level: ${classification.highestLevel}`,
      `Risk level: ${classification.riskLevel}`,
      `Owner approval required: ${classification.requiresOwnerApproval ? "yes" : "no"}`,
      `Custom quote required: ${classification.requiresCustomQuote ? "yes" : "no"}`,
      `Payment provider needed: ${classification.requiresPaymentProvider ? "yes" : "no"}`,
      `External API/integration needed: ${classification.requiresExternalApi ? "yes" : "no"}`,
      "",
      "Matched feature rules:",
      matchedFeatures,
      "",
      "Safe client-facing response:",
      classification.clientSafeSummary,
      "",
      "Owner internal note:",
      classification.ownerInternalSummary,
      "",
      "Recommended owner options:",
      "- Approve limited launch-safe version",
      "- Ask client for more info",
      "- Require custom quote",
      "- Deny unsupported advanced version",
    ].join("\n");
  }

  async function createCapabilityScopeReviewApproval(
    approval: ApprovalRow,
    client: ClientRow,
    projectId: string | null
  ) {
    if (!supabase) {
      return { ok: false, message: "Supabase is not configured yet." };
    }

    const requestedText = [approval.summary, approval.recommended_action || ""].join("\n");
    const classification = classifyCapabilityRequest(requestedText);

    if (!shouldRouteCapabilityApproval(classification.decision)) {
      return { ok: true, message: "No advanced capability approval needed." };
    }

    const matchedFeatureList =
      classification.matchedFeatures.length > 0
        ? classification.matchedFeatures.join(", ")
        : "Unknown advanced feature";

    const reviewText = createCapabilityReviewText(requestedText);

    const approvalResult = await supabase.from("owner_approval_requests").insert({
      client_id: client.id,
      project_id: projectId,
      request_type: "capability_scope_review",
      title: "Advanced capability review needed",
      summary: `${client.business_name} requested features that need owner review. Decision: ${classification.decision}. Matched: ${matchedFeatureList}.`,
      recommended_action: reviewText,
      risk_level: classification.riskLevel,
      status: "pending",
    });

    if (approvalResult.error) {
      return {
        ok: false,
        message: `Capability approval create failed: ${approvalResult.error.message}`,
      };
    }

    return { ok: true, message: "Capability approval created." };
  }

  function generateProjectBuildPlan(approval: ApprovalRow, client: ClientRow) {
    const fields = parseSetupReport(approval.recommended_action || "");

    const selectedPackage = getSetupField(fields, "Selected package");
    const companyScale = getSetupField(fields, "Company scale");
    const locationSetup = getSetupField(fields, "Location setup");
    const locations = getSetupField(fields, "Locations");
    const industry = getSetupField(fields, "Industry");
    const services = getSetupField(fields, "Services");
    const pagesNeeded = getSetupField(fields, "Pages");
    const styleDirection = getSetupField(fields, "Style");
    const brandPositioning = getSetupField(fields, "Brand");
    const competitors = getSetupField(fields, "Competitors");

    const capabilityRequestText = [
      approval.summary,
      approval.recommended_action || "",
      industry,
      services,
      pagesNeeded,
      brandPositioning,
      competitors,
    ].join("\n");

    const capabilitySummary = formatCapabilityClassification(capabilityRequestText);

    const missingAssets = [
      approval.summary.toLowerCase().includes("logo") ? "Logo/photos may be missing or still needed." : "",
      pagesNeeded === "Not provided" ? "Confirm required pages/sections." : "",
      styleDirection === "Not provided" ? "Confirm visual style direction." : "",
      services === "Not provided" ? "Confirm services/products list." : "",
    ].filter(Boolean);

    return [
      "NXQ PROJECT BUILD PLAN",
      "",
      `Client: ${client.business_name}`,
      `Package: ${selectedPackage}`,
      `Company scale: ${companyScale}`,
      `Location setup: ${locationSetup}`,
      `Locations: ${locations}`,
      `Industry: ${industry}`,
      "",
      "Core website direction:",
      `${client.business_name} needs a premium website build for a ${industry} business. Use the submitted setup sheet as the source of truth and keep the project in planning until required content/assets are confirmed.`,
      "",
      "Recommended pages / sections:",
      pagesNeeded,
      "",
      "Services / products to feature:",
      services,
      "",
      "Style direction:",
      styleDirection,
      "",
      "Brand positioning:",
      brandPositioning,
      "",
      "Competitors / examples:",
      competitors,
      "",
      "Advanced feature / capability review:",
      capabilitySummary,
      "",
      "Missing assets / follow-up needed:",
      missingAssets.length > 0 ? missingAssets.map((item) => `- ${item}`).join("\n") : "- No obvious missing assets detected from the approval summary.",
      "",
      "Initial build phases:",
      "1. Confirm required pages, assets, and client priorities.",
      "2. Draft homepage structure and service sections.",
      "3. Create first visual direction/design preview.",
      "4. Prepare owner review before client-facing delivery.",
      "5. Move project from planning to building only after owner confirms readiness.",
      "",
      "Owner safety rule:",
      "Do not launch, charge externally, freeze, or mark final approval without explicit owner confirmation.",
    ].join("\n");
  }

  async function createProjectBuildPlanOutput(
    approval: ApprovalRow,
    client: ClientRow,
    projectId: string | null
  ) {
    if (!supabase) {
      return { ok: false, message: "Supabase is not configured yet." };
    }

    const buildPlan = generateProjectBuildPlan(approval, client);

    const outputResult = await supabase.from("ai_task_outputs").insert({
      client_id: client.id,
      project_id: projectId,
      output_type: "project_build_plan",
      title: `${client.business_name} Project Build Plan`,
      content: buildPlan,
      status: "draft_ready",
      needs_owner_review: true,
    });

    if (outputResult.error) {
      return {
        ok: false,
        message: `Build plan create failed: ${outputResult.error.message}`,
      };
    }

    const capabilityApprovalResult = await createCapabilityScopeReviewApproval(
      approval,
      client,
      projectId
    );

    if (!capabilityApprovalResult.ok) {
      return capabilityApprovalResult;
    }

    return { ok: true, message: "Build plan created." };
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
      const paymentProvider = getPaymentProvider("manual");
      const paymentResult = await paymentProvider.activateSubscription({
        clientId: client.id,
        clientName: client.business_name,
        monthlyPrice: Number(client.monthly_price || 0),
      });

      if (!paymentResult.ok) {
        setErrorMessage(paymentResult.message);
        return;
      }

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
      let pipelineProjectId = existingProject?.id || null;

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

        pipelineProjectId = projectCreate.data?.id || null;
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

      const buildPlanResult = await createProjectBuildPlanOutput(
        approval,
        client,
        pipelineProjectId
      );

      if (!buildPlanResult.ok) {
        setErrorMessage(buildPlanResult.message);
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

      setActionMessage(`${clientName}: approved, moved into planning, and build plan created.`);
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
      const paymentProvider = getPaymentProvider("manual");
      const paymentResult = await paymentProvider.activateSubscription({
        clientId: client.id,
        clientName: client.business_name,
        monthlyPrice: Number(client.monthly_price || 0),
      });

      if (!paymentResult.ok) {
        setErrorMessage(paymentResult.message);
        return;
      }

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

      const paymentRecord = await supabase.from("payment_records").insert({
        client_id: client.id,
        provider: paymentResult.provider,
        status: paymentResult.status,
        amount: Number(client.monthly_price || 0),
        currency: "USD",
        external_payment_id: paymentResult.externalPaymentId || null,
        note: paymentResult.message,
      });

      if (paymentRecord.error) {
        setErrorMessage(`Payment record failed: ${paymentRecord.error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "owner",
        action: "manual_subscription_activated",
        details: {
          client_name: client.business_name,
          client_status: "active",
          project_status: "building",
          payment_mode: paymentResult.provider,
          payment_status: paymentResult.status,
          payment_message: paymentResult.message,
          note: "Manual activation used while payment provider is not connected.",
        },
      });

      setActionMessage(paymentResult.message);
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
            <small>{formatMoney(monthlyIncome)}/mo</small>
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

                          if (isAiTaskApproval(approval) || !isPipelineStartApproval(approval)) {
                            updateApprovalStatus(
                              approval,
                              "accepted",
                              "Owner accepted this approval request."
                            );
                            return;
                          }

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



































































































