import { useEffect, useState } from "react";
import { ImagePlus, MessageCircle, RefreshCcw, UploadCloud } from "lucide-react";
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

export function ClientPortal() {
  const [client, setClient] = useState<ClientRow | null>(null);
  const [messages, setMessages] = useState<ClientMessageRow[]>([]);
  const [messageText, setMessageText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  function formatStatus(status: string) {
    return status.replaceAll("_", " ");
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
      const clientResult = await supabase
        .from("clients")
        .select("id, business_name, status, monthly_price")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (clientResult.error) {
        setErrorMessage(`Client load failed: ${clientResult.error.message}`);
        setClient(null);
        setMessages([]);
        return;
      }

      if (!clientResult.data) {
        setErrorMessage("No test client found yet.");
        setClient(null);
        setMessages([]);
        return;
      }

      const loadedClient = clientResult.data as ClientRow;
      setClient(loadedClient);

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
              Clients use this portal to message NXQ, upload photos, request changes,
              and track their website stage.
            </p>
          </div>

          <div className="stat-card">
            <span>Project stage</span>
            <strong>{client ? formatStatus(client.status) : "Loading"}</strong>
          </div>
        </div>

        {errorMessage ? <div className="notice-card error">{errorMessage}</div> : null}
        {notice ? <div className="notice-card success">{notice}</div> : null}

        <div className="client-grid">
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
              <span className="active">Intake</span>
              <span>Owner Review</span>
              <span>Planning</span>
              <span>Building</span>
              <span>Review</span>
              <span>Live</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
