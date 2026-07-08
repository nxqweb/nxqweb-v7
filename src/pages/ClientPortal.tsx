import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ImagePlus,
  LogOut,
  MessageCircle,
  RefreshCcw,
  Send,
  UploadCloud,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ClientRow = {
  id: string;
  business_name: string;
  status: string;
  monthly_price: number;
  notes: string | null;
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

type UploadedFileRow = {
  id: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: string;
  uploaded_at: string;
  expires_at: string;
};

type ClientDomainRow = {
  id: string;
  client_id: string;
  domain_name: string;
  domain_type: string;
  status: string;
  dns_provider: string | null;
  registrar_name: string | null;
  ownership_confirmed: boolean;
  client_notes: string | null;
  dns_instructions: string | null;
  requested_at: string;
};

type PackageTier = "starter" | "growth" | "intelligence";

const packageOptions: Record<
  PackageTier,
  {
    label: string;
    price: number;
    badge: string;
    description: string;
    capabilities: string[];
    serviceRules: string[];
  }
> = {
  starter: {
    label: "Starter",
    price: 50,
    badge: "Best Entry",
    description:
      "Premium website essentials for small businesses that need a trusted online presence.",
    capabilities: [
      "Premium 1–3 page website",
      "Mobile-responsive design",
      "Basic SEO setup",
      "Contact form",
      "Simple client portal access",
      "Manual update requests",
    ],
    serviceRules: [
      "Best for simple local businesses and solo owners",
      "AI may help organize setup details and draft basic website copy",
      "No click tracking, behavior reporting, advanced SEO campaign, or monthly optimization report included",
      "Owner approval is required before launch",
    ],
  },
  growth: {
    label: "Growth",
    price: 100,
    badge: "Most Popular",
    description:
      "SEO-focused website system for businesses that want stronger structure, better visibility, and more leads.",
    capabilities: [
      "Everything in Starter",
      "Up to 5 core pages",
      "Service-area SEO sections",
      "Monthly website/content improvements",
      "Review and testimonial sections",
      "AI-assisted SEO/content suggestions",
    ],
    serviceRules: [
      "Best for contractors, tree services, cleaning companies, and local service teams",
      "AI may suggest SEO sections, service-area copy, and monthly content improvements",
      "Behavior insights and click/scroll reporting are not included unless upgraded",
      "Owner approval is required before major changes and launch",
    ],
  },
  intelligence: {
    label: "Intelligence",
    price: 150,
    badge: "Most Advanced",
    description:
      "AI-powered website optimization with behavior insights, monthly review, and conversion-focused planning.",
    capabilities: [
      "Everything in Growth",
      "Click and scroll insights",
      "Page interaction review",
      "Monthly AI website review",
      "Layout improvement suggestions",
      "Conversion-focused optimization notes",
    ],
    serviceRules: [
      "Best for businesses serious about leads, growth, and long-term performance",
      "AI may review behavior signals and recommend layout/content improvements",
      "AI may prepare monthly optimization notes for owner review",
      "Owner approval is required before launch, major copy changes, or risky optimization changes",
    ],
  },
};

const completedSetupStatuses = [
  "intake_received",
  "needs_review",
  "approved",
  "active",
  "overdue",
  "suspended",
  "dormant",
  "archived",
];

function getLatestMoreInfoRequest(notes: string | null | undefined) {
  if (!notes) return "";

  const marker = "NXQ MORE INFO REQUEST";
  const sections = notes.split(marker);
  const latestSection = sections.length > 1 ? sections[sections.length - 1] : "";
  const requestedInfoLine = latestSection
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("Requested info:"));

  return requestedInfoLine?.replace("Requested info:", "").trim() || "";
}


type TargetedMoreInfoRequest = {
  fieldKey: string;
  fieldLabel: string;
  requestedInfo: string;
};

function getLatestTargetedMoreInfoRequest(notes: string | null | undefined): TargetedMoreInfoRequest | null {
  if (!notes) return null;

  const marker = "NXQ TARGETED MORE INFO REQUEST";
  const sections = notes.split(marker);
  const latestSection = sections.length > 1 ? sections[sections.length - 1] : "";

  if (!latestSection.trim()) return null;

  const lines = latestSection
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const fieldKey =
    lines.find((line) => line.startsWith("Field key:"))?.replace("Field key:", "").trim() || "other";
  const fieldLabel =
    lines.find((line) => line.startsWith("Field label:"))?.replace("Field label:", "").trim() ||
    "Other requested information";
  const requestedInfo =
    lines.find((line) => line.startsWith("Requested info:"))?.replace("Requested info:", "").trim() || "";

  if (!requestedInfo) return null;

  return {
    fieldKey,
    fieldLabel,
    requestedInfo,
  };
}
function parseClientSetupReport(notes: string | null | undefined) {
  if (!notes?.includes("NXQ WEB WEBSITE SETUP REPORT")) {
    return new Map<string, string>();
  }

  const reportOnly = notes.split("NXQ MORE INFO REQUEST")[0] || notes;
  const lines = reportOnly.split("\n");
  const fields = new Map<string, string>();
  let activeLabel = "";
  let activeValue: string[] = [];

  function saveActiveField() {
    if (!activeLabel) return;

    fields.set(
      activeLabel,
      activeValue.join("\n").trim().replace(/^Not provided$/i, "")
    );
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line === "NXQ WEB WEBSITE SETUP REPORT") {
      continue;
    }

    if (line.endsWith(":")) {
      saveActiveField();
      activeLabel = line.replace(/:$/, "").trim();
      activeValue = [];
      continue;
    }

    const inlineMatch = line.match(/^([^:]+):\s*(.*)$/);

    if (inlineMatch) {
      saveActiveField();
      activeLabel = inlineMatch[1].trim();
      activeValue = [inlineMatch[2].trim()];
      continue;
    }

    if (activeLabel) {
      activeValue.push(line);
    }
  }

  saveActiveField();

  return fields;
}

function getSetupReportValue(fields: Map<string, string>, label: string) {
  return fields.get(label)?.trim() || "";
}

