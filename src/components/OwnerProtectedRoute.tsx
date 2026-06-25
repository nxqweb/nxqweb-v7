import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type OwnerProtectedRouteProps = {
  children: ReactNode;
};

export function OwnerProtectedRoute({ children }: OwnerProtectedRouteProps) {
  const [isChecking, setIsChecking] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogout() {
    if (!supabase) return;

    await supabase.auth.signOut();
    window.location.href = "/portal/login";
  }

  useEffect(() => {
    async function checkOwnerAccess() {
      setIsChecking(true);
      setErrorMessage("");

      if (!isSupabaseConfigured || !supabase) {
        setErrorMessage("Supabase is not configured yet. Check .env.local.");
        setIsChecking(false);
        return;
      }

      const sessionResult = await supabase.auth.getSession();
      const session = sessionResult.data.session;

      if (!session) {
        window.location.href = "/portal/login";
        return;
      }

      const ownerResult = await supabase
        .from("owner_users")
        .select("id, role")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();

      if (ownerResult.error) {
        setErrorMessage(`Owner access check failed: ${ownerResult.error.message}`);
        setIsOwner(false);
        setIsChecking(false);
        return;
      }

      if (!ownerResult.data) {
        setErrorMessage("This account is logged in, but it is not approved as an NXQ owner.");
        setIsOwner(false);
        setIsChecking(false);
        return;
      }

      setIsOwner(true);
      setIsChecking(false);
    }

    checkOwnerAccess();
  }, []);

  if (isChecking) {
    return (
      <main className="nxq-page">
        <section className="portal-shell portal-auth-shell">
          <div className="auth-card">
            <div className="panel-title">
              <ShieldCheck size={22} />
              <h1>Checking owner access</h1>
            </div>
            <p className="subtle">Verifying your NXQ owner permissions...</p>
          </div>
        </section>
      </main>
    );
  }

  if (!isOwner) {
    return (
      <main className="nxq-page">
        <section className="portal-shell portal-auth-shell">
          <div className="auth-card">
            <div className="panel-title">
              <ShieldCheck size={22} />
              <h1>Owner access denied</h1>
            </div>

            {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}

            <p className="subtle">
              This area is restricted to approved NXQ owner accounts only.
            </p>

            <button className="primary-btn auth-submit" onClick={handleLogout} type="button">
              Log out
              <LogOut size={18} />
            </button>
          </div>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}


