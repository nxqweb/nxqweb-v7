import { useEffect, useState } from "react";
import {
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
    description: "Clean website, client portal, basic updates, and launch support.",
  },
  growth: {
    label: "Growth",
    price: 100,
    description: "More pages, stronger content support, and active update workflow.",
  },
  premium: {
    label: "Premium",
    price: 150,
    description: "Priority support, deeper AI help, premium polish, and more updates.",
  },
};

export function ClientPortal() {
  const [client, setClient] = useState<ClientRow | null>(null);
  const [messages, setMessages] = useState<ClientMessageRow[]>([]);
  const [messageText, setMessageText] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<PackageTier>("starter");
  const [projectNeed, setProjectNeed] = useState("New website");
  const [intakeNotes, setIntakeNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSubmittingIntake, setIsSubmittingIntake] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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

  async function submitIntake() {
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
    const cleanNotes = intakeNotes.trim();

    if (!cleanNotes) {
      setErrorMessage("Tell NXQ what you want before submitting your intake.");
      return;
    }

    setIsSubmittingIntake(true);

    try {
      const updateResult = await supabase
        .from("clients")
        .update({
          monthly_price: selectedPlan.price,
          business_type: projectNeed,
          status: "intake_received",
          notes: `Package: ${selectedPlan.label} - $${selectedPlan.price}/mo\nNeed: ${projectNeed}\nNotes: ${cleanNotes}`,
        })
        .eq("id", client.id);

      if (updateResult.error) {
        setErrorMessage(`Intake update failed: ${updateResult.error.message}`);
        return;
      }

      const approvalResult = await supabase.from("owner_approval_requests").insert({
        client_id: client.id,
        project_id: null,
        request_type: "client_intake",
        title: "Client package intake",
        summary: `${client.business_name} selected ${selectedPlan.label} at $${selectedPlan.price}/mo. Need: ${projectNeed}. Notes: ${cleanNotes}`,
        recommended_action: "Review intake, confirm package fit, and approve next project step.",
        risk_level: "low",
        status: "pending",
      });

      if (approvalResult.error) {
        setErrorMessage(`Owner approval request failed: ${approvalResult.error.message}`);
        return;
      }

      await supabase.from("activity_logs").insert({
        client_id: client.id,
        actor_type: "client",
        action: "client_intake_submitted",
        details: {
          package: selectedPlan.label,
          monthly_price: selectedPlan.price,
          project_need: projectNeed,
          notes_preview: cleanNotes.slice(0, 160),
        },
      });

      setNotice("Intake submitted. NXQ will review your package and project request.");
      setIntakeNotes("");
      await loadClientPortalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown intake error";
      setErrorMessage(`Intake submission failed: ${message}`);
    } finally {
      setIsSubmittingIntake(false);
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
              Choose your website package, send your intake, message NXQ, upload
              photos, request changes, and track your website stage.
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
          <section className="panel panel-wide">
            <div className="panel-title">
              <Send size={20} />
              <h2>Website package intake</h2>
            </div>

            <p className="subtle">
              Pick the monthly package you want, tell NXQ what you need, then submit
              it for owner review.
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

            <label className="auth-label" htmlFor="project-need">
              What do you need?
            </label>
            <select
              className="auth-input"
              id="project-need"
              onChange={(event) => setProjectNeed(event.target.value)}
              value={projectNeed}
            >
              <option>New website</option>
              <option>Website redesign</option>
              <option>Landing page</option>
              <option>Maintenance</option>
              <option>Not sure yet</option>
            </select>

            <label className="auth-label" htmlFor="intake-notes">
              Tell NXQ what you want
            </label>
            <textarea
              id="intake-notes"
              onChange={(event) => setIntakeNotes(event.target.value)}
              placeholder="Example: I need a premium website for my tree service with services, reviews, photos, and a contact form."
              value={intakeNotes}
            />

            <button
              className="wide-btn"
              disabled={isSubmittingIntake || !client}
              onClick={submitIntake}
              type="button"
            >
              {isSubmittingIntake ? "Submitting intake..." : "Submit intake for review"}
            </button>
          </section>

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
                Intake
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
