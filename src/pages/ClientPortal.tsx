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
import { ClientWebsiteSecurity } from "../components/ClientWebsiteSecurity";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import type { ClientLaunchJourney } from "../lib/clientJourney";

type ClientRow = {
  id: string;
  business_name: string;
  status: string;
  billing_status: string;
  billing_provider: string | null;
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
  expires_at: string | null;
};

type ClientDomainRow = {
  id: string;
  domain_name: string;
  status: string;
  dns_provider: string | null;
  registrar_name: string | null;
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
      "Premium 1-3 page website",
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
  const [journey, setJourney] = useState<ClientLaunchJourney | null>(null);
  const [messages, setMessages] = useState<ClientMessageRow[]>([]);
  const [messageHasMore, setMessageHasMore] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
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

  const signedSetupSubmitted = client ? parseClientSetupReport(client.notes).size > 0 : false;
  const setupComplete = client
    ? completedSetupStatuses.includes(client.status) || signedSetupSubmitted
    : false;
  const rawProjectStage = project?.website_status || client?.status || "loading";
  const projectStage = journey?.stage_key || rawProjectStage;
  const projectStageLabel = journey?.stage_title || formatStatus(rawProjectStage);

  function formatStatus(status: string) {
    return status.replaceAll("_", " ");
  }

  async function handleLogout() {
    if (!supabase) return;

    await Promise.race([
      supabase.auth.signOut(),
      new Promise((resolve) => window.setTimeout(resolve, 800)),
    ]);

    window.location.replace("/portal/login");
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
        .select("id, business_name, status, billing_status, billing_provider, monthly_price, notes")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (clientResult.error) {
        setErrorMessage(`Client load failed: ${clientResult.error.message}`);
        setClient(null);
        setProject(null);
        setJourney(null);
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
        setJourney(null);
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

      const journeyResult = await supabase.rpc("current_client_launch_journey");
      if (journeyResult.error) {
        setErrorMessage(`Project journey load failed: ${journeyResult.error.message}`);
        setJourney(null);
      } else {
        setJourney((journeyResult.data as ClientLaunchJourney) || null);
      }

      const messageResult = await supabase.rpc("current_client_message_page", {
        target_limit: 50,
        target_cursor_created_at: null,
        target_cursor_id: null,
      });

      if (messageResult.error) {
        setErrorMessage(`Message load failed: ${messageResult.error.message}`);
        setMessages([]);
      } else {
        const messagePage = (messageResult.data || []) as ClientMessageRow[];
        setMessages(messagePage);
        setMessageHasMore(messagePage.length === 50);
      }

      const fileListResult = await supabase.rpc("current_client_file_page", {
        target_limit: 50,
        target_cursor_uploaded_at: null,
        target_cursor_id: null,
      });

      if (fileListResult.error) {
        setErrorMessage(`File list load failed: ${fileListResult.error.message}`);
        setUploadedFiles([]);
      } else {
        setUploadedFiles((fileListResult.data || []) as UploadedFileRow[]);
      }

      const domainResult = await supabase.rpc("current_client_domain_page", {
        target_limit: 50,
        target_cursor_requested_at: null,
        target_cursor_id: null,
      });

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

      const setupResult = await supabase.rpc("submit_current_client_website_setup", {
        target_setup_report: setupReport,
        target_tier_key: selectedPackage,
        target_business_type: cleanIndustry,
        target_service_area: cleanLocations || locationType,
        target_submission_kind: isMoreInfoResubmission ? "resubmission" : "initial",
        target_requested_field_key: null,
        target_requested_field_label: null,
        target_requested_info: previousMoreInfoRequest || null,
        target_client_answer: null,
      });

      if (setupResult.error) {
        setErrorMessage(`Website setup failed: ${setupResult.error.message}`);
        return;
      }

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
          `Assistant should never proã®ü¶‰žËkºwµçUˆ¤ì(€€€€€É•ÑÕÉ¸€‰e½ÕÈ‘½µ…¥¸¥Ì½¹¹•Ñ•Ñ¼å½ÕÈÝ•‰Í¥Ñ”¸ˆì(€€€ô((€€€¥˜€¡¹½Éµ…±¥é•‘MÑ…ÑÕÌ€ôôô€‰™…¥±•ˆ¤ì(€€€€€É•ÑÕÉ¸€‰Q¡¥Ì‘½µ…¥¸É•ÅÕ•ÍÐ¹••‘Ì…ÑÑ•¹Ñ¥½¸¸5•ÍÍ…”ÍÕÁÁ½ÉÐ½È¡•¬Ñ¡”¹½Ñ•Ì‰•±½Ü¸ˆì(€€€ô((€€€É•ÑÕÉ¸€‰]”É••¥Ù•å½ÕÈ‘½µ…¥¸É•ÅÕ•ÍÐ…¹Ý¥±°Á±…”ÕÁ‘…Ñ•Ì‰•±½Ü¸ˆì(€ô(€…Íå¹Œ™Õ¹Ñ¥½¸ÍÕ‰µ¥Ñ½µ…¥¹I•ÅÕ•ÍÐ ¤ì(€€€Í•Ñ9½Ñ¥” ˆˆ¤ì(€€€Í•ÑÉÉ½É5•ÍÍ…” ˆˆ¤ì((€€€¥˜€ …ÍÕÁ…‰…Í”¤ì(€€€€€Í•ÑÉÉ½É5•ÍÍ…” ‰MÕÁ…‰…Í”¥Ì¹½Ð½¹™¥ÕÉ•å•Ð¸ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€¥˜€ …±¥•¹Ð¤ì(€€€€€Í•ÑÉÉ½É5•ÍÍ…” ‰9¼±¥•¹Ð±½…‘•å•Ð¸ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€½¹ÍÐ±•…¹½µ…¥¸€ô¹½Éµ…±¥é•½µ…¥¹%¹ÁÕÐ¡‘½µ…¥¹9…µ”¤ì(€€€½¹ÍÐ±•…¹I•¥ÍÑÉ…È€ô‘½µ…¥¹I•¥ÍÑÉ…È¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ±•…¹¹ÍAÉ½Ù¥‘•È€ô‘½µ…¥¹¹ÍAÉ½Ù¥‘•È¹ÑÉ¥´ ¤ì(€€€½¹ÍÐ±•…¹9½Ñ•Ì€ô‘½µ…¥¹9½Ñ•Ì¹ÑÉ¥´ ¤ì((€€€¥˜€ …±•…¹½µ…¥¸¤ì(€€€€€Í•ÑÉÉ½É5•ÍÍ…” ‰¹Ñ•ÈÑ¡”‘½µ…¥¸¹…µ”å½ÔÝ…¹Ð½¹¹•Ñ•¸ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€¥˜€ …¥ÍY…±¥‘½µ…¥¹9…µ”¡±•…¹½µ…¥¸¤¤ì(€€€€€Í•ÑÉÉ½É5•ÍÍ…” ‰¹Ñ•È„Ù…±¥‘½µ…¥¸±¥­”•á…µÁ±”¹½´¸ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€¥˜€ …‘½µ…¥¹=Ý¹•ÉÍ¡¥Á½¹™¥Éµ•¤ì(€€€€€Í•ÑÉÉ½É5•ÍÍ…” ‰½¹™¥É´Ñ¡…Ðå½Ô½Ý¸½È½¹ÑÉ½°Ñ¡¥Ì‘½µ…¥¸‰•™½É”ÍÕ‰µ¥ÑÑ¥¹œ¸ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€Í•Ñ%ÍMÕ‰µ¥ÑÑ¥¹½µ…¥¸¡ÑÉÕ”¤ì((€€€ÑÉäì(€€€€€½¹ÍÐ‘½µ…¥¹I•ÍÕ±Ð€ô…Ý…¥ÐÍÕÁ…‰…Í”¹ÉÁŒ ‰ÍÕ‰µ¥Ñ}‘½µ…¥¹}½¹¹•Ñ¥½¹}É•ÅÕ•ÍÐˆ°ì(€€€€€€€É•ÅÕ•ÍÑ•‘}‘½µ…¥¹}¹…µ”è±•…¹½µ…¥¸°(€€€€€€€É•ÅÕ•ÍÑ•‘}É•¥ÍÑÉ…É}¹…µ”è±•…¹I•¥ÍÑÉ…Èñð¹Õ±°°(€€€€€€€É•ÅÕ•ÍÑ•‘}‘¹Í}ÁÉ½Ù¥‘•Èè±•…¹¹ÍAÉ½Ù¥‘•Èñð¹Õ±°°(€€€€€€€É•ÅÕ•ÍÑ•‘}±¥•¹Ñ}¹½Ñ•Ìè±•…¹9½Ñ•Ìñð¹Õ±°°(€€€€€€€½Ý¹•ÉÍ¡¥Á}½¹™¥Éµ•è‘½µ…¥¹=Ý¹•ÉÍ¡¥Á½¹™¥Éµ•°(€€€€€ô¤ì((€€€€€¥˜€¡‘½µ…¥¹I•ÍÕ±Ð¹•ÉÉ½È¤ì(€€€€€€€Í•ÑÉÉ½É5•ÍÍ…”¡½µ…¥¸É•ÅÕ•ÍÐ™…¥±•è€‘í‘½µ…¥¹I•ÍÕ±Ð¹•ÉÉ½È¹µ•ÍÍ…•õ€¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€½¹ÍÐÉ•ÍÕ±Ñ…Ñ„€ô‘½µ…¥¹I•ÍÕ±Ð¹‘…Ñ„…Ììµ•ÍÍ…”üèÍÑÉ¥¹œôð¹Õ±°ì((€€€€€Í•Ñ9½Ñ¥”¡É•ÍÕ±Ñ…Ñ„ü¹µ•ÍÍ…”ñð€‰½µ…¥¸É•ÅÕ•ÍÐÍÕ‰µ¥ÑÑ•™½ÈÉ•Ù¥•Ü¸ˆ¤ì(€€€€€Í•Ñ½µ…¥¹9…µ” ˆˆ¤ì(€€€€€Í•Ñ½µ…¥¹I•¥ÍÑÉ…È ˆˆ¤ì(€€€€€Í•Ñ½µ…¥¹¹ÍAÉ½Ù¥‘•È ˆˆ¤ì(€€€€€Í•Ñ½µ…¥¹9½Ñ•Ì ˆˆ¤ì(€€€€€Í•Ñ½µ…¥¹=Ý¹•ÉÍ¡¥Á½¹™¥Éµ•¡™…±Í”¤ì(€€€€€…Ý…¥Ð±½…‘±¥•¹ÑA½ÉÑ…±…Ñ„ ¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹ÍÐµ•ÍÍ…”€ô•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È€ü•ÉÉ½È¹µ•ÍÍ…”€è€‰U¹­¹½Ý¸‘½µ…¥¸É•ÅÕ•ÍÐ•ÉÉ½Èˆì(€€€€€Í•ÑÉÉ½É5•ÍÍ…”¡½µ…¥¸É•ÅÕ•ÍÐ™…¥±•è€‘íµ•ÍÍ…•õ€¤ì(€€€ô™¥¹…±±äì(€€€€€Í•Ñ%ÍMÕ‰µ¥ÑÑ¥¹½µ…¥¸¡™…±Í”¤ì(€€€ô(€ô((€ÕÍ•™™•Ð  ¤€ôøì(€€€±½…‘±¥•¹ÑA½ÉÑ…±…Ñ„ ¤ì(€ô°mt¤ì((€½¹ÍÐ¡…Í½µ…¥¹I•ÅÕ•ÍÑÌ€ô±¥•¹Ñ½µ…¥¹Ì¹±•¹Ñ €ø€Àì(€½¹ÍÐ±…Ñ•ÍÑ½µ…¥¸€ô±¥•¹Ñ½µ…¥¹ÍlÁtñð¹Õ±°ì(€½¹ÍÐÍÕÁÁ½ÉÑµ…¥°€ô€‰Ý•‰Í¥Ñ•‘•Í¥¹•É½¹Ñ…ÑÁÉ½Ñ½¹µ…¥°¹½´ˆì(€½¹ÍÐ±¥•¹Ñ•¥Í¥½¹MÑ…ÑÕÌ€ô€¡±¥•¹Ðü¹ÍÑ…ÑÕÌñð€ˆˆ¤¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐÍ•ÑÕÁ]…ÍI•½Á•¹•‘½É5½É•%¹™¼€ô(€€€±¥•¹Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰¥¹Ñ…­•}Í•¹Ðˆ€˜˜(€€€	½½±•…¸¡±¥•¹Ðü¹¹½Ñ•Ìü¹¥¹±Õ‘•Ì ‰9aD]]	M%QMQU@IA=IPˆ¤¤ì(€½¹ÍÐ±…Ñ•ÍÑ5½É•%¹™½I•ÅÕ•ÍÐ€ô•Ñ1…Ñ•ÍÑ5½É•%¹™½I•ÅÕ•ÍÐ¡±¥•¹Ðü¹¹½Ñ•Ì¤ì(€½¹ÍÐÑ…É•Ñ•‘5½É•%¹™½I•ÅÕ•ÍÐ€ô•Ñ1…Ñ•ÍÑQ…É•Ñ•‘5½É•%¹™½I•ÅÕ•ÍÐ¡±¥•¹Ðü¹¹½Ñ•Ì¤ì(€½¹ÍÐÑ…É•Ñ•‘5½É•%¹™½¥•±€ôÑ…É•Ñ•‘5½É•%¹™½I•ÅÕ•ÍÐ(€€€€ü•ÑQ…É•Ñ•‘¥•±‘½¹ÑÉ½°¡Ñ…É•Ñ•‘5½É•%¹™½I•ÅÕ•ÍÐ¤(€€€€è¹Õ±°ì(€½¹ÍÐÁÉ½©•Ñ•¥Í¥½¹MÑ…ÑÕÌ€ô€¡É…ÝAÉ½©•ÑMÑ…”ñð€ˆˆ¤¹Ñ½1½Ý•É…Í” ¤ì(€½¹ÍÐÁ½ÉÑ…±•¥Í¥½¹9½Ñ¥”€ô€  ¤€ôøì(€€€¥˜€¡±¥•¹Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰‘•¹¥•ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ½¹”è€‰‘…¹•Èˆ°(€€€€€€€Ñ¥Ñ±”è€‰AÉ½©•Ð¹½Ð…ÁÁÉ½Ù•ˆ°(€€€€€€€‰½‘äèe½ÕÈÝ•‰Í¥Ñ”Í•ÑÕÀÝ…ÌÉ•Ù¥•Ý•°‰ÕÐÝ”…É”¹½Ð…‰±”Ñ¼…ÁÁÉ½Ù”Ñ¡¥ÌÁÉ½©•Ð…ÐÑ¡¥ÌÑ¥µ”¸%˜å½Ô‰•±¥•Ù”Ñ¡¥ÌÝ…Ì„µ¥ÍÑ…­”½ÈÝ…¹ÐÑ¼…Í¬„™½±±½ÜµÕÀÅÕ•ÍÑ¥½¸°½¹Ñ…Ð€‘íÍÕÁÁ½ÉÑµ…¥±ô¹€°(€€€€€ôì(€€€ô((€€€¥˜€¡±¥•¹Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰¹••‘Í}É•Ù¥•Üˆñð±¥•¹Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰¥¹Ñ…­•}É••¥Ù•ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ½¹”è€‰¥¹™¼ˆ°(€€€€€€€Ñ¥Ñ±”è€‰]•‰Í¥Ñ”Í•ÑÕÀÕ¹‘•ÈÉ•Ù¥•Üˆ°(€€€€€€€‰½‘äè€‰]”¡…Ù”É••¥Ù•å½ÕÈÝ•‰Í¥Ñ”Í•ÑÕÀ‘•Ñ…¥±Ì¸e½ÕÈÁÉ½©•Ð¥ÌÝ…¥Ñ¥¹œ™½ÈÉ•Ù¥•Ü‰•™½É”Ñ¡”‰Õ¥±µ½Ù•Ì™½ÉÝ…É¸ˆ°(€€€€€ôì(€€€ô((€€€¥˜€¡±¥•¹Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰¥¹Ñ…­•}Í•¹Ðˆ¤ì(€€€€€¥˜€¡Í•ÑÕÁ]…ÍI•½Á•¹•‘½É5½É•%¹™¼¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€Ñ½¹”è€‰Ý…É¹¥¹œˆ°(€€€€€€€€€Ñ¥Ñ±”è€‰5½É”¥¹™½Éµ…Ñ¥½¸¹••‘•ˆ°(€€€€€€€€€‰½‘äè±…Ñ•ÍÑ5½É•%¹™½I•ÅÕ•ÍÐ€ü]”É•ÅÕ•ÍÑ•è€‘í±…Ñ•ÍÑ5½É•%¹™½I•ÅÕ•ÍÑõ€€è€‰e½ÕÈÍ•ÑÕÀÍ¡••ÐÝ…ÌÉ•½Á•¹•Í¼å½Ô…¸ÕÁ‘…Ñ”µ¥ÍÍ¥¹œ‘•Ñ…¥±Ì‰•™½É”Ñ¡”ÁÉ½©•Ð½¹Ñ¥¹Õ•Ì¸I•Ù¥•ÜÑ¡”Í•ÑÕÀÍ¡••Ð‰•±½Ü°…‘Ñ¡”É•ÅÕ•ÍÑ•¥¹™½Éµ…Ñ¥½¸°…¹ÍÕ‰µ¥Ð¥Ð……¥¸¸ˆ°(€€€€€€€ôì(€€€€€ô((€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ½¹”è€‰Ý…É¹¥¹œˆ°(€€€€€€€Ñ¥Ñ±”è€‰]•‰Í¥Ñ”Í•ÑÕÀ¹••‘•ˆ°(€€€€€€€‰½‘äè€‰½µÁ±•Ñ”å½ÕÈÝ•‰Í¥Ñ”Í•ÑÕÀÍ¡••ÐÍ¼Ý”…¸É•Ù¥•Üå½ÕÈÁÉ½©•Ð…¹ÁÉ•Á…É”Ñ¡”‰Õ¥±Á±…¸¸ˆ°(€€€€€ôì(€€€ô((€€€¥˜€¡ÁÉ½©•Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰™É½é•¸ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ½¹”è€‰‘…¹•Èˆ°(€€€€€€€Ñ¥Ñ±”è€‰]•‰Í¥Ñ”Í•ÉÙ¥”Á…ÕÍ•ˆ°(€€€€€€€‰½‘äèQ¡¥ÌÁÉ½©•Ð¥ÌÕÉÉ•¹Ñ±äÁ…ÕÍ•¸5•ÍÍ…”ÍÕÁÁ½ÉÐ‰•±½Ü½È½¹Ñ…Ð€‘íÍÕÁÁ½ÉÑµ…¥±ô™½È¡•±À¹€°(€€€€€ôì(€€€ô((€€€¥˜€¡ÁÉ½©•Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰…¹•±±•ˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ½¹”è€‰‘…¹•Èˆ°(€€€€€€€Ñ¥Ñ±”è€‰AÉ½©•Ð…¹•±±•ˆ°(€€€€€€€‰½‘äèQ¡¥ÌÝ•‰Í¥Ñ”ÁÉ½©•Ð¥Ìµ…É­•…¹•±±•¸½¹Ñ…Ð€‘íÍÕÁÁ½ÉÑµ…¥±ô¥˜å½Ô‰•±¥•Ù”Ñ¡¥Ì¹••‘ÌÑ¼‰”É•Ù¥•Ý•¹€°(€€€€€ôì(€€€ô((€€€¥˜€¡ÁÉ½©•Ñ•¥Í¥½¹MÑ…ÑÕÌ€ôôô€‰¥¹}É•Ù¥•Üˆ¤ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€Ñ½¹”è€‰¥¹™¼ˆ°(€€€€€€€Ñ¥Ñ±”è€‰]•‰Í¥Ñ”¥Ì¥¸É•Ù¥•Üˆ°(€€€€€€€‰½‘äè€‰e½ÕÈÝ•‰Í¥Ñ”¥ÌÕÉÉ•¹Ñ±ä¥¸É•Ù¥•Ü¸]”Ý¥±°µ•ÍÍ…”å½Ô¥˜…¹åÑ¡¥¹œ•±Í”¥Ì¹••‘•¸ˆ°(€€€€€ôì(€€€ô((€€€É•ÑÕÉ¸¹Õ±°ì(€ô¤ ¤ì((€É•ÑÕÉ¸€ (€€€€ñµ…¥¸±…ÍÍ9…µ”ô‰¹áÄµÁ…”ˆø(€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á½ÉÑ…°µÍ¡•±°ˆø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á½ÉÑ…°µ¡•…‘•Èˆø(€€€€€€€€€€ñ‘¥Øø(€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰•å•‰É½Üˆù±¥•¹ÐA½ÉÑ…°ð½Àø(€€€€€€€€€€€€ñ Äùe½ÕÈÝ•‰Í¥Ñ”ÁÉ½©•Ð¡Õˆð½ Äø(€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ±”ˆø(€€€€€€€€€€€€€½µÁ±•Ñ”å½ÕÈÝ•‰Í¥Ñ”Í•ÑÕÀ°µ•ÍÍ…”ÍÕÁÁ½ÉÐ°ÕÁ±½…ÁÉ½©•Ð½¹Ñ•¹Ð°(€€€€€€€€€€€€€…¹ÑÉ…¬å½ÕÈÝ•‰Í¥Ñ”ÍÑ…”¸(€€€€€€€€€€€€ð½Àø(€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÍÑ…Ðµ…Éˆø(€€€€€€€€€€€€ñÍÁ…¸ùAÉ½©•ÐÍÑ…”ð½ÍÁ…¸ø(€€€€€€€€€€€€ñÍÑÉ½¹œùíÁÉ½©•ÑMÑ…•1…‰•±ôð½ÍÑÉ½¹œø((€€€€€€€€€€€€ñ„±…ÍÍ9…µ”ô‰¥½¸µ‰Ñ¸ˆ¡É•˜ôˆ½±¥•¹Ð½Í•ÑÑ¥¹Ìˆø(€€€€€€€€€€€€€M•ÑÑ¥¹Ì(€€€€€€€€€€€€ð½„ø((€€€€€€€€€€€€ñ„±…ÍÍ9…µ”ô‰¥½¸µ‰Ñ¸ˆ¡É•˜ôˆ½±¥•¹Ð½É•Ý…É‘Ìˆø(€€€€€€€€€€€€€I•Ý…É‘Ì(€€€€€€€€€€€€ð½„ø((€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰Ñ¸ˆ½¹±¥¬õíÑ½±•9áÅQ¡•µ•ôÑåÁ”ô‰‰ÕÑÑ½¸ˆø(€€€€€€€€€€€€€í¹áÅQ¡•µ”€ôôô€‰‘…É¬ˆ€ü€‰1¥¡Ðµ½‘”ˆ€è€‰…É¬µ½‘”‰ô(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø((€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰Ñ¸ˆ½¹±¥¬õí¡…¹‘±•1½½ÕÑôÑåÁ”ô‰‰ÕÑÑ½¸ˆø(€€€€€€€€€€€€€€ñ1½=ÕÐÍ¥é”õìÄÙô€¼ø(€€€€€€€€€€€€€1½œ½ÕÐ(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€ð½‘¥Øø((€€€€€€€í•ÉÉ½É5•ÍÍ…”€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ…É•ÉÉ½Èˆùí•ÉÉ½É5•ÍÍ…•ôð½‘¥Øø€è¹Õ±±ô(€€€€€€€í¹½Ñ¥”€ü€ñ‘¥Ø±…ÍÍ9…µ”ô‰¹½Ñ¥”µ…ÉÍÕ•ÍÌˆùí¹½Ñ¥•ôð½‘¥Øø€è¹Õ±±ô((€€€€€€€íÁ½ÉÑ…±•¥Í¥½¹9½Ñ¥”€ü€ (€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”õí¹½Ñ¥”µ…ÉÁ½ÉÑ…°µ‘•¥Í¥½¸µ¹½Ñ¥”€‘íÁ½ÉÑ…±•¥Í¥½¹9½Ñ¥”¹Ñ½¹•õôø(€€€€€€€€€€€€ñÍÑÉ½¹œùíÁ½ÉÑ…±•¥Í¥½¹9½Ñ¥”¹Ñ¥Ñ±•ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€ñÀùíÁ½ÉÑ…±•¥Í¥½¹9½Ñ¥”¹‰½‘åôð½Àø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€¤€è¹Õ±±ô(€€€€€€€€ñ±¥•¹Ñ]•‰Í¥Ñ•M•ÕÉ¥Ñä€¼ø((€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰±¥•¹ÐµÉ¥ˆø(€€€€€€€€€ì…Í•ÑÕÁ½µÁ±•Ñ”€˜˜Ñ…É•Ñ•‘5½É•%¹™½I•ÅÕ•ÍÐ€˜˜Ñ…É•Ñ•‘5½É•%¹™½¥•±€ü€ (€€€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°Á…¹•°µÝ¥‘”ˆø(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µÑ¥Ñ±”ˆø(€€€€€€€€€€€€€€€€ñM•¹Í¥é”õìÈÁô€¼ø(€€€€€€€€€€€€€€€€ñ ÈùíÑ…É•Ñ•‘5½É•%¹™½¥•±¹±…‰•±ôð½ Èø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ±”ˆùíÑ…É•Ñ•‘5½É•%¹™½I•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ•‘%¹™½ôð½Àø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰Ñ…É•Ñ•µµ½É”µ¥¹™¼µ…¹ÍÝ•Èˆø(€€€€€€€€€€€€€€€íÑ…É•Ñ•‘5½É•%¹™½¥•±¹±…‰•±ô(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰Ñ…É•Ñ•µµ½É”µ¥¹™¼µ…¹ÍÝ•Èˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÑ…É•Ñ•‘5½É•%¹™½¥•±¹½¹¡…¹”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•ÈõíÑ…É•Ñ•‘5½É•%¹™½¥•±¹Á±…•¡½±‘•Éô(€€€€€€€€€€€€€€€Ù…±Õ”õíÑ…É•Ñ•‘5½É•%¹™½¥•±¹Ù…±Õ•ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ý¥‘”µ‰Ñ¸ˆ(€€€€€€€€€€€€€€€‘¥Í…‰±•õí¥ÍMÕ‰µ¥ÑÑ¥¹M•ÑÕÀñð€…±¥•¹Ñô(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍÕ‰µ¥ÑQ…É•Ñ•‘5½É•%¹™½UÁ‘…Ñ”¡Ñ…É•Ñ•‘5½É•%¹™½I•ÅÕ•ÍÐ¥ô(€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€í¥ÍMÕ‰µ¥ÑÑ¥¹M•ÑÕÀ€ü€‰MÕ‰µ¥ÑÑ¥¹œÕÁ‘…Ñ”¸¸¸ˆ€è€‰MÕ‰µ¥ÐÉ•ÅÕ•ÍÑ•ÕÁ‘…Ñ”‰ô(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ð½Í•Ñ¥½¸ø(€€€€€€€€€€¤€è€…Í•ÑÕÁ½µÁ±•Ñ”€ü€ (€€€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°Á…¹•°µÝ¥‘”ˆø(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µÑ¥Ñ±”ˆø(€€€€€€€€€€€€€€€€ñM•¹Í¥é”õìÈÁô€¼ø(€€€€€€€€€€€€€€€€ñ Èù]•‰Í¥Ñ”Í•ÑÕÀÍ¡••Ðð½ Èø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ±”ˆø(€€€€€€€€€€€€€€€e½ÕÈÝ•‰Í¥Ñ”Ñ•…´Ý¥±°ÕÍ”Ñ¡•Í”‘•Ñ…¥±ÌÑ¼ÁÉ•Á…É”„‰É…¹µ¹•ÜÕÁÉ…‘•Ý•‰Í¥Ñ”‰…Í•½¸å½ÕÈ‰ÕÍ¥¹•ÍÌ(€€€€€€€€€€€€€€€‘•Ñ…¥±Ì°±½…Ñ¥½¹Ì°Í•ÉÙ¥•Ì°ÍÑå±”‘¥É•Ñ¥½¸°…¹ÁÉ½©•Ð½…±Ì¸(€€€€€€€€€€€€€€ð½Àø((€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…­…”µÉ¥ˆø(€€€€€€€€€€€€€€€ì¡=‰©•Ð¹­•åÌ¡Á…­…•=ÁÑ¥½¹Ì¤…ÌA…­…•Q¥•Émt¤¹µ…À ¡Ñ¥•È¤€ôøì(€€€€€€€€€€€€€€€€€½¹ÍÐ½ÁÑ¥½¸€ôÁ…­…•=ÁÑ¥½¹ÍmÑ¥•Étì(€€€€€€€€€€€€€€€€€½¹ÍÐ¥ÍÑ¥Ù”€ôÍ•±•Ñ•‘A…­…”€ôôôÑ¥•Èì((€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí¥ÍÑ¥Ù”€ü€‰Á…­…”µ…É…Ñ¥Ù”ˆ€è€‰Á…­…”µ…É‰ô(€€€€€€€€€€€€€€€€€€€€€­•äõíÑ¥•Éô(€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•ÑM•±•Ñ•‘A…­…”¡Ñ¥•È¥ô(€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí½ÁÑ¥½¸¹±…‰•±ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø‘í½ÁÑ¥½¸¹ÁÉ¥•ô½µ¼ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ùí½ÁÑ¥½¸¹‘•ÍÉ¥ÁÑ¥½¹ôð½Íµ…±°ø(€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í•ÑÕÀµ™½É´µÉ¥ˆø(€€€€€€€€€€€€€€€€ñ±…‰•°ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸ù½µÁ…¹äÍ¥é”ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍ•±•Ð(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ½µÁ…¹åM…±”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí½µÁ…¹åM…±•ô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ù1½…°‰ÕÍ¥¹•ÍÌð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ùI•¥½¹…°½µÁ…¹äð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ù9…Ñ¥½¹…°½µÁ…¹äð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ù¹Ñ•ÉÁÉ¥Í”€¼±…É”½É…¹¥é…Ñ¥½¸ð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€ð½Í•±•Ðø(€€€€€€€€€€€€€€€€ð½±…‰•°ø((€€€€€€€€€€€€€€€€ñ±…‰•°ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸ù1½…Ñ¥½¸Í•ÑÕÀð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍ•±•Ð(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ1½…Ñ¥½¹QåÁ”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí±½…Ñ¥½¹QåÁ•ô(€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ùM¥¹±”±½…Ñ¥½¸ð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ù5Õ±Ñ¥Á±”±½…Ñ¥½¹Ìð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ùM•ÉÙ¥”…É•…Ì€¼¹¼ÍÑ½É•™É½¹Ðð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€€€ñ½ÁÑ¥½¸ù9…Ñ¥½¹…°€¼½¹±¥¹”ð½½ÁÑ¥½¸ø(€€€€€€€€€€€€€€€€€€ð½Í•±•Ðø(€€€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰±½…Ñ¥½¹Ìˆø(€€€€€€€€€€€€€€€1½…Ñ¥½¹Ì½ÈÍ•ÉÙ¥”…É•…Ì(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰±½…Ñ¥½¹Ìˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ1½…Ñ¥½¹Ì¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”èM…É…µ•¹Ñ¼°I½Í•Ù¥±±”°½±Í½´°±¬É½Ù”¸½ÈµÕ±Ñ¤µ±½…Ñ¥½¸‰É…¹‘Ì°±¥ÍÐ•Ù•Éä±½…Ñ¥½¸å½ÔÝ…¹ÐÉ•ÁÉ•Í•¹Ñ•¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí±½…Ñ¥½¹Íô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰‰ÕÍ¥¹•ÍÌµÁ¡½¹”ˆø(€€€€€€€€€€€€€€€	ÕÍ¥¹•ÍÌÁ¡½¹”(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€¥ô‰‰ÕÍ¥¹•ÍÌµÁ¡½¹”ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ	ÕÍ¥¹•ÍÍA¡½¹”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è€ ÔÔÔ¤€ÄÈÌ´ÐÔØÜˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí‰ÕÍ¥¹•ÍÍA¡½¹•ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰‰ÕÍ¥¹•ÍÌµ•µ…¥°ˆø(€€€€€€€€€€€€€€€	ÕÍ¥¹•ÍÌ•µ…¥°(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€¥ô‰‰ÕÍ¥¹•ÍÌµ•µ…¥°ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ	ÕÍ¥¹•ÍÍµ…¥°¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è½¹Ñ…Ñ‰ÕÍ¥¹•ÍÌ¹½´ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí‰ÕÍ¥¹•ÍÍµ…¥±ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰‰ÕÍ¥¹•ÍÌµ…‘‘É•ÍÌˆø(€€€€€€€€€€€€€€€	ÕÍ¥¹•ÍÌ…‘‘É•ÍÌ(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€¥ô‰‰ÕÍ¥¹•ÍÌµ…‘‘É•ÍÌˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ	ÕÍ¥¹•ÍÍ‘‘É•ÍÌ¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è€ÄÈÌ5…¥¸MÐ°M…É…µ•¹Ñ¼ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí‰ÕÍ¥¹•ÍÍ‘‘É•ÍÍô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰‰ÕÍ¥¹•ÍÌµ¡½ÕÉÌˆø(€€€€€€€€€€€€€€€	ÕÍ¥¹•ÍÌ¡½ÕÉÌ(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰‰ÕÍ¥¹•ÍÌµ¡½ÕÉÌˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ	ÕÍ¥¹•ÍÍ!½ÕÉÌ¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è5½¸µÉ¤€á…´´ÕÁ´°M…ÑÕÉ‘…ä‰ä…ÁÁ½¥¹Ñµ•¹Ð°MÕ¹‘…ä±½Í•¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí‰ÕÍ¥¹•ÍÍ!½ÕÉÍô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰•µ•É•¹äµ…Ù…¥±…‰¥±¥Ñäˆø(€€€€€€€€€€€€€€€µ•É•¹ä€¼…™Ñ•Èµ¡½ÕÉÌ…Ù…¥±…‰¥±¥Ñä(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰•µ•É•¹äµ…Ù…¥±…‰¥±¥Ñäˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñµ•É•¹åÙ…¥±…‰¥±¥Ñä¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è€ÈÐ¼Ü•µ•É•¹ä©½‰Ì°…™Ñ•Èµ¡½ÕÉÌ…±±Ì½¹±ä°¹¼•µ•É•¹äÍ•ÉÙ¥”°Ý••­•¹…Ù…¥±…‰¥±¥Ñä°•ÑŒ¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí•µ•É•¹åÙ…¥±…‰¥±¥Ñåô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰¥¹‘ÕÍÑÉäˆø(€€€€€€€€€€€€€€€%¹‘ÕÍÑÉä(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€¥ô‰¥¹‘ÕÍÑÉäˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ%¹‘ÕÍÑÉä¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”èQÉ•”Í•ÉÙ¥”°‘•¹Ñ…°½™™¥”°É•ÍÑ…ÕÉ…¹ÐÉ½ÕÀ°•¹Ñ•ÉÁÉ¥Í”É•Ñ…¥°°Í•ÕÉ¥Ñä½µÁ…¹äˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí¥¹‘ÕÍÑÉåô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰Í•ÉÙ¥•Ìˆø(€€€€€€€€€€€€€€€M•ÉÙ¥•Ì½ÁÉ½‘ÕÑÌÑ¡”Ý•‰Í¥Ñ”¹••‘ÌÑ¼•áÁ±…¥¸(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰Í•ÉÙ¥•Ìˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑM•ÉÙ¥•Ì¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰1¥ÍÐÍ•ÉÙ¥•Ì°ÁÉ½‘ÕÑÌ°‘•Á…ÉÑµ•¹ÑÌ°½™™•ÉÌ°½È…Ñ•½É¥•ÌÑ¡…Ð¹••Ñ¼…ÁÁ•…È½¸Ñ¡”Ý•‰Í¥Ñ”¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÍ•ÉÙ¥•Íô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰Á…•Ìµ¹••‘•ˆø(€€€€€€€€€€€€€€€A…•Ì½ÈÍ•Ñ¥½¹Ì¹••‘•(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰Á…•Ìµ¹••‘•ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑA…•Í9••‘•¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è!½µ”°‰½ÕÐ°M•ÉÙ¥•Ì°1½…Ñ¥½¹Ì°…±±•Éä°I•Ù¥•ÝÌ°½¹Ñ…Ð°EÕ½Ñ”I•ÅÕ•ÍÐ°…É••ÉÌ°D¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÁ…•Í9••‘•‘ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰ÍÑå±”µ‘¥É•Ñ¥½¸ˆø(€€€€€€€€€€€€€€€]•‰Í¥Ñ”ÍÑå±”‘¥É•Ñ¥½¸(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰ÍÑå±”µ‘¥É•Ñ¥½¸ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑMÑå±•¥É•Ñ¥½¸¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”èÁÉ•µ¥Õ´°µ½‘•É¸°‘…É¬°±ÕáÕÉä°±•…¸°‰½±°ÑÉÕÍÑÝ½ÉÑ¡ä°±½…°°½ÉÁ½É…Ñ”°¡¥ µ•¹¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÍÑå±•¥É•Ñ¥½¹ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰‰É…¹µ¹½Ñ•Ìˆø(€€€€€€€€€€€€€€€]¡…Ðµ…­•ÌÑ¡¥Ì‰ÕÍ¥¹•ÍÌ‘¥™™•É•¹Ðü(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰‰É…¹µ¹½Ñ•Ìˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ	É…¹‘9½Ñ•Ì¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰Q•±°ÕÌÝ¡…Ðµ…­•ÌÑ¡”½µÁ…¹ä‰•ÑÑ•È°µ½É”ÑÉÕÍÑ•°™…ÍÑ•È°Í…™•È°µ½É”ÁÉ•µ¥Õ´°½È‘¥™™•É•¹Ð™É½´½µÁ•Ñ¥Ñ½ÉÌ¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí‰É…¹‘9½Ñ•Íô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰½µÁ•Ñ¥Ñ½ÉÌˆø(€€€€€€€€€€€€€€€½µÁ•Ñ¥Ñ½ÉÌ°•á…µÁ±•Ì°½ÈÝ•‰Í¥Ñ•Ìå½Ô±¥­”(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰½µÁ•Ñ¥Ñ½ÉÌˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ½µÁ•Ñ¥Ñ½ÉÌ¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰=ÁÑ¥½¹…°è±¥ÍÐ½µÁ•Ñ¥Ñ½ÈÝ•‰Í¥Ñ•Ì°¥¹ÍÁ¥É…Ñ¥½¸Í¥Ñ•Ì°½ÈÍÑå±•Ìå½Ô±¥­”¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí½µÁ•Ñ¥Ñ½ÉÍô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í•ÑÕÀµÍ•Ñ¥½¸µ‘¥Ù¥‘•Èˆø(€€€€€€€€€€€€€€€€ñÍÁ…¸ù1•…¡…¹‘±¥¹œÉÕ±•Ìð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€ñÀùQ•±°ÕÌ¡½Üå½ÕÈÝ•‰Í¥Ñ”Í¡½Õ±¡…¹‘±”É•…°ÕÍÑ½µ•ÉÌ°ÅÕ½Ñ”É•ÅÕ•ÍÑÌ°…¹ÕÉ•¹Ð±•…‘Ì¸ð½Àø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰ÁÉ•™•ÉÉ•µ½¹Ñ…Ðµµ•Ñ¡½ˆø(€€€€€€€€€€€€€€€AÉ•™•ÉÉ•½¹Ñ…Ðµ•Ñ¡½(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰ÁÉ•™•ÉÉ•µ½¹Ñ…Ðµµ•Ñ¡½ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑAÉ•™•ÉÉ•‘½¹Ñ…Ñ5•Ñ¡½¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è…±°™¥ÉÍÐ°Ñ•áÐ™½ÈÅÕ¥¬ÅÕ•ÍÑ¥½¹Ì°•µ…¥°™½È•ÍÑ¥µ…Ñ•Ì°Í•¹…±°ÅÕ½Ñ”É•ÅÕ•ÍÑÌÑ¡É½Õ Ñ¡”Ý•‰Í¥Ñ”™½É´¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÁÉ•™•ÉÉ•‘½¹Ñ…Ñ5•Ñ¡½‘ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰ÕÉ•¹Ðµ±•…µÉÕ±•Ìˆø(€€€€€€€€€€€€€€€]¡…Ð½Õ¹ÑÌ…ÌÕÉ•¹Ðü(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰ÕÉ•¹Ðµ±•…µÉÕ±•Ìˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑUÉ•¹Ñ1•…‘IÕ±•Ì¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”èMÑ½É´‘…µ…”°•µ•É•¹äÉ•µ½Ù…±Ì°Í…µ”µ‘…ä‰½½­¥¹Ì°±…É”½µµ•É¥…°©½‰Ì°Í…™•Ñä¥ÍÍÕ•Ì°¡¥ µ‰Õ‘•ÐÉ•ÅÕ•ÍÑÌ¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÕÉ•¹Ñ1•…‘IÕ±•Íô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰É•©•Ñ•µ©½‰Ìˆø(€€€€€€€€€€€€€€€)½‰Ì½ÈÕÍÑ½µ•ÉÌÑ¼É•©•Ð(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰É•©•Ñ•µ©½‰Ìˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑI•©•Ñ•‘)½‰Ì¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è]”‘¼¹½ÐÑ…­”Ñ¥¹ä©½‰ÌÕ¹‘•È€ÌÀÀ°¹¼½ÕÐµ½˜µÍÑ…Ñ”Ý½É¬°¹¼Õ¹Í…™”É•ÅÕ•ÍÑÌ°¹¼™É•”•ÍÑ¥µ…Ñ•Ì½ÕÑÍ¥‘”Í•ÉÙ¥”…É•„¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õíÉ•©•Ñ•‘)½‰Íô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰…É•…Ìµ¹½ÐµÍ•ÉÙ•ˆø(€€€€€€€€€€€€€€€É•…Ì¹½ÐÍ•ÉÙ•(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰…É•…Ìµ¹½ÐµÍ•ÉÙ•ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑÉ•…Í9½ÑM•ÉÙ•¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è]”‘¼¹½ÐÍ•ÉÙ”¡¥¼°	…äÉ•„°½ÕÐµ½˜µ½Õ¹Ñä©½‰Ì°½È±½…Ñ¥½¹Ìµ½É”Ñ¡…¸€ÔÀµ¥±•Ì…Ý…ä¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí…É•…Í9½ÑM•ÉÙ•‘ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í•ÑÕÀµÍ•Ñ¥½¸µ‘¥Ù¥‘•Èˆø(€€€€€€€€€€€€€€€€ñÍÁ…¸ù]•‰Í¥Ñ”…ÍÍ¥ÍÑ…¹ÐÉÕ±•Ìð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€ñÀùQ¡•Í”ÉÕ±•Ì¡•±Àå½ÕÈÝ•‰Í¥Ñ”Ñ•…´ÁÉ•Á…É”Ñ¡”™ÕÑÕÉ”Ý•‰Í¥Ñ”…ÍÍ¥ÍÑ…¹ÐÍ¼¥Ð­¹½ÝÌÝ¡…Ð¥Ð…¸Í…äÍ…™•±ä¸ð½Àø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰…¤µ…¸µ…¹ÍÝ•Èˆø(€€€€€€€€€€€€€€€]¡…Ð…¸Ñ¡”Ý•‰Í¥Ñ”…ÍÍ¥ÍÑ…¹Ð…¹ÍÝ•Èü(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰…¤µ…¸µ…¹ÍÝ•Èˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ¥…¹¹ÍÝ•È¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”èM•ÉÙ¥•Ì°¡½ÕÉÌ°Í•ÉÙ¥”…É•…Ì°‰½½­¥¹œÍÑ•ÁÌ°‰…Í¥ŒÁÉ¥¥¹œÉ…¹•Ì°Ý…ÉÉ…¹Ñä¥¹™¼°™¥¹…¹¥¹œÍÑ•ÁÌ°½µµ½¸EÌ¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí…¥…¹¹ÍÝ•Éô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰…¤µ¹•Ù•ÈµÁÉ½µ¥Í”ˆø(€€€€€€€€€€€€€€€]¡…ÐÍ¡½Õ±¥Ð¹•Ù•ÈÁÉ½µ¥Í”ü(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰…¤µ¹•Ù•ÈµÁÉ½µ¥Í”ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ¥9•Ù•ÉAÉ½µ¥Í”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”è9•Ù•ÈÁÉ½µ¥Í”•á…ÐÁÉ¥•Ì°Í…µ”µ‘…ä…Ù…¥±…‰¥±¥Ñä°±•…°½µ•‘¥…°½™¥¹…¹¥…°…‘Ù¥”°Õ…É…¹Ñ••…ÁÁÉ½Ù…°°½È™¥¹…°ÅÕ½Ñ•ÌÝ¥Ñ¡½ÕÐ½Ý¹•ÈÉ•Ù¥•Ü¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí…¥9•Ù•ÉAÉ½µ¥Í•ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰•Í…±…Ñ¥½¸µÉÕ±•Ìˆø(€€€€€€€€€€€€€€€]¡•¸Í¡½Õ±¥Ð•Í…±…Ñ”Ñ¼ÍÕÁÁ½ÉÐ½ÈÑ¡”½Ý¹•Èü(€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€¥ô‰•Í…±…Ñ¥½¸µÉÕ±•Ìˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑÍ…±…Ñ¥½¹IÕ±•Ì¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰á…µÁ±”èÍ…±…Ñ”…¹ÉäÕÍÑ½µ•ÉÌ°É•™Õ¹ÅÕ•ÍÑ¥½¹Ì°±…É”½¹ÑÉ…ÑÌ°ÕÉ•¹ÐÍ…™•Ñä¥ÍÍÕ•Ì°ÕÍÑ½´ÅÕ½Ñ•Ì°Õ¹±•…ÈÉ•ÅÕ•ÍÑÌ°½È…¹åÑ¡¥¹œ½ÕÑÍ¥‘”¹½Éµ…°Í•ÉÙ¥•Ì¸ˆ(€€€€€€€€€€€€€€€Ù…±Õ”õí•Í…±…Ñ¥½¹IÕ±•Íô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…É••µ•¹Ðµ‰½àˆø(€€€€€€€€€€€€€€€€ñ±…‰•°ø(€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€¡•­•õí…É••µ•¹Ñ•ÁÑ•‘ô(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑÉ••µ•¹Ñ•ÁÑ•¡•Ù•¹Ð¹Ñ…É•Ð¹¡•­•¥ô(€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰¡•­‰½àˆ(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€$…­¹½Ý±•‘”…¹…É•”Ñ¡…ÐµäÝ•‰Í¥Ñ”Ñ•…´Ý¥±°ÕÍ”Ñ¡”¥¹™½Éµ…Ñ¥½¸$(€€€€€€€€€€€€€€€€€€€ÍÕ‰µ¥ÐÑ¼ÁÉ•Á…É”„‰É…¹µ¹•ÜÝ•‰Í¥Ñ”ÁÉ½©•Ð¸$Õ¹‘•ÉÍÑ…¹Ñ¡…Ð(€€€€€€€€€€€€€€€€€€€…É••µ•¹Ð…•ÁÑ…¹”…¹‰¥±±¥¹œ…Ñ¥Ù…Ñ¥½¸…É”É•ÅÕ¥É•‰•™½É”(€€€€€€€€€€€€€€€€€€€™¥¹…°Ý•‰Í¥Ñ”…•ÍÌ½±¥Ù”Í•ÉÙ¥”¸(€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€ð½±…‰•°ø((€€€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰…ÕÑ µ±…‰•°ˆ¡Ñµ±½Èô‰ÑåÁ•µÍ¥¹…ÑÕÉ”ˆø(€€€€€€€€€€€€€€€€€QåÁ•Í¥¹…ÑÕÉ”(€€€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€€€¥ô‰ÑåÁ•µÍ¥¹…ÑÕÉ”ˆ(€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑQåÁ•‘M¥¹…ÑÕÉ”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰QåÁ”å½ÕÈ™Õ±°¹…µ”ˆ(€€€€€€€€€€€€€€€€€Ù…±Õ”õíÑåÁ•‘M¥¹…ÑÕÉ•ô(€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ý¥‘”µ‰Ñ¸ˆ(€€€€€€€€€€€€€€€‘¥Í…‰±•õí¥ÍMÕ‰µ¥ÑÑ¥¹M•ÑÕÀñð€…±¥•¹Ñô(€€€€€€€€€€€€€€€½¹±¥¬õíÍÕ‰µ¥Ñ]•‰Í¥Ñ•M•ÑÕÁô(€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€í¥ÍMÕ‰µ¥ÑÑ¥¹M•ÑÕÀ€ü€‰MÕ‰µ¥ÑÑ¥¹œÍ•ÑÕÀ¸¸¸ˆ€è€‰MÕ‰µ¥ÐÝ•‰Í¥Ñ”Í•ÑÕÀ‰ô(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ð½Í•Ñ¥½¸ø(€€€€€€€€€€¤€è€ (€€€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°Á…¹•°µÝ¥‘”Í•ÑÕÀµ½µÁ±•Ñ”µ…Éˆø(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µÑ¥Ñ±”ˆø(€€€€€€€€€€€€€€€€ñ¡•­¥É±”ÈÍ¥é”õìÈÁô€¼ø(€€€€€€€€€€€€€€€€ñ Èù]•‰Í¥Ñ”Í•ÑÕÀÍÕ‰µ¥ÑÑ•ð½ Èø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ±”ˆø(€€€€€€€€€€€€€€€e½ÕÈÝ•‰Í¥Ñ”Í•ÑÕÀÍ¡••Ð¡…Ì‰••¸ÍÕ‰µ¥ÑÑ•™½ÈÉ•Ù¥•Ü¸Q¡”(€€€€€€€€€€€€€€€Í•ÑÕÀ™½É´¥Ì¹½Ü½ÕÐ½˜Ñ¡”Ý…ä°…¹Ñ¡¥ÌÁ½ÉÑ…°Ý¥±°™½ÕÌ½¸(€€€€€€€€€€€€€€€ÁÉ½©•Ðµ•ÍÍ…•Ì°™¥±•Ì°…ÁÁÉ½Ù…±Ì°…¹ÁÉ½É•ÍÌÕÁ‘…Ñ•Ì¸(€€€€€€€€€€€€€€ð½Àø(€€€€€€€€€€€€ð½Í•Ñ¥½¸ø(€€€€€€€€€€¥ô((€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°Á…¹•°µÝ¥‘”‘½µ…¥¸µÁ…¹•°ˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µÑ¥Ñ±”ˆø(€€€€€€€€€€€€€€ñ¡•­¥É±”ÈÍ¥é”õìÈÁô€¼ø(€€€€€€€€€€€€€€ñ Èù½µ…¥¸Í•ÑÕÀð½ Èø(€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€ì…¡…Í½µ…¥¹I•ÅÕ•ÍÑÌ€ü€ (€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘½µ…¥¸µ½¹¹•Ðµ…Éˆø(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘½µ…¥¸µ½¹¹•Ðµ½Áäˆø(€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œù½¹¹•Ð„‘½µ…¥¸å½Ô½Ý¸ð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€€€ñÀø(€€€€€€€€€€€€€€€€€€€‘Ñ¡”‘½µ…¥¸å½ÔÝ…¹Ð½¹¹•Ñ•Ñ¼å½ÕÈÝ•‰Í¥Ñ”¸]”…¸¡•±ÀÝ¥Ñ (€€€€€€€€€€€€€€€€€€€Í•ÑÕÀ°‰ÕÐå½Ô­••À½Ý¹•ÉÍ¡¥À…¹…¸É•Á½¥¹Ð¥Ð±…Ñ•È¸(€€€€€€€€€€€€€€€€€€ð½Àø(€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘½µ…¥¸µ™½É´µÉ¥ˆø(€€€€€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰‘½µ…¥¸µ™¥•±ˆø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ù½µ…¥¸¹…µ”ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰•á…µÁ±”¹½´ˆ(€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí‘½µ…¥¹9…µ•ô(€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ½µ…¥¹9…µ”¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€ð½±…‰•°ø((€€€€€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰‘½µ…¥¸µ™¥•±ˆø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ùI•¥ÍÑÉ…Èð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰9…µ•¡•…À°½…‘‘ä°±½Õ‘™±…É”¸¸¸ˆ(€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí‘½µ…¥¹I•¥ÍÑÉ…Éô(€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ½µ…¥¹I•¥ÍÑÉ…È¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€ð½±…‰•°ø((€€€€€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰‘½µ…¥¸µ™¥•±ˆø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ù9LÁÉ½Ù¥‘•Èð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰±½Õ‘™±…É”°½…‘‘ä9L°9…µ•¡•…À9L¸¸¸ˆ(€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí‘½µ…¥¹¹ÍAÉ½Ù¥‘•Éô(€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ½µ…¥¹¹ÍAÉ½Ù¥‘•È¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€ð½±…‰•°ø((€€€€€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰‘½µ…¥¸µ™¥•±‘½µ…¥¸µ™¥•±µÝ¥‘”ˆø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ù½µ…¥¸¹½Ñ•Ìð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰Q•±°ÕÌ¥˜Ñ¡¥Ì‘½µ…¥¸…±É•…‘ä¡…Ì•µ…¥°°„±¥Ù”Ý•‰Í¥Ñ”°½ÈÍÁ•¥…°9LÍ•ÑÕÀ¸ˆ(€€€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí‘½µ…¥¹9½Ñ•Íô(€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ½µ…¥¹9½Ñ•Ì¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€ð½±…‰•°ø(€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰‘½µ…¥¸µ½Ý¹•ÉÍ¡¥Àµ‰½àˆø(€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€¡•­•õí‘½µ…¥¹=Ý¹•ÉÍ¡¥Á½¹™¥Éµ•‘ô(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ½µ…¥¹=Ý¹•ÉÍ¡¥Á½¹™¥Éµ•¡•Ù•¹Ð¹Ñ…É•Ð¹¡•­•¥ô(€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰¡•­‰½àˆ(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€$½¹™¥É´$ÁÕÉ¡…Í•…¹½Ý¸½È½¹ÑÉ½°Ñ¡¥Ì‘½µ…¥¸¸$­••À½Ý¹•ÉÍ¡¥À°(€€€€€€€€€€€€€€€€€€€É•¹•Ý…°É•ÍÁ½¹Í¥‰¥±¥Ñä°…¹É•¥ÍÑÉ…È…•ÍÌ¸9aD½¹±äÁÉ½Ù¥‘•Ì9L(€€€€€€€€€€€€€€€€€€€¥¹ÍÑÉÕÑ¥½¹Ì°Ù•É¥™¥•ÌÑ¡”½¹¹•Ñ¥½¸°…¹µ½¹¥Ñ½ÉÌMM0ì9aDÝ¥±°¹•Ù•È…Í¬(€€€€€€€€€€€€€€€€€€€™½ÈµäÉ•¥ÍÑÉ…ÈÁ…ÍÍÝ½É½ÈÑ…­”½Ý¹•ÉÍ¡¥À½˜Ñ¡”‘½µ…¥¸¸(€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€ð½±…‰•°ø((€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ý¥‘”µ‰Ñ¸ˆ(€€€€€€€€€€€€€€€€€‘¥Í…‰±•õí¥ÍMÕ‰µ¥ÑÑ¥¹½µ…¥¸ñð€…±¥•¹Ñô(€€€€€€€€€€€€€€€€€½¹±¥¬õíÍÕ‰µ¥Ñ½µ…¥¹I•ÅÕ•ÍÑô(€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€í¥ÍMÕ‰µ¥ÑÑ¥¹½µ…¥¸€ü€‰MÕ‰µ¥ÑÑ¥¹œ‘½µ…¥¸¸¸¸ˆ€è€‰MÕ‰µ¥Ð‘½µ…¥¸É•ÅÕ•ÍÐ‰ô(€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘½µ…¥¸µÍÕµµ…Éäµ…Éˆø(€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí•Ñ½µ…¥¹MÕµµ…ÉåQ¥Ñ±”¡±…Ñ•ÍÑ½µ…¥¸ü¹ÍÑ…ÑÕÌñð€ˆˆ¥ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€ñÀùí•Ñ½µ…¥¹MÕµµ…Éå5•ÍÍ…”¡±…Ñ•ÍÑ½µ…¥¸ü¹ÍÑ…ÑÕÌñð€ˆˆ¥ôð½Àø(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¥ô((€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘½µ…¥¸µÍÑ…ÑÕÌµ±¥ÍÐˆø(€€€€€€€€€€€€€í±¥•¹Ñ½µ…¥¹Ì¹±•¹Ñ €ôôô€À€ü€ (€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆù9¼‘½µ…¥¸É•ÅÕ•ÍÑÌå•Ð¸ð½‘¥Øø(€€€€€€€€€€€€€€¤€è¹Õ±±ô((€€€€€€€€€€€€€í±¥•¹Ñ½µ…¥¹Ì¹µ…À ¡‘½µ…¥¸¤€ôø€ (€€€€€€€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰‘½µ…¥¸µÍÑ…ÑÕÌµ…Éˆ­•äõí‘½µ…¥¸¹¥‘ôø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‘½µ…¥¸µÍÑ…ÑÕÌµÑ½Àˆø(€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí‘½µ…¥¸¹‘½µ…¥¹}¹…µ•ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ùí•Ñ½µ…¥¹MÑ…ÑÕÍ1…‰•°¡‘½µ…¥¸¹ÍÑ…ÑÕÌ¥ôð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰‘½µ…¥¸µµ•Ñ„ˆø(€€€€€€€€€€€€€€€€€€€I•¥ÍÑÉ…Èèí‘½µ…¥¸¹É•¥ÍÑÉ…É}¹…µ”ñð€‰9½ÐÁÉ½Ù¥‘•‰ôð9Léìˆ€‰ô(€€€€€€€€€€€€€€€€€€€í‘½µ…¥¸¹‘¹Í}ÁÉ½Ù¥‘•Èñð€‰9½ÐÁÉ½Ù¥‘•‰ô(€€€€€€€€€€€€€€€€€€ð½Àø((€€€€€€€€€€€€€€€€€í‘½µ…¥¸¹‘¹Í}¥¹ÍÑÉÕÑ¥½¹Ì€ü€ (€€€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰‘½µ…¥¸µ¥¹ÍÑÉÕÑ¥½¹Ìˆùí‘½µ…¥¸¹‘¹Í}¥¹ÍÑÉÕÑ¥½¹Íôð½Àø(€€€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰‘½µ…¥¸µ¥¹ÍÑÉÕÑ¥½¹Ìˆø(€€€€€€€€€€€€€€€€€€€€€]…¥Ñ¥¹œ™½ÈÉ•Ù¥•Ü€¼9L¥¹ÍÑÉÕÑ¥½¹Ì¸(€€€€€€€€€€€€€€€€€€€€ð½Àø(€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€ð½…ÉÑ¥±”ø(€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½Í•Ñ¥½¸ø(€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°ˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µÑ¥Ñ±”Á…¹•°µÑ¥Ñ±”µÉ½Üˆø(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µÑ¥Ñ±”ˆø(€€€€€€€€€€€€€€€€ñ5•ÍÍ…•¥É±”Í¥é”õìÈÁô€¼ø(€€€€€€€€€€€€€€€€ñ Èù5•ÍÍ…”ÍÕÁÁ½ÉÐð½ Èø(€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰¥½¸µ‰Ñ¸ˆ½¹±¥¬õí±½…‘±¥•¹ÑA½ÉÑ…±…Ñ…ôÑåÁ”ô‰‰ÕÑÑ½¸ˆø(€€€€€€€€€€€€€€€€ñI•™É•Í¡ÜÍ¥é”õìÄÙô€¼ø(€€€€€€€€€€€€€€€I•™É•Í (€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ±”ˆø(€€€€€€€€€€€€€í±¥•¹Ð(€€€€€€€€€€€€€€€€üM•¹‘¥¹œ…Ì€‘í±¥•¹Ð¹‰ÕÍ¥¹•ÍÍ}¹…µ•ô¹€(€€€€€€€€€€€€€€€€è¥Í1½…‘¥¹œ(€€€€€€€€€€€€€€€€€€ü€‰1½…‘¥¹œ±¥•¹Ð¸¸¸ˆ(€€€€€€€€€€€€€€€€€€è€‰9¼±¥•¹Ð±½…‘•¸‰ô(€€€€€€€€€€€€ð½Àø((€€€€€€€€€€€€ñÑ•áÑ…É•„(€€€€€€€€€€€€€Á±…•¡½±‘•Èô‰QåÁ”å½ÕÈµ•ÍÍ…”¡•É”¸¸¸ˆ(€€€€€€€€€€€€€Ù…±Õ”õíµ•ÍÍ…•Q•áÑô(€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ5•ÍÍ…•Q•áÐ¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€¼ø((€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ý¥‘”µ‰Ñ¸ˆ(€€€€€€€€€€€€€‘¥Í…‰±•õí¥ÍM•¹‘¥¹œñð€…±¥•¹Ñô(€€€€€€€€€€€€€½¹±¥¬õíÍ•¹‘5•ÍÍ…•ô(€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€í¥ÍM•¹‘¥¹œ€ü€‰M•¹‘¥¹œ¸¸¸ˆ€è€‰M•¹µ•ÍÍ…”‰ô(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ð½Í•Ñ¥½¸ø((€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°ˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µÑ¥Ñ±”ˆø(€€€€€€€€€€€€€€ñUÁ±½…‘±½ÕÍ¥é”õìÈÁô€¼ø(€€€€€€€€€€€€€€ñ ÈùUÁ±½…™¥±•Ìð½ Èø(€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰ÍÕ‰Ñ±”ˆø(€€€€€€€€€€€€€UÁ±½…±½½Ì°‰ÕÍ¥¹•ÍÌÁ¡½Ñ½Ì°É•Ù¥•ÝÌ°Í•ÉÙ¥”¥µ…•Ì°…¹½¹Ñ•¹Ð™½Èå½ÕÈÝ•‰Í¥Ñ”¸(€€€€€€€€€€€€ð½Àø((€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÕÁ±½…µ‰½àˆø(€€€€€€€€€€€€€€ñ%µ…•A±ÕÌÍ¥é”õìÌÁô€¼ø((€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…ÕÑ µ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€ÑåÁ”ô‰™¥±”ˆ(€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•ÑM•±•Ñ•‘¥±”¡•Ù•¹Ð¹Ñ…É•Ð¹™¥±•Ìü¹lÁtñð¹Õ±°¥ô(€€€€€€€€€€€€€€¼ø((€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€íÍ•±•Ñ•‘¥±”(€€€€€€€€€€€€€€€€€€üI•…‘äÑ¼ÕÁ±½…è€‘íÍ•±•Ñ•‘¥±”¹¹…µ•õ€(€€€€€€€€€€€€€€€€€€è€‰¡½½Í”„±½¼°Á¡½Ñ¼°É•Ù¥•Ü°ÍÉ••¹Í¡½Ð°½È½¹Ñ•¹Ð™¥±”¸‰ô(€€€€€€€€€€€€€€ð½ÍÁ…¸ø((€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ý¥‘”µ‰Ñ¸ˆ(€€€€€€€€€€€€€€€‘¥Í…‰±•õí¥ÍUÁ±½…‘¥¹¥±”ñð€…Í•±•Ñ•‘¥±”ñð€…±¥•¹Ñô(€€€€€€€€€€€€€€€½¹±¥¬õíÕÁ±½…‘±¥•¹Ñ¥±•ô(€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€í¥ÍUÁ±½…‘¥¹¥±”€ü€‰UÁ±½…‘¥¹œ™¥±”¸¸¸ˆ€è€‰UÁ±½…™¥±”‰ô(€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ•ÍÍ…”µ±¥ÍÐˆø(€€€€€€€€€€€€€íÕÁ±½…‘•‘¥±•Ì¹±•¹Ñ €ôôô€À€ü€ (€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆù9¼™¥±•ÌÕÁ±½…‘•å•Ð¸ð½‘¥Øø(€€€€€€€€€€€€€€¤€è¹Õ±±ô((€€€€€€€€€€€€€íÕÁ±½…‘•‘¥±•Ì¹µ…À ¡™¥±”¤€ôø€ (€€€€€€€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰µ•ÍÍ…”µ…Éˆ­•äõí™¥±”¹¥‘ôø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ•ÍÍ…”µ…ÉµÑ½Àˆø(€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí™¥±”¹™¥±•}¹…µ•ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€í¹•Ü…Ñ”¡™¥±”¹ÕÁ±½…‘•‘}…Ð¤¹Ñ½1½…±•MÑÉ¥¹œ¡mt°ì(€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ•MÑå±”è€‰Í¡½ÉÐˆ°(€€€€€€€€€€€€€€€€€€€€€€€Ñ¥µ•MÑå±”è€‰Í¡½ÉÐˆ°(€€€€€€€€€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€€€ñÀùMÑ…ÑÕÌèí™½Éµ…ÑMÑ…ÑÕÌ¡™¥±”¹ÍÑ…ÑÕÌ¥ôð½Àø((€€€€€€€€€€€€€€€€€€ñÍµ…±°ø(€€€€€€€€€€€€€€€€€€€í™¥±”¹•áÁ¥É•Í}…Ð(€€€€€€€€€€€€€€€€€€€€€€üáÁ¥É•Ì€‘í¹•Ü…Ñ”¡™¥±”¹•áÁ¥É•Í}…Ð¤¹Ñ½1½…±•…Ñ•MÑÉ¥¹œ¡mt°ì‘…Ñ•MÑå±”è€‰µ•‘¥Õ´ˆô¥õ€(€€€€€€€€€€€€€€€€€€€€€€è€‰9¼…ÕÑ½µ…Ñ¥Œ•áÁ¥É…Ñ¥½¸‰ô(€€€€€€€€€€€€€€€€€€ð½Íµ…±°ø(€€€€€€€€€€€€€€€€ð½…ÉÑ¥±”ø(€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½Í•Ñ¥½¸ø((€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°Á…¹•°µÝ¥‘”ˆø(€€€€€€€€€€€€ñ ÈùI••¹Ðµ•ÍÍ…•Ìð½ Èø((€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ•ÍÍ…”µ±¥ÍÐˆø(€€€€€€€€€€€€€íµ•ÍÍ…•Ì¹±•¹Ñ €ôôô€À€ü€ (€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆø(€€€€€€€€€€€€€€€€€9¼µ•ÍÍ…•Ìå•Ð¸M•¹½¹”…‰½Ù”Ñ¼Ñ•ÍÐÑ¡”±¥•¹ÐÁ½ÉÑ…°¸(€€€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€€€¤€è¹Õ±±ô((€€€€€€€€€€€€€íµ•ÍÍ…•!…Í5½É”€˜˜µ•ÍÍ…•Ì¹±•¹Ñ €ø€À€ü€ (€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ý¥‘”µ‰Ñ¸ˆ(€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÙ½¥±½…‘=±‘•É5•ÍÍ…•Ì ¥ô(€€€€€€€€€€€€€€€€€‘¥Í…‰±•õí¥Í1½…‘¥¹=±‘•É5•ÍÍ…•Íô(€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€í¥Í1½…‘¥¹=±‘•É5•ÍÍ…•Ì€ü€‰1½…‘¥¹ŸŠ˜ˆ€è€‰1½…½±‘•Èµ•ÍÍ…•Ì‰ô(€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€¤€è¹Õ±±ô((€€€€€€€€€€€€€íµ•ÍÍ…•Ì¹µ…À ¡µ•ÍÍ…”¤€ôøì(€€€€€€€€€€€€€€€½¹ÍÐÍ•¹‘•É1…‰•°€ô(€€€€€€€€€€€€€€€€€µ•ÍÍ…”¹Í•¹‘•É}ÑåÁ”€ôôô€‰±¥•¹Ðˆ€ü€‰e½Ôˆ€è€‰MÕÁÁ½ÉÐˆì((€€€€€€€€€€€€€€€½¹ÍÐÍÑ…ÑÕÍ1…‰•°€ô(€€€€€€€€€€€€€€€€€µ•ÍÍ…”¹Í•¹‘•É}ÑåÁ”€ôôô€‰±¥•¹Ðˆ€ü€‰M•¹Ðˆ€è€‰I••¥Ù•ˆì((€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰µ•ÍÍ…”µ…Éˆ­•äõíµ•ÍÍ…”¹¥‘ôø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ•ÍÍ…”µ…ÉµÑ½Àˆø(€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùíÍ•¹‘•É1…‰•±ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€í¹•Ü…Ñ”¡µ•ÍÍ…”¹É•…Ñ•‘}…Ð¤¹Ñ½1½…±•MÑÉ¥¹œ¡mt°ì(€€€€€€€€€€€€€€€€€€€€€€€€€‘…Ñ•MÑå±”è€‰Í¡½ÉÐˆ°(€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥µ•MÑå±”è€‰Í¡½ÉÐˆ°(€€€€€€€€€€€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ð½‘¥Øø((€€€€€€€€€€€€€€€€€€€€ñÀùíµ•ÍÍ…”¹µ•ÍÍ…•ôð½Àø((€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ùíÍÑ…ÑÕÍ1…‰•±ôð½Íµ…±°ø(€€€€€€€€€€€€€€€€€€ð½…ÉÑ¥±”ø(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½Í•Ñ¥½¸ø((€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°Á…¹•°µÝ¥‘”ˆø(€€€€€€€€€€€€ñ ÈùAÉ½©•ÐÑÉ…­•Èð½ Èø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÑÉ…­•Èˆ‘…Ñ„µ…¹½¹¥…°µ©½ÕÉ¹•äµÍÑ…”õíÁÉ½©•ÑMÑ…•ôø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õíÁÉ½©•ÑMÑ…”€ôôô€‰Í•ÑÕÀˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ôùM•ÑÕÀð½ÍÁ…¸ø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õíÁÉ½©•ÑMÑ…”€ôôô€‰É•Ù¥•Üˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ôù=Ý¹•ÈI•Ù¥•Üð½ÍÁ…¸ø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õíÁÉ½©•ÑMÑ…”€ôôô€‰Á±…¸ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ôùA±…¹¹¥¹œð½ÍÁ…¸ø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õíÁÉ½©•ÑMÑ…”€ôôô€‰‰Õ¥±ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ôù	Õ¥±‘¥¹œð½ÍÁ…¸ø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õíÁÉ½©•ÑMÑ…”€ôôô€‰±…Õ¹ ˆñðÁÉ½©•ÑMÑ…”€ôôô€‰Á…ÕÍ•ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ôù1…Õ¹ ¡•­Ìð½ÍÁ…¸ø(€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õíÁÉ½©•ÑMÑ…”€ôôô€‰…É”ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ôù1¥Ù”ð½ÍÁ…¸ø(€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ð½Í•Ñ¥½¸ø(€€€€€€€€ð½‘¥Øø(€€€€€€ð½Í•Ñ¥½¸ø(€€€€ð½µ…¥¸ø(€€¤ì)ô((((((((((((((((((((((((