export function ClientPortal() {
  const [nxqTheme, setNxqTheme] = useState<"dark" | "light">(() => {
    const savedTheme = window.localStorage.getItem("nxq-theme");
    const theme = savedTheme === "light" ? "light" : "dark";
    document.body.dataset.nxqTheme = theme;
    return theme;
  });

  function toggleNxqTheme() {
    const nextTheme = nxqTheme === "dark" ? "light" : "dark";
    document.body.dataset.nxqTheme = nextTheme;
    window.localStorage.setItem("nxq-theme", nextTheme);
    setNxqTheme(nextTheme);
  }
  const [client, setClient] = useState<ClientRow | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [messages, setMessages] = useState<ClientMessageRow[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileRow[]>([]);
  const [clientDomains, setClientDomains] = useState<ClientDomainRow[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [domainName, setDomainName] = useState("");
  const [domainRegistrar, setDomainRegistrar] = useState("");
  const [domainDnsProvider, setDomainDnsProvider] = useState("");
  const [domainNotes, setDomainNotes] = useState("");
  const [domainOwnershipConfirmed, setDomainOwnershipConfirmed] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<PackageTier>("starter");
  const [companyScale, setCompanyScale] = useState("Local business");
  const [locationType, setLocationType] = useState("Single location");
  const [locations, setLocations] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessHours, setBusinessHours] = useState("");
  const [emergencyAvailability, setEmergencyAvailability] = useState("");
  const [industry, setIndustry] = useState("");
  const [services, setServices] = useState("");
  const [pagesNeeded, setPagesNeeded] = useState("");
  const [styleDirection, setStyleDirection] = useState("");
  const [brandNotes, setBrandNotes] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [preferredContactMethod, setPreferredContactMethod] = useState("");
  const [urgentLeadRules, setUrgentLeadRules] = useState("");
  const [rejectedJobs, setRejectedJobs] = useState("");
  const [areasNotServed, setAreasNotServed] = useState("");
  const [aiCanAnswer, setAiCanAnswer] = useState("");
  const [aiNeverPromise, setAiNeverPromise] = useState("");
  const [escalationRules, setEscalationRules] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [typedSignature, setTypedSignature] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isSubmittingDomain, setIsSubmittingDomain] = useState(false);
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const setupComplete = client ? completedSetupStatuses.includes(client.status) : false;
  const projectStage = project?.website_status || client?.status || "loading";

  function formatStatus(status: string) {
    return status.replaceAll("_", " ");
  }

  async function handleLogout() {
    if (!supabase) return;

    await supabase.auth.signOut();
    window.location.href = "/portal/login";
  }

  async function loadClientPortalData() {
    setIsLoading(true);
    setNotice("");
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      setErrorMessage("Supabase is not configured yet. Check .env.local.");
      return;
    }

    try {
      const sessionResult = await supabase.auth.getSession();
      const session = sessionResult.data.session;

      if (!session) {
        window.location.href = "/portal/login";
        return;
      }

      const userId = session.user.id;

      const clientResult = await supabase
        .from("clients")
        .select("id, business_name, status, monthly_price, notes")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (clientResult.error) {
        setErrorMessage(`Client load failed: ${clientResult.error.message}`);
        setClient(null);
        setProject(null);
        setMessages([]);
        setUploadedFiles([]);
        setUploadedFiles([]);
        return;
      }

      if (!clientResult.data) {
        setErrorMessage(
          "No client profile is linked to this login yet. Try signing out and creating a client account again."
        );
        setClient(null);
        setProject(null);
        setMessages([]);
        setUploadedFiles([]);
        setUploadedFiles([]);
        return;
      }

      const loadedClient = clientResult.data as ClientRow;
      setClient(loadedClient);

      const matchingPackage =
        Object.entries(packageOptions).find(
          ([, option]) => option.price === Number(loadedClient.monthly_price)
        )?.[0] || "starter";

      setSelectedPackage(matchingPackage as PackageTier);

      const setupFields = parseClientSetupReport(loadedClient.notes);

      if (setupFields.size > 0) {
        const savedPackage = getSetupReportValue(setupFields, "Selected package");
        const savedPackageTier = Object.entries(packageOptions).find(([, option]) =>
          savedPackage.toLowerCase().includes(option.label.toLowerCase())
        )?.[0];

        if (savedPackageTier) {
          setSelectedPackage(savedPackageTier as PackageTier);
        }

        setCompanyScale(getSetupReportValue(setupFields, "Company scale") || "Local business");
        setLocationType(getSetupReportValue(setupFields, "Location setup") || "Single location");
        setLocations(getSetupReportValue(setupFields, "Locations"));
        setBusinessPhone(getSetupReportValue(setupFields, "Business phone"));
        setBusinessEmail(getSetupReportValue(setupFields, "Business email"));
        setBusinessAddress(getSetupReportValue(setupFields, "Business address"));
        setBusinessHours(getSetupReportValue(setupFields, "Business hours"));
        setEmergencyAvailability(getSetupReportValue(setupFields, "Emergency / after-hours availability"));
        setIndustry(getSetupReportValue(setupFields, "Industry"));
        setServices(getSetupReportValue(setupFields, "Services / products"));
        setPagesNeeded(getSetupReportValue(setupFields, "Pages / sections needed"));
        setStyleDirection(getSetupReportValue(setupFields, "Style direction"));
        setBrandNotes(getSetupReportValue(setupFields, "Brand difference / positioning"));
        setCompetitors(getSetupReportValue(setupFields, "Competitors / examples"));
        setPreferredContactMethod(getSetupReportValue(setupFields, "Preferred contact method"));
        setUrgentLeadRules(getSetupReportValue(setupFields, "Urgent lead rules"));
        setRejectedJobs(getSetupReportValue(setupFields, "Jobs / customers to reject"));
        setAreasNotServed(getSetupReportValue(setupFields, "Areas not served"));
        setAiCanAnswer(getSetupReportValue(setupFields, "Assistant can answer"));
        setAiNeverPromise(getSetupReportValue(setupFields, "Assistant should never promise"));
        setEscalationRules(getSetupReportValue(setupFields, "Escalation rules"));
        setTypedSignature(getSetupReportValue(setupFields, "Typed signature"));
        setAgreementAccepted(false);
      }

      const projectResult = await supabase
        .from("projects")
        .select("id, client_id, website_status")
        .eq("client_id", loadedClient.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (projectResult.error) {
        setErrorMessage(`Project stage load failed: ${projectResult.error.message}`);
        setProject(null);
      } else {
        setProject((projectResult.data as ProjectRow) || null);
      }

      const messageResult = await supabase
        .from("client_messages")
        .select(
          "id, client_id, sender_type, message, needs_owner_review, ai_handled, created_at"
        )
        .eq("client_id", loadedClient.id)
        .order("created_at", { ascending: false });

      if (messageResult.error) {
        setErrorMessage(`Message load failed: ${messageResult.error.message}`);
        setMessages([]);
      } else {
        setMessages((messageResult.data || []) as ClientMessageRow[]);
      }

      const fileListResult = await supabase
        .from("client_files")
        .select("id, storage_path, file_name, file_type, file_size, status, uploaded_at, expires_at")
        .eq("client_id", loadedClient.id)
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false })
        .limit(50);

      if (fileListResult.error) {
        setErrorMessage(`File list load failed: ${fileListResult.error.message}`);
        setUploadedFiles([]);
      } else {
        setUploadedFiles((fileListResult.data || []) as UploadedFileRow[]);
      }

      const domainResult = await supabase
        .from("client_domains")
        .select(
          "id, client_id, domain_name, domain_type, status, dns_provider, registrar_name, ownership_confirmed, client_notes, dns_instructions, requested_at"
        )
        .eq("client_id", loadedClient.id)
        .order("requested_at", { ascending: false });

      if (domainResult.error) {
        setErrorMessage(`Domain list load failed: ${domainResult.error.message}`);
        setClientDomains([]);
      } else {
        setClientDomains((domainResult.data || []) as ClientDomainRow[]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown client portal error";
      setErrorMessage(`Client portal failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function submitWebsiteSetup() {
    setNotice("");
    setErrorMessage("");

    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("No client loaded yet.");
      return;
    }

    const selectedPlan = packageOptions[selectedPackage];
    const selectedPlanCapabilities = selectedPlan.capabilities.join("\n- ");
    const selectedPlanRules = selectedPlan.serviceRules.join("\n- ");
    const cleanIndustry = industry.trim();
    const cleanServices = services.trim();
    const cleanPagesNeeded = pagesNeeded.trim();
    const cleanStyleDirection = styleDirection.trim();
    const cleanBrandNotes = brandNotes.trim();
    const cleanLocations = locations.trim();
    const cleanBusinessPhone = businessPhone.trim();
    const cleanBusinessEmail = businessEmail.trim();
    const cleanBusinessAddress = businessAddress.trim();
    const cleanBusinessHours = businessHours.trim();
    const cleanEmergencyAvailability = emergencyAvailability.trim();
    const cleanCompetitors = competitors.trim();
    const cleanPreferredContactMethod = preferredContactMethod.trim();
    const cleanUrgentLeadRules = urgentLeadRules.trim();
    const cleanRejectedJobs = rejectedJobs.trim();
    const cleanAreasNotServed = areasNotServed.trim();
    const cleanAiCanAnswer = aiCanAnswer.trim();
    const cleanAiNeverPromise = aiNeverPromise.trim();
    const cleanEscalationRules = escalationRules.trim();
    const cleanSignature = typedSignature.trim();
    const previousMoreInfoRequest = getLatestMoreInfoRequest(client.notes);
    const isMoreInfoResubmission = Boolean(previousMoreInfoRequest);

    if (!cleanIndustry) {
      setErrorMessage("Enter the client's industry before submitting.");
      return;
    }

    if (!cleanServices) {
      setErrorMessage("Enter the services/products this website needs to explain.");
      return;
    }

    if (!cleanPagesNeeded) {
      setErrorMessage("Enter the pages or sections the website needs.");
      return;
    }

    if (!cleanStyleDirection) {
      setErrorMessage("Enter the style direction for the website.");
      return;
    }

    if (!cleanBrandNotes) {
      setErrorMessage("Enter what makes this business different.");
      return;
    }

    if (!agreementAccepted) {
      setErrorMessage("You must accept the website agreement acknowledgment before submitting.");
      return;
    }

    if (!cleanSignature) {
      setErrorMessage("Type your full name as your signature before submitting.");
      return;
    }

    setIsSubmittingSetup(true);

    try {
      const setupReport = [
        `NXQ WEB WEBSITE SETUP REPORT`,
        ``,
        `Client: ${client.business_name}`,
        `Selected package: ${selectedPlan.label} - $${selectedPlan.price}/mo`,
        `Package badge: ${selectedPlan.badge}`,
        ``,
        `Selected package capabilities:`,
        `- ${selectedPlanCapabilities}`,
        ``,
        `Package AI/service rules:`,
        `- ${selectedPlanRules}`,
        ``,
        `Company scale: ${companyScale}`,
        `Location setup: ${locationType}`,
        `Locations: ${cleanLocations || "Not provided / single location"}`,
        `Business phone: ${cleanBusinessPhone || "Not provided"}`,
        `Business email: ${cleanBusinessEmail || "Not provided"}`,
        `Business address: ${cleanBusinessAddress || "Not provided"}`,
        `Business hours: ${cleanBusinessHours || "Not provided"}`,
        `Emergency / after-hours availability: ${cleanEmergencyAvailability || "Not provided"}`,
        `Industry: ${cleanIndustry}`,
        ``,
        `Services / products:`,
        cleanServices,
        ``,
        `Pages / sections needed:`,
        cleanPagesNeeded,
        ``,
        `Style direction:`,
        cleanStyleDirection,
        ``,
        `Brand difference / positioning:`,
        cleanBrandNotes,
        ``,
        `Competitors / examples:`,
        cleanCompetitors || "Not provided",
        ``,
        `Lead handling rules:`,
        `Preferred contact method: ${cleanPreferredContactMethod || "Not provided"}`,
        `Urgent lead rules: ${cleanUrgentLeadRules || "Not provided"}`,
        `Jobs / customers to reject: ${cleanRejectedJobs || "Not provided"}`,
        `Areas not served: ${cleanAreasNotServed || "Not provided"}`,
        ``,
        `Website assistant rules:`,
        `Assistant can answer: ${cleanAiCanAnswer || "Not provided"}`,
        `Assistant should never promise: ${cleanAiNeverPromise || "Not provided"}`,
        `Escalation rules: ${cleanEscalationRules || "Not provided"}`,
        ``,
        `Agreement accepted: Yes`,
        `Typed signature: ${cleanSignature}`,
        `Signature date: ${new Date().toISOString()}`,
        ``,
        `Payment note: Client understands payment/subscription activation will be required before final website access/live service in a later billing step.`,
      ].join("\n");

      const updateResult = await supabase
        .from("clients")
        .update({
          monthly_price: selectedPlan.price,
          business_type: cleanIndustry,
          service_area: cleanLocations || locationType,
          status: "intake_received",
          notes: setupReport,
        })
        .eq("id", client.id);

      if (updateResult.error) {
        setErrorMessage(`Website setup update failed: ${updateResult.error.message}`);
        return;
      }

      const approvalResult = await supabase.from("owner_approval_requests").insert({
        client_id: client.id,
        project_id: null,
        request_type: "website_setup_review",
        title: isMoreInfoResubmission ? "Website setup resubmitted" : "Website setup submitted",
        summary: isMoreInfoResubmission
          ? `${client.business_name} resubmitted an updated website setup sheet after NXQ requested more information. Package: ${selectedPlan.label} ($${selectedPlan.price}/mo). Scale: ${companyScale}. Location setup: ${locationType}. Industry: ${cleanIndustry}. Signature: ${cleanSignature}.`
          : `${client.business_name} submitted a website setup sheet. Package: ${selectedPlan.label} ($${selectedPlan.price}/mo). Scale: ${companyScale}. Location setup: ${locationType}. Industry: ${cleanIndustry}. Signature: ${cleanSignature}.`,
        recommended_action: setupReport,
        risk_level: "low",
        status: "pending",
      });

      if (approvalResult.error) {
        setErrorMessage(`Owner report failed: ${approvalResult.error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "client",
        action: "website_setup_submitted",
        details: {
          package: selectedPlan.label,
          monthly_price: selectedPlan.price,
          company_scale: companyScale,
          location_type: locationType,
          business_phone: cleanBusinessPhone || null,
          business_email: cleanBusinessEmail || null,
          business_address: cleanBusinessAddress || null,
          business_hours: cleanBusinessHours || null,
          emergency_availability: cleanEmergencyAvailability || null,
          industry: cleanIndustry,
          preferred_contact_method: cleanPreferredContactMethod || null,
          urgent_lead_rules: cleanUrgentLeadRules || null,
          rejected_jobs: cleanRejectedJobs || null,
          areas_not_served: cleanAreasNotServed || null,
          ai_can_answer: cleanAiCanAnswer || null,
          ai_never_promise: cleanAiNeverPromise || null,
          escalation_rules: cleanEscalationRules || null,
          agreement_accepted: agreementAccepted,
          typed_signature: cleanSignature,
          answered_more_info_request: previousMoreInfoRequest || null,
        },
      });

      setNotice(isMoreInfoResubmission ? "Updated website setup submitted. We will review your changes." : "Website setup submitted. We will review your project details.");
      setAgreementAccepted(false);
      setTypedSignature("");
      await loadClientPortalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown setup error";
      setErrorMessage(`Website setup failed: ${message}`);
    } finally {
      setIsSubmittingSetup(false);
    }
  }

  function getTargetedFieldValue(fieldKey: string) {
    switch (fieldKey) {
      case "preferred_contact_method":
        return preferredContactMethod.trim();
      case "emergency_availability":
        return emergencyAvailability.trim();
      case "business_hours":
        return businessHours.trim();
      case "locations":
        return locations.trim();
      case "services":
        return services.trim();
      case "pages_needed":
        return pagesNeeded.trim();
      case "style_direction":
        return styleDirection.trim();
      case "assistant_rules":
        return [
          `Assistant can answer: ${aiCanAnswer.trim() || "Not provided"}`,
          `Assistant should never promise: ${aiNeverPromise.trim() || "Not provided"}`,
          `Escalation rules: ${escalationRules.trim() || "Not provided"}`,
        ].join("\n");
      default:
        return brandNotes.trim();
    }
  }

  function getTargetedFieldControl(request: TargetedMoreInfoRequest) {
    switch (request.fieldKey) {
      case "preferred_contact_method":
        return {
          label: "Preferred contact method",
          value: preferredContactMethod,
          onChange: setPreferredContactMethod,
          placeholder: "Example: Phone calls for urgent jobs, text for quick questions, email for non-urgent follow-up.",
        };
      case "emergency_availability":
        return {
          label: "Emergency / after-hours availability",
          value: emergencyAvailability,
          onChange: setEmergencyAvailability,
          placeholder: "Example: 24/7 storm cleanup available. Sunday emergency calls accepted for dangerous trees.",
        };
      case "business_hours":
        return {
          label: "Business hours",
          value: businessHours,
          onChange: setBusinessHours,
          placeholder: "Example: Monday-Friday 8am-5pm, Saturday by appointment, Sunday closed except emergencies.",
        };
      case "locations":
        return {
          label: "Locations or service areas",
          value: locations,
          onChange: setLocations,
          placeholder: "Example: Oroville, Chico, Paradise, Gridley, Butte County, and nearby areas.",
        };
      case "services":
        return {
          label: "Services / products",
          value: services,
          onChange: setServices,
          placeholder: "Example: Tree removal, trimming, storm cleanup, land clearing, stump grinding.",
        };
      case "pages_needed":
        return {
          label: "Pages or sections needed",
          value: pagesNeeded,
          onChange: setPagesNeeded,
          placeholder: "Example: Home, About, Services, Gallery, Reviews, Service Areas, Contact, Request a Quote.",
        };
      case "style_direction":
        return {
          label: "Website style direction",
          value: styleDirection,
          onChange: setStyleDirection,
          placeholder: "Example: Premium, dark, modern, trustworthy, local, bold, clean, professional.",
        };
      case "assistant_rules":
        return {
          label: "Website assistant rules",
          value: [aiCanAnswer, aiNeverPromise, escalationRules].filter(Boolean).join("\n\n"),
          onChange: (value: string) => {
            setAiCanAnswer(value);
          },
          placeholder: "Tell us what the website assistant can answer, should never promise, and should escalate.",
        };
      default:
        return {
          label: "Other requested information",
          value: brandNotes,
          onChange: setBrandNotes,
          placeholder: "Add the requested missing information here.",
        };
    }
  }

  async function submitTargetedMoreInfoUpdate(request: TargetedMoreInfoRequest) {
    setNotice("");
    setErrorMessage("");

    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("No client loaded yet.");
      return;
    }

    const selectedPlan = packageOptions[selectedPackage];
    const selectedPlanCapabilities = selectedPlan.capabilities.join("\n- ");
    const selectedPlanRules = selectedPlan.serviceRules.join("\n- ");
    const targetedAnswer = getTargetedFieldValue(request.fieldKey);

    if (!targetedAnswer) {
      setErrorMessage(`Please answer: ${request.fieldLabel}`);
      return;
    }

    setIsSubmittingSetup(true);

    try {
      const setupReport = [
        `NXQ WEB WEBSITE SETUP REPORT`,
        ``,
        `Client: ${client.business_name}`,
        `Selected package: ${selectedPlan.label} - $${selectedPlan.price}/mo`,
        `Package badge: ${selectedPlan.badge}`,
        ``,
        `Selected package capabilities:`,
        `- ${selectedPlanCapabilities}`,
        ``,
        `Package AI/service rules:`,
        `- ${selectedPlanRules}`,
        ``,
        `Company scale: ${companyScale}`,
        `Location setup: ${locationType}`,
        `Locations: ${locations.trim() || "Not provided / single location"}`,
        `Business phone: ${businessPhone.trim() || "Not provided"}`,
        `Business email: ${businessEmail.trim() || "Not provided"}`,
        `Business address: ${businessAddress.trim() || "Not provided"}`,
        `Business hours: ${businessHours.trim() || "Not provided"}`,
        `Emergency / after-hours availability: ${emergencyAvailability.trim() || "Not provided"}`,
        `Industry: ${industry.trim() || "Not provided"}`,
        ``,
        `Services / products:`,
        services.trim() || "Not provided",
        ``,
        `Pages / sections needed:`,
        pagesNeeded.trim() || "Not provided",
        ``,
        `Style direction:`,
        styleDirection.trim() || "Not provided",
        ``,
        `Brand difference / positioning:`,
        brandNotes.trim() || "Not provided",
        ``,
        `Competitors / examples:`,
        competitors.trim() || "Not provided",
        ``,
        `Lead handling rules:`,
        `Preferred contact method: ${preferredContactMethod.trim() || "Not provided"}`,
        `Urgent lead rules: ${urgentLeadRules.trim() || "Not provided"}`,
        `Jobs / customers to reject: ${rejectedJobs.trim() || "Not provided"}`,
        `Areas not served: ${areasNotServed.trim() || "Not provided"}`,
        ``,
        `Website assistant rules:`,
        `Assistant can answer: ${aiCanAnswer.trim() || "Not provided"}`,
        `Assistant should never promise: ${aiNeverPromise.trim() || "Not provided"}`,
        `Escalation rules: ${escalationRules.trim() || "Not provided"}`,
        ``,
        `Targeted more info response:`,
        `Requested field: ${request.fieldLabel}`,
        `Requested info: ${request.requestedInfo}`,
        `Client answer: ${targetedAnswer}`,
        `Response date: ${new Date().toISOString()}`,
      ].join("\n");

      const updateResult = await supabase
        .from("clients")
        .update({
          monthly_price: selectedPlan.price,
          business_type: industry.trim() || "Website Client",
          service_area: locations.trim() || locationType,
          status: "intake_received",
          notes: setupReport,
        })
        .eq("id", client.id);

      if (updateResult.error) {
        setErrorMessage(`Client update failed: ${updateResult.error.message}`);
        return;
      }

      const approvalResult = await supabase.from("owner_approval_requests").insert({
        client_id: client.id,
        project_id: null,
        request_type: "website_setup_review",
        title: "Website setup targeted update",
        summary: `${client.business_name} answered a targeted setup request for ${request.fieldLabel}.`,
        recommended_action: setupReport,
        risk_level: "low",
        status: "pending",
      });

      if (approvalResult.error) {
        setErrorMessage(`Owner report failed: ${approvalResult.error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "client",
        action: "targeted_more_info_submitted",
        details: {
          requested_field_key: request.fieldKey,
          requested_field_label: request.fieldLabel,
          requested_info: request.requestedInfo,
          client_answer: targetedAnswer,
        },
      });

      setNotice("Requested update submitted. We will review your answer.");
      await loadClientPortalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown targeted update error";
      setErrorMessage(`Requested update failed: ${message}`);
    } finally {
      setIsSubmittingSetup(false);
    }
  }
  async function sendMessage() {
    setNotice("");
    setErrorMessage("");

    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("No client loaded yet.");
      return;
    }

    const cleanMessage = messageText.trim();

    if (!cleanMessage) {
      setErrorMessage("Type a message before sending.");
      return;
    }

    setIsSending(true);

    try {
      const messageResult = await supabase.rpc("send_client_portal_message", {
        message_text: cleanMessage,
      });

      if (messageResult.error) {
        setErrorMessage(`Message send failed: ${messageResult.error.message}`);
        return;
      }

      const resultData = messageResult.data as { message?: string } | null;

      setMessageText("");
      setNotice(resultData?.message || "Message sent to support.");
      await loadClientPortalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown send error";
      setErrorMessage(`Message send failed: ${message}`);
    } finally {
      setIsSending(false);
    }
  }

  async function uploadClientFile() {
    setNotice("");
    setErrorMessage("");

    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("No client loaded yet.");
      return;
    }

    if (!selectedFile) {
      setErrorMessage("Choose a file before uploading.");
      return;
    }

    setIsUploadingFile(true);

    try {
      const safeFileName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const filePath = `${client.id}/${Date.now()}-${safeFileName}`;

      const uploadResult = await supabase.storage
        .from("client-files")
        .upload(filePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: selectedFile.type || undefined,
        });

      if (uploadResult.error) {
        setErrorMessage(`File upload failed: ${uploadResult.error.message}`);
        return;
      }

      const fileRecordResult = await supabase.from("client_files").insert({
        client_id: client.id,
        bucket_id: "client-files",
        storage_path: filePath,
        file_name: selectedFile.name,
        file_type: selectedFile.type || null,
        file_size: selectedFile.size,
        status: "uploaded",
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (fileRecordResult.error) {
        setErrorMessage(`File record failed: ${fileRecordResult.error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "client",
        action: "client_file_uploaded",
        details: {
          file_name: selectedFile.name,
          file_path: filePath,
          file_size: selectedFile.size,
          file_type: selectedFile.type,
          expires_in_days: 30,
        },
      });

      setSelectedFile(null);
      setNotice("File uploaded to your website team.");
      await loadClientPortalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file upload error";
      setErrorMessage(`File upload failed: ${message}`);
    } finally {
      setIsUploadingFile(false);
    }
  }

  function normalizeDomainInput(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
  }

  function isValidDomainName(value: string) {
    return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(value);
  }

  async function submitDomainRequest() {
    setNotice("");
    setErrorMessage("");

    if (!supabase) {
      setErrorMessage("Supabase is not configured yet.");
      return;
    }

    if (!client) {
      setErrorMessage("No client loaded yet.");
      return;
    }

    const cleanDomain = normalizeDomainInput(domainName);
    const cleanRegistrar = domainRegistrar.trim();
    const cleanDnsProvider = domainDnsProvider.trim();
    const cleanNotes = domainNotes.trim();

    if (!cleanDomain) {
      setErrorMessage("Enter the domain name you want connected.");
      return;
    }

    if (!isValidDomainName(cleanDomain)) {
      setErrorMessage("Enter a valid domain like example.com.");
      return;
    }

    if (!domainOwnershipConfirmed) {
      setErrorMessage("Confirm that you own or control this domain before submitting.");
      return;
    }

    setIsSubmittingDomain(true);

    try {
      const domainResult = await supabase
        .from("client_domains")
        .insert({
          client_id: client.id,
          domain_name: cleanDomain,
          domain_type: "client_owned",
          status: "owner_review",
          registrar_name: cleanRegistrar || null,
          dns_provider: cleanDnsProvider || null,
          ownership_confirmed: domainOwnershipConfirmed,
          client_notes: cleanNotes || null,
        })
        .select("id")
        .single();

      if (domainResult.error) {
        setErrorMessage(`Domain request failed: ${domainResult.error.message}`);
        return;
      }

      const approvalText = [
        "NXQ DOMAIN CONNECTION REVIEW",
        "",
        `Client: ${client.business_name}`,
        `Domain: ${cleanDomain}`,
        "Domain type: client owned",
        "Status: owner review",
        `Registrar: ${cleanRegistrar || "Not provided"}`,
        `DNS provider: ${cleanDnsProvider || "Not provided"}`,
        `Ownership confirmed: ${domainOwnershipConfirmed ? "yes" : "no"}`,
        "",
        "Client notes:",
        cleanNotes || "No notes provided.",
        "",
        "Owner safety rule:",
        "Client owns this domain. NXQ may connect website hosting and provide DNS instructions, but NXQ must not take ownership of the domain.",
        "",
        "Recommended owner action:",
        "Approve the domain connection only if the domain looks correct for this client. Then provide DNS instructions or mark as waiting for DNS.",
      ].join("\n");

      const approvalResult = await supabase.from("owner_approval_requests").insert({
        client_id: client.id,
        project_id: project?.id || null,
        request_type: "domain_connection_review",
        title: "Domain connection review needed",
        summary: `${client.business_name} requested to connect ${cleanDomain}. Client confirmed they own/control the domain.`,
        recommended_action: approvalText,
        risk_level: "medium",
        status: "pending",
      });

      if (approvalResult.error) {
        setErrorMessage(`Domain approval request failed: ${approvalResult.error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "client",
        action: "domain_connection_requested",
        details: {
          domain_name: cleanDomain,
          registrar_name: cleanRegistrar || null,
          dns_provider: cleanDnsProvider || null,
        },
      });

      setNotice("Domain request submitted for review.");
      setDomainName("");
      setDomainRegistrar("");
      setDomainDnsProvider("");
      setDomainNotes("");
      setDomainOwnershipConfirmed(false);
      await loadClientPortalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown domain request error";
      setErrorMessage(`Domain request failed: ${message}`);
    } finally {
      setIsSubmittingDomain(false);
    }
  }

  useEffect(() => {
    loadClientPortalData();
  }, []);

  const hasDomainRequests = clientDomains.length > 0;
  const latestDomain = clientDomains[0] || null;
  const supportEmail = "websitedesignercontact@protonmail.com";
  const clientDecisionStatus = (client?.status || "").toLowerCase();
  const setupWasReopenedForMoreInfo =
    clientDecisionStatus === "intake_sent" &&
    Boolean(client?.notes?.includes("NXQ WEB WEBSITE SETUP REPORT"));
  const latestMoreInfoRequest = getLatestMoreInfoRequest(client?.notes);
  const targetedMoreInfoRequest = getLatestTargetedMoreInfoRequest(client?.notes);
  const targetedMoreInfoField = targetedMoreInfoRequest
    ? getTargetedFieldControl(targetedMoreInfoRequest)
    : null;
  const projectDecisionStatus = (projectStage || "").toLowerCase();

  const portalDecisionNotice = (() => {
    if (clientDecisionStatus === "denied") {
      return {
        tone: "danger",
        title: "Project not approved",
        body: `Your website setup was reviewed, but we are not able to approve this project at this time. If you believe this was a mistake or want to ask a follow-up question, contact ${supportEmail}.`,
      };
    }

    if (clientDecisionStatus === "needs_review" || clientDecisionStatus === "intake_received") {
      return {
        tone: "info",
        title: "Website setup under review",
        body: "We have received your website setup details. Your project is waiting for review before the build moves forward.",
      };
    }

    if (clientDecisionStatus === "intake_sent") {
      if (setupWasReopenedForMoreInfo) {
        return {
          tone: "warning",
          title: "More information needed",
          body: latestMoreInfoRequest ? `We requested: ${latestMoreInfoRequest}` : "Your setup sheet was reopened so you can update missing details before the project continues. Review the setup sheet below, add the requested information, and submit it again.",
        };
      }

      return {
        tone: "warning",
        title: "Website setup needed",
        body: "Complete your website setup sheet so we can review your project and prepare the build plan.",
      };
    }

    if (projectDecisionStatus === "frozen") {
      return {
        tone: "danger",
        title: "Website service paused",
        body: `This project is currently paused. Message support below or contact ${supportEmail} for help.`,
      };
    }

    if (projectDecisionStatus === "cancelled") {
      return {
        tone: "danger",
        title: "Project cancelled",
        body: `This website project is marked cancelled. Contact ${supportEmail} if you believe this needs to be reviewed.`,
      };
    }

    if (projectDecisionStatus === "in_review") {
      return {
        tone: "info",
        title: "Website is in review",
        body: "Your website is currently in review. We will message you if anything else is needed.",
      };
    }

    return null;
  })();

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Client Portal</p>
            <h1>Your website project hub</h1>
            <p className="subtle">
              Complete your website setup, message support, upload project content,
              and track your website stage.
            </p>
          </div>

          <div className="stat-card">
            <span>Project stage</span>
            <strong>{formatStatus(projectStage)}</strong>

            <button className="icon-btn" onClick={toggleNxqTheme} type="button">
              {nxqTheme === "dark" ? "Light mode" : "Dark mode"}
            </button>

            <button className="icon-btn" onClick={handleLogout} type="button">
              <LogOut size={16} />
              Log out
            </button>
          </div>
        </div>

        {errorMessage ? <div className="notice-card error">{errorMessage}</div> : null}
        {notice ? <div className="notice-card success">{notice}</div> : null}

        {portalDecisionNotice ? (
          <div className={`notice-card portal-decision-notice ${portalDecisionNotice.tone}`}>
            <strong>{portalDecisionNotice.title}</strong>
            <p>{portalDecisionNotice.body}</p>
          </div>
        ) : null}

        <div className="client-grid">
          {!setupComplete && targetedMoreInfoRequest && targetedMoreInfoField ? (
            <section className="panel panel-wide">
              <div className="panel-title">
                <Send size={20} />
                <h2>{targetedMoreInfoField.label}</h2>
              </div>

              <p className="subtle">{targetedMoreInfoRequest.requestedInfo}</p>

              <label className="auth-label" htmlFor="targeted-more-info-answer">
                {targetedMoreInfoField.label}
              </label>
              <textarea
                id="targeted-more-info-answer"
                onChange={(event) => targetedMoreInfoField.onChange(event.target.value)}
                placeholder={targetedMoreInfoField.placeholder}
                value={targetedMoreInfoField.value}
              />

              <button
                className="wide-btn"
                disabled={isSubmittingSetup || !client}
                onClick={() => submitTargetedMoreInfoUpdate(targetedMoreInfoRequest)}
                type="button"
              >
                {isSubmittingSetup ? "Submitting update..." : "Submit requested update"}
              </button>
            </section>
          ) : !setupComplete ? (
            <section className="panel panel-wide">
              <div className="panel-title">
                <Send size={20} />
                <h2>Website setup sheet</h2>
              </div>

              <p className="subtle">
                Your website team will use these details to prepare a brand-new upgraded website based on your business
                details, locations, services, style direction, and project goals.
              </p>

              <div className="package-grid">
                {(Object.keys(packageOptions) as PackageTier[]).map((tier) => {
                  const option = packageOptions[tier];
                  const isActive = selectedPackage === tier;

                  return (
                    <button
                      className={isActive ? "package-card active" : "package-card"}
                      key={tier}
                      onClick={() => setSelectedPackage(tier)}
                      type="button"
                    >
                      <strong>{option.label}</strong>
                      <span>${option.price}/mo</span>
                      <small>{option.description}</small>
                    </button>
                  );
                })}
              </div>

              <div className="setup-form-grid">
                <label>
                  <span>Company size</span>
                  <select
                    className="auth-input"
                    onChange={(event) => setCompanyScale(event.target.value)}
                    value={companyScale}
                  >
                    <option>Local business</option>
                    <option>Regional company</option>
                    <option>National company</option>
                    <option>Enterprise / large organization</option>
                  </select>
                </label>

                <label>
                  <span>Location setup</span>
                  <select
                    className="auth-input"
                    onChange={(event) => setLocationType(event.target.value)}
                    value={locationType}
                  >
                    <option>Single location</option>
                    <option>Multiple locations</option>
                    <option>Service areas / no storefront</option>
                    <option>National / online</option>
                  </select>
                </label>
              </div>

              <label className="auth-label" htmlFor="locations">
                Locations or service areas
              </label>
              <textarea
                id="locations"
                onChange={(event) => setLocations(event.target.value)}
                placeholder="Example: Sacramento CA, Roseville CA, Folsom CA, Elk Grove CA. For multi-location brands, list every location you want represented."
                value={locations}
              />

              <label className="auth-label" htmlFor="business-phone">
                Business phone
              </label>
              <input
                className="auth-input"
                id="business-phone"
                onChange={(event) => setBusinessPhone(event.target.value)}
                placeholder="Example: (555) 123-4567"
                value={businessPhone}
              />

              <label className="auth-label" htmlFor="business-email">
                Business email
              </label>
              <input
                className="auth-input"
                id="business-email"
                onChange={(event) => setBusinessEmail(event.target.value)}
                placeholder="Example: contact@business.com"
                value={businessEmail}
              />

              <label className="auth-label" htmlFor="business-address">
                Business address
              </label>
              <input
                className="auth-input"
                id="business-address"
                onChange={(event) => setBusinessAddress(event.target.value)}
                placeholder="Example: 123 Main St, Sacramento CA"
                value={businessAddress}
              />

              <label className="auth-label" htmlFor="business-hours">
                Business hours
              </label>
              <textarea
                id="business-hours"
                onChange={(event) => setBusinessHours(event.target.value)}
                placeholder="Example: Mon-Fri 8am-5pm, Saturday by appointment, Sunday closed."
                value={businessHours}
              />

              <label className="auth-label" htmlFor="emergency-availability">
                Emergency / after-hours availability
              </label>
              <textarea
                id="emergency-availability"
                onChange={(event) => setEmergencyAvailability(event.target.value)}
                placeholder="Example: 24/7 emergency jobs, after-hours calls only, no emergency service, weekend availability, etc."
                value={emergencyAvailability}
              />

              <label className="auth-label" htmlFor="industry">
                Industry
              </label>
              <input
                className="auth-input"
                id="industry"
                onChange={(event) => setIndustry(event.target.value)}
                placeholder="Example: Tree service, dental office, restaurant group, enterprise retail, security company"
                value={industry}
              />

              <label className="auth-label" htmlFor="services">
                Services/products the website needs to explain
              </label>
              <textarea
                id="services"
                onChange={(event) => setServices(event.target.value)}
                placeholder="List services, products, departments, offers, or categories that need to appear on the website."
                value={services}
              />

              <label className="auth-label" htmlFor="pages-needed">
                Pages or sections needed
              </label>
              <textarea
                id="pages-needed"
                onChange={(event) => setPagesNeeded(event.target.value)}
                placeholder="Example: Home, About, Services, Locations, Gallery, Reviews, Contact, Quote Request, Careers, FAQ."
                value={pagesNeeded}
              />

              <label className="auth-label" htmlFor="style-direction">
                Website style direction
              </label>
              <textarea
                id="style-direction"
                onChange={(event) => setStyleDirection(event.target.value)}
                placeholder="Example: premium, modern, dark, luxury, clean, bold, trustworthy, local, corporate, high-end."
                value={styleDirection}
              />

              <label className="auth-label" htmlFor="brand-notes">
                What makes this business different?
              </label>
              <textarea
                id="brand-notes"
                onChange={(event) => setBrandNotes(event.target.value)}
                placeholder="Tell us what makes the company better, more trusted, faster, safer, more premium, or different from competitors."
                value={brandNotes}
              />

              <label className="auth-label" htmlFor="competitors">
                Competitors, examples, or websites you like
              </label>
              <textarea
                id="competitors"
                onChange={(event) => setCompetitors(event.target.value)}
                placeholder="Optional: list competitor websites, inspiration sites, or styles you like."
                value={competitors}
              />

              <div className="setup-section-divider">
                <span>Lead handling rules</span>
                <p>Tell us how your website should handle real customers, quote requests, and urgent leads.</p>
              </div>

              <label className="auth-label" htmlFor="preferred-contact-method">
                Preferred contact method
              </label>
              <textarea
                id="preferred-contact-method"
                onChange={(event) => setPreferredContactMethod(event.target.value)}
                placeholder="Example: Call first, text for quick questions, email for estimates, send all quote requests through the website form."
                value={preferredContactMethod}
              />

              <label className="auth-label" htmlFor="urgent-lead-rules">
                What counts as urgent?
              </label>
              <textarea
                id="urgent-lead-rules"
                onChange={(event) => setUrgentLeadRules(event.target.value)}
                placeholder="Example: Storm damage, emergency removals, same-day bookings, large commercial jobs, safety issues, high-budget requests."
                value={urgentLeadRules}
              />

              <label className="auth-label" htmlFor="rejected-jobs">
                Jobs or customers to reject
              </label>
              <textarea
                id="rejected-jobs"
                onChange={(event) => setRejectedJobs(event.target.value)}
                placeholder="Example: We do not take tiny jobs under $300, no out-of-state work, no unsafe requests, no free estimates outside service area."
                value={rejectedJobs}
              />

              <label className="auth-label" htmlFor="areas-not-served">
                Areas not served
              </label>
              <textarea
                id="areas-not-served"
                onChange={(event) => setAreasNotServed(event.target.value)}
                placeholder="Example: We do not serve Chico, Bay Area, out-of-county jobs, or locations more than 50 miles away."
                value={areasNotServed}
              />

              <div className="setup-section-divider">
                <span>Website assistant rules</span>
                <p>These rules help your website team prepare the future website assistant so it knows what it can say safely.</p>
              </div>

              <label className="auth-label" htmlFor="ai-can-answer">
                What can the website assistant answer?
              </label>
              <textarea
                id="ai-can-answer"
                onChange={(event) => setAiCanAnswer(event.target.value)}
                placeholder="Example: Services, hours, service areas, booking steps, basic pricing ranges, warranty info, financing steps, common FAQs."
                value={aiCanAnswer}
              />

              <label className="auth-label" htmlFor="ai-never-promise">
                What should it never promise?
              </label>
              <textarea
                id="ai-never-promise"
                onChange={(event) => setAiNeverPromise(event.target.value)}
                placeholder="Example: Never promise exact prices, same-day availability, legal/medical/financial advice, guaranteed approval, or final quotes without owner review."
                value={aiNeverPromise}
              />

              <label className="auth-label" htmlFor="escalation-rules">
                When should it escalate to support or the owner?
              </label>
              <textarea
                id="escalation-rules"
                onChange={(event) => setEscalationRules(event.target.value)}
                placeholder="Example: Escalate angry customers, refund questions, large contracts, urgent safety issues, custom quotes, unclear requests, or anything outside normal services."
                value={escalationRules}
              />

              <div className="agreement-box">
                <label>
                  <input
                    checked={agreementAccepted}
                    onChange={(event) => setAgreementAccepted(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I acknowledge and agree that my website team will use the information I
                    submit to prepare a brand-new website project. I understand that
                    agreement acceptance and billing activation are required before
                    final website access/live service.
                  </span>
                </label>

                <label className="auth-label" htmlFor="typed-signature">
                  Typed signature
                </label>
                <input
                  className="auth-input"
                  id="typed-signature"
                  onChange={(event) => setTypedSignature(event.target.value)}
                  placeholder="Type your full name"
                  value={typedSignature}
                />
              </div>

              <button
                className="wide-btn"
                disabled={isSubmittingSetup || !client}
                onClick={submitWebsiteSetup}
                type="button"
              >
                {isSubmittingSetup ? "Submitting setup..." : "Submit website setup"}
              </button>
            </section>
          ) : (
            <section className="panel panel-wide setup-complete-card">
              <div className="panel-title">
                <CheckCircle2 size={20} />
                <h2>Website setup submitted</h2>
              </div>

              <p className="subtle">
                Your website setup sheet has been submitted for review. The
                setup form is now out of the way, and this portal will focus on
                project messages, files, approvals, and progress updates.
              </p>
            </section>
          )}

          <section className="panel panel-wide domain-panel">
            <div className="panel-title">
              <CheckCircle2 size={20} />
              <h2>Domain setup</h2>
            </div>

            {!hasDomainRequests ? (
              <div className="domain-connect-card">
                <div className="domain-connect-copy">
                  <strong>Connect a domain you own</strong>
                  <p>
                    Add the domain you want connected to your website. We can help with
                    setup, but you keep ownership and can repoint it later.
                  </p>
                </div>

                <div className="domain-form-grid">
                  <label className="domain-field">
                    <span>Domain name</span>
                    <input
                      placeholder="example.com"
                      value={domainName}
                      onChange={(event) => setDomainName(event.target.value)}
                    />
                  </label>

                  <label className="domain-field">
                    <span>Registrar</span>
                    <input
                      placeholder="Namecheap, GoDaddy, Cloudflare..."
                      value={domainRegistrar}
                      onChange={(event) => setDomainRegistrar(event.target.value)}
                    />
                  </label>

                  <label className="domain-field">
                    <span>DNS provider</span>
                    <input
                      placeholder="Cloudflare, GoDaddy DNS, Namecheap DNS..."
                      value={domainDnsProvider}
                      onChange={(event) => setDomainDnsProvider(event.target.value)}
                    />
                  </label>

                  <label className="domain-field domain-field-wide">
                    <span>Domain notes</span>
                    <textarea
                      placeholder="Tell us if this domain already has email, a live website, or special DNS setup."
                      value={domainNotes}
                      onChange={(event) => setDomainNotes(event.target.value)}
                    />
                  </label>
                </div>

                <label className="domain-ownership-box">
                  <input
                    checked={domainOwnershipConfirmed}
                    onChange={(event) => setDomainOwnershipConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I confirm I own or control this domain. I understand support can help connect
                    the website, but I keep ownership and can repoint the domain later.
                  </span>
                </label>

                <button
                  className="wide-btn"
                  disabled={isSubmittingDomain || !client}
                  onClick={submitDomainRequest}
                  type="button"
                >
                  {isSubmittingDomain ? "Submitting domain..." : "Submit domain request"}
                </button>
              </div>
            ) : (
              <div className="domain-summary-card">
                <strong>Domain request received</strong>
                <p>
                  The full form is collapsed so this portal stays clean. We will review
                  your domain request and place DNS instructions below when ready.
                </p>
              </div>
            )}

            <div className="domain-status-list">
              {clientDomains.length === 0 ? (
                <div className="empty-state">No domain requests yet.</div>
              ) : null}

              {clientDomains.map((domain) => (
                <article className="domain-status-card" key={domain.id}>
                  <div className="domain-status-top">
                    <strong>{domain.domain_name}</strong>
                    <span>{formatStatus(domain.status)}</span>
                  </div>

                  <p className="domain-meta">
                    Registrar: {domain.registrar_name || "Not provided"} · DNS:{" "}
                    {domain.dns_provider || "Not provided"}
                  </p>

                  {domain.dns_instructions ? (
                    <p className="domain-instructions">{domain.dns_instructions}</p>
                  ) : (
                    <p className="domain-instructions">
                      Waiting for review / DNS instructions.
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="panel panel-wide client-settings-panel">
            <div className="panel-title">
              <CheckCircle2 size={20} />
              <h2>Settings</h2>
            </div>

            <div className="settings-grid">
              <article className="settings-card">
                <span>Account</span>
                <strong>{client?.business_name || "Client account"}</strong>
                <p>Account profile connected.</p>
                <small>Project stage: {formatStatus(projectStage)}</small>
              </article>

              <article className="settings-card">
                <span>Appearance</span>
                <strong>{nxqTheme === "dark" ? "Dark mode" : "Light mode"}</strong>
                <p>Switch the portal theme anytime. Your choice stays saved on this device.</p>
                <button className="icon-btn" onClick={toggleNxqTheme} type="button">
                  {nxqTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                </button>
              </article>

              <article className="settings-card">
                <span>Domain</span>
                <strong>{latestDomain?.domain_name || "No domain connected yet"}</strong>
                <p>
                  {latestDomain
                    ? `Status: ${formatStatus(latestDomain.status)}. We can help connect the website, but you keep ownership of the domain.`
                    : "Add a domain in the Domain setup section above when you are ready."}
                </p>
                <small>
                  {latestDomain?.dns_provider
                    ? `DNS provider: ${latestDomain.dns_provider}`
                    : "Domain management lives here after setup."}
                </small>
              </article>

              <article className="settings-card">
                <span>Security</span>
                <strong>Email and password</strong>
                <p>
                  Email/password changes are coming in the next security update. For now, contact support if you need account help.
                </p>
                <div className="settings-button-row">
                  <button className="settings-disabled-btn" disabled type="button">Change email soon</button>
                  <button className="settings-disabled-btn" disabled type="button">Change password soon</button>
                </div>
              </article>

              <article className="settings-card settings-card-wide">
                <span>Support</span>
                <strong>Need help?</strong>
                <p>
                  Message support below, or contact support at{" "}
                  <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
                </p>
              </article>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title panel-title-row">
              <div className="panel-title">
                <MessageCircle size={20} />
                <h2>Message support</h2>
              </div>

              <button className="icon-btn" onClick={loadClientPortalData} type="button">
                <RefreshCcw size={16} />
                Refresh
              </button>
            </div>

            <p className="subtle">
              {client
                ? `Sending as ${client.business_name}.`
                : isLoading
                  ? "Loading client..."
                  : "No client loaded."}
            </p>

            <textarea
              placeholder="Type your message here..."
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
            />

            <button
              className="wide-btn"
              disabled={isSending || !client}
              onClick={sendMessage}
              type="button"
            >
              {isSending ? "Sending..." : "Send message"}
            </button>
          </section>

          <section className="panel">
            <div className="panel-title">
              <UploadCloud size={20} />
              <h2>Upload files</h2>
            </div>

            <p className="subtle">
              Upload logos, business photos, reviews, service images, and content for your website.
            </p>

            <div className="upload-box">
              <ImagePlus size={30} />

              <input
                className="auth-input"
                type="file"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
              />

              <span>
                {selectedFile
                  ? `Ready to upload: ${selectedFile.name}`
                  : "Choose a logo, photo, review, screenshot, or content file."}
              </span>

              <button
                className="wide-btn"
                disabled={isUploadingFile || !selectedFile || !client}
                onClick={uploadClientFile}
                type="button"
              >
                {isUploadingFile ? "Uploading file..." : "Upload file"}
              </button>
            </div>

            <div className="message-list">
              {uploadedFiles.length === 0 ? (
                <div className="empty-state">No files uploaded yet.</div>
              ) : null}

              {uploadedFiles.map((file) => (
                <article className="message-card" key={file.id}>
                  <div className="message-card-top">
                    <strong>{file.file_name}</strong>
                    <span>
                      {new Date(file.uploaded_at).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>

                  <p>Status: {formatStatus(file.status)}</p>

                  <small>
                    Expires{" "}
                    {new Date(file.expires_at).toLocaleDateString([], {
                      dateStyle: "medium",
                    })}
                  </small>
                </article>
              ))}
            </div>
          </section>

          <section className="panel panel-wide">
            <h2>Recent messages</h2>

            <div className="message-list">
              {messages.length === 0 ? (
                <div className="empty-state">
                  No messages yet. Send one above to test the client portal.
                </div>
              ) : null}

              {messages.map((message) => {
                const senderLabel =
                  message.sender_type === "client" ? "You" : "Support";

                const statusLabel =
                  message.sender_type === "client" ? "Sent" : "Received";

                return (
                  <article className="message-card" key={message.id}>
                    <div className="message-card-top">
                      <strong>{senderLabel}</strong>
                      <span>
                        {new Date(message.created_at).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>

                    <p>{message.message}</p>

                    <small>{statusLabel}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel panel-wide">
            <h2>Project tracker</h2>
            <div className="tracker">
              <span className={client?.status === "lead" ? "active" : ""}>Lead</span>
              <span className={client?.status === "intake_received" ? "active" : ""}>
                Setup submitted
              </span>
              <span className={client?.status === "needs_review" ? "active" : ""}>
                Owner Review
              </span>
              <span className={projectStage === "planning" ? "active" : ""}>Planning</span>
              <span className={projectStage === "building" ? "active" : ""}>Building</span>
              <span className={projectStage === "live" ? "active" : ""}>Live</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}



















