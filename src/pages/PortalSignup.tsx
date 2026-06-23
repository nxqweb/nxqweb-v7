import { useState } from "react";
import { MailCheck, UserPlus } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export function PortalSignup() {
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedBusinessName = businessName.trim();
    const trimmedContactName = contactName.trim();
    const trimmedEmail = email.trim();

    setStatusMessage("");
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Check .env.local.");
      return;
    }

    if (!trimmedBusinessName) {
      setErrorMessage("Enter your business name.");
      return;
    }

    if (!trimmedContactName) {
      setErrorMessage("Enter your name.");
      return;
    }

    if (!trimmedEmail || !password) {
      setErrorMessage("Enter your email and create a password.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/portal/login`,
        data: {
          business_name: trimmedBusinessName,
          contact_name: trimmedContactName,
        },
      },
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setStatusMessage("Account created. Check your email to verify your account.");
    window.location.href = "/portal/check-email";
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/portal">
          Client Portal
        </a>

        <form className="auth-card" onSubmit={handleSignup}>
          <div className="panel-title">
            <UserPlus size={22} />
            <h1>Create account</h1>
          </div>

          <p className="subtle">
            Create your NXQ Web client portal account. Your client workspace will
            be created automatically after signup.
          </p>

          {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
          {statusMessage ? <div className="auth-success">{statusMessage}</div> : null}

          <label className="auth-label" htmlFor="business-name">
            Business name
          </label>
          <input
            className="auth-input"
            id="business-name"
            onChange={(event) => setBusinessName(event.target.value)}
            placeholder="Smith Tree Service"
            type="text"
            value={businessName}
          />

          <label className="auth-label" htmlFor="contact-name">
            Your name
          </label>
          <input
            className="auth-input"
            id="contact-name"
            onChange={(event) => setContactName(event.target.value)}
            placeholder="John Smith"
            type="text"
            value={contactName}
          />

          <label className="auth-label" htmlFor="signup-email">
            Email
          </label>
          <input
            className="auth-input"
            id="signup-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="client@example.com"
            type="email"
            value={email}
          />

          <label className="auth-label" htmlFor="signup-password">
            Password
          </label>
          <input
            className="auth-input"
            id="signup-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Create a secure password"
            type="password"
            value={password}
          />

          <button className="primary-btn auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Creating account..." : "Create account"}
            <MailCheck size={18} />
          </button>

          <p className="auth-note">
            Already have an account? <a href="/portal/login">Log in</a>
          </p>
        </form>
      </section>
    </main>
  );
}
