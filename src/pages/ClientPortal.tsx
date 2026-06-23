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

type PackageTier = "starter" | "growth" | "premium";

const packageOptions: Record<
  PackageTier,
  { label: string; price: number; description: string }
> = {
  starter: {
    label: "Starter",
    price: 50,
    description: "Clean new website foundation, client portal, and launch support.",
  },
  growth: {
    label: "Growth",
    price: 100,
    description: "Stronger website build, more content support, and active update workflow.",
  },
  premium: {
    label: "Premium",
    price: 150,
    description: "Priority support, premium polish, deeper planning, and more update capacity.",
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

export function ClientPortal() {
  const [client, setClient] = useState<ClientRow | null>(null);
  const [messages, setMessages] = useState<ClientMessageRow[]>([]);
  const [messageText, setMessageText] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<PackageTier>("starter");
  const [companyScale, setCompanyScale] = useState("Local business");
  const [locationType, setLocationType] = useState("Single location");
  const [locations, setLocations] = useState("");
  const [industry, setIndustry] = useState("");
  const [services, setServices] = useState("");
  const [pagesNeeded, setPagesNeeded] = useState("");
  const [styleDirection, setStyleDirection] = useState("");
  const [brandNotes, setBrandNotes] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [typedSignature, setTypedSignature] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const setupComplete = client ? completedSetupStatuses.includes(client.status) : false;

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
        .select("id, business_name, status, monthly_price")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (clientResult.error) {
        setErrorMessage(`Client load failed: ${clientResult.error.message}`);
        setClient(null);
        setMessages([]);
        return;
      }

      if (!clientResult.data) {
        setErrorMessage(
          "No client profile is linked to this login yet. Try signing out and creating a client account again."
        );
        setClient(null);
        setMessages([]);
        return;
      }

      const loadedClient = clientResult.data as ClientRow;
      setClient(loadedClient);

      const matchingPackage =
        Object.entries(packageOptions).find(
          ([, option]) => option.price === Number(loadedClient.monthly_price)
        )?.[0] || "starter";

      setSelectedPackage(matchingPackage as PackageTier);

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
    const cleanIndustry = industry.trim();
    const cleanServices = services.trim();
    const cleanPagesNeeded = pagesNeeded.trim();
    const cleanStyleDirection = styleDirection.trim();
    const cleanBrandNotes = brandNotes.trim();
    const cleanLocations = locations.trim();
    const cleanCompetitors = competitors.trim();
    const cleanSignature = typedSignature.trim();

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
      setErrorMessage("You must accept the NXQ Web agreement acknowledgment before submitting.");
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
        `Company scale: ${companyScale}`,
        `Location setup: ${locationType}`,
        `Locations: ${cleanLocations || "Not provided / single location"}`,
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
        title: "Website setup submitted",
        summary: `${client.business_name} submitted a website setup sheet. Package: ${selectedPlan.label} ($${selectedPlan.price}/mo). Scale: ${companyScale}. Location setup: ${locationType}. Industry: ${cleanIndustry}. Signature: ${cleanSignature}.`,
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
          industry: cleanIndustry,
          agreement_accepted: agreementAccepted,
          typed_signature: cleanSignature,
        },
      });

      setNotice("Website setup submitted. NXQ will review your project details.");
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
      const { error } = await supabase.from("client_messages").insert({
        client_id: client.id,
        sender_type: "client",
        message: cleanMessage,
        needs_owner_review: true,
        ai_handled: false,
      });

      if (error) {
        setErrorMessage(`Message send failed: ${error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "client",
        action: "client_message_sent",
        details: {
          preview: cleanMessage.slice(0, 120),
          source: "client_portal",
        },
      });

      setMessageText("");
      setNotice("Message sent to NXQ.");
      await loadClientPortalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown send error";
      setErrorMessage(`Message send failed: ${message}`);
    } finally {
      setIsSending(false);
    }
  }

  useEffect(() => {
    loadClientPortalData();
  }, []);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Client Portal</p>
            <h1>Your website project hub</h1>
            <p className="subtle">
              Complete your website setup, message NXQ, upload project content,
              and track your website stage.
            </p>
          </div>

          <div className="stat-card">
            <span>Project stage</span>
            <strong>{client ? formatStatus(client.status) : "Loading"}</strong>

            <button className="icon-btn" onClick={handleLogout} type="button">
              <LogOut size={16} />
              Log out
            </button>
          </div>
        </div>

        {errorMessage ? <div className="notice-card error">{errorMessage}</div> : null}
        {notice ? <div className="notice-card success">{notice}</div> : null}

        <div className="client-grid">
          {!setupComplete ? (
            <section className="panel panel-wide">
              <div className="panel-title">
                <Send size={20} />
                <h2>Website setup sheet</h2>
              </div>

              <p className="subtle">
                NXQ Web builds a brand-new upgraded website based on your business
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
                placeholder="Tell NXQ what makes the company better, more trusted, faster, safer, more premium, or different from competitors."
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

              <div className="agreement-box">
                <label>
                  <input
                    checked={agreementAccepted}
                    onChange={(event) => setAgreementAccepted(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I acknowledge and agree that NXQ Web will use the information I
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
                Your website setup sheet has been submitted to NXQ for review. The
                setup form is now out of the way, and this portal will focus on
                project messages, files, approvals, and progress updates.
              </p>
            </section>
          )}

          <section className="panel">
            <div className="panel-title panel-title-row">
              <div className="panel-title">
                <MessageCircle size={20} />
                <h2>Message NXQ</h2>
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
              <span>File upload will connect to Supabase Storage soon.</span>
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

              {messages.map((message) => (
                <article className="message-card" key={message.id}>
                  <div className="message-card-top">
                    <strong>{message.sender_type}</strong>
                    <span>
                      {new Date(message.created_at).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>

                  <p>{message.message}</p>

                  {message.needs_owner_review ? (
                    <small>Needs owner review</small>
                  ) : (
                    <small>Handled</small>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="panel panel-wide">
            <h2>Project tracker</h2>
            <div className="tracker">
              <span className={client?.status === "lead" ? "active" : ""}>Lead</span>
              <span className={client?.status === "intake_received" ? "active" : ""}>
                Setup submitted
              </span>
              <span>Owner Review</span>
              <span>Planning</span>
              <span>Building</span>
              <span>Live</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
