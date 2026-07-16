import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    async function checkRecoverySession() {
      if (!isSupabaseConfigured || !supabase) {
        setErrorMessage("Password recovery is not configured yet.");
        return;
      }

      const sessionResult = await supabase.auth.getSession();

      if (sessionResult.data.session) {
        setHasRecoverySession(true);
        return;
      }

      setErrorMessage(
        "This recovery link is invalid or expired. Request a new password reset link."
      );
    }

    checkRecoverySession();
  }, []);

  async function handlePasswordUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatusMessage("");
    setErrorMessage("");

    if (!supabase) {
      setErrorMessage("Password recovery is not configured yet.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Your new password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    await supabase.auth.signOut();
    setStatusMessage("Password updated successfully. Returning to login...");

    window.setTimeout(() => {
      window.location.href = "/portal/login";
    }, 1400);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/portal/login">
          NXQ Web Portal
        </a>

        <form className="auth-card" onSubmit={handlePasswordUpdate}>
          <div className="panel-title">
            <KeyRound size={22} />
            <h1>Create new password</h1>
          </div>

          <p className="subtle">
            Choose a new password for your NXQ Web portal account.
          </p>

          {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
          {statusMessage ? <div className="auth-success">{statusMessage}</div> : null}

          <label className="auth-label" htmlFor="new-password">
            New password
          </label>

          <input
            className="auth-input"
            disabled={!hasRecoverySession}
            id="new-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            type="password"
            value={password}
          />

          <label className="auth-label" htmlFor="confirm-password">
            Confirm new password
          </label>

          <input
            className="auth-input"
            disabled={!hasRecoverySession}
            id="confirm-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Type your new password again"
            type="password"
            value={confirmPassword}
          />

          <button
            className="primary-btn auth-submit"
            disabled={!hasRecoverySession || isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Updating password..." : "Update password"}
            <KeyRound size={18} />
          </button>

          <p className="auth-note">
            Need a new link? <a href="/portal/forgot-password">Request another</a>
          </p>
        </form>
      </section>
    </main>
  );
}