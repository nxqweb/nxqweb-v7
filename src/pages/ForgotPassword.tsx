import { useState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleResetRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();
    setStatusMessage("");
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Password recovery is not configured yet.");
      return;
    }

    if (!trimmedEmail) {
      setErrorMessage("Enter the email connected to your portal account.");
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}/portal/reset-password`,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setStatusMessage(
      "Recovery instructions were sent. Check your inbox and spam folder."
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/portal/login">
          NXQ Web Portal
        </a>

        <form className="auth-card" onSubmit={handleResetRequest}>
          <div className="panel-title">
            <MailCheck size={22} />
            <h1>Reset password</h1>
          </div>

          <p className="subtle">
            Enter your portal email and we will send you a secure password
            recovery link.
          </p>

          {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
          {statusMessage ? <div className="auth-success">{statusMessage}</div> : null}

          <label className="auth-label" htmlFor="recovery-email">
            Email
          </label>

          <input
            className="auth-input"
            id="recovery-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />

          <button className="primary-btn auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Sending recovery link..." : "Send recovery link"}
            <MailCheck size={18} />
          </button>

          <p className="auth-note">
            <a href="/portal/login">
              <ArrowLeft size={15} /> Back to login
            </a>
          </p>
        </form>
      </section>
    </main>
  );
}