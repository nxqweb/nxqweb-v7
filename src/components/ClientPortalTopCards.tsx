import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Clock3, Snowflake, TriangleAlert } from "lucide-react";
import { createPortal } from "react-dom";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { ClientCommercePortalTab } from "./ClientCommercePortalTab";

type BillingSummary = {
  billing_status: string;
};

type HealthSummary = {
  health?: string;
  open_alerts?: number;
  deployment_status?: string | null;
  nxq_id?: string | null;
};

export function ClientPortalTopCards() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);

  useEffect(() => {
    const portalHeader = document.querySelector(".portal-shell .portal-header");
    if (!portalHeader?.parentElement) return;

    const existingHost = document.getElementById("client-portal-top-cards");
    const nextHost = existingHost || document.createElement("div");
    nextHost.id = "client-portal-top-cards";
    nextHost.className = "client-portal-top-cards";

    if (!existingHost) {
      portalHeader.insertAdjacentElement("afterend", nextHost);
    }

    setHost(nextHost);

    return () => {
      if (!existingHost) nextHost.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPortalSummaries() {
      if (!isSupabaseConfigured || !supabase) return;

      const sessionResult = await supabase.auth.getSession();
      const session = sessionResult.data.session;
      if (!session) return;

      const [billingResult, healthResult] = await Promise.all([
        supabase
          .from("clients")
          .select("billing_status")
          .eq("auth_user_id", session.user.id)
          .maybeSingle(),
        supabase.rpc("current_client_operational_health"),
      ]);

      if (!active) return;
      if (!billingResult.error && billingResult.data) setBilling(billingResult.data as BillingSummary);
      if (!healthResult.error && healthResult.data) setHealth(healthResult.data as HealthSummary);
    }

    void loadPortalSummaries();

    return () => {
      active = false;
    };
  }, []);

  const billingState = useMemo(() => {
    const status = billing?.billing_status || "not_configured";

    if (status === "frozen") {
      return {
        tone: "danger",
        icon: <Snowflake size={20} />,
        title: "Website service paused",
        body: "Billing still needs to be resolved. You can sign in and contact support, but new website work and launch actions remain paused.",
      };
    }

    if (status === "freeze_review") {
      return {
        tone: "warning",
        icon: <Clock3 size={20} />,
        title: "Billing is under freeze review",
        body: "The grace period has ended. Service has not been frozen automatically and is waiting for owner review.",
      };
    }

    if (status === "past_due") {
      return {
        tone: "warning",
        icon: <Clock3 size={20} />,
        title: "Payment is past due",
        body: "Your account is in the 14-day grace period. Website service remains available while billing is resolved.",
      };
    }

    if (status === "active") {
      return {
        tone: "success",
        icon: <CheckCircle2 size={20} />,
        title: "Billing is active",
        body: "Your billing status is active and no action is currently required.",
      };
    }

    return {
      tone: "info",
      icon: <Clock3 size={20} />,
      title: "Billing setup is not complete",
      body: "Billing has not been fully configured yet. Open billing details or contact support for help.",
    };
  }, [billing]);

  const healthState = useMemo(() => {
    const state = health?.health || "setting_up";
    if (state === "healthy") {
      return {
        tone: "success",
        icon: <CheckCircle2 size={20} />,
        title: "Website health is good",
        body: `NXQ is monitoring your site. ${health?.open_alerts || 0} open alerts.`,
      };
    }
    if (state === "needs_attention") {
      return {
        tone: "danger",
        icon: <TriangleAlert size={20} />,
        title: "NXQ is handling a website issue",
        body: "An automated check needs attention. NXQ will retry safe recovery and escalate only if needed.",
      };
    }
    if (state === "watching") {
      return {
        tone: "warning",
        icon: <Activity size={20} />,
        title: "NXQ is watching a website issue",
        body: "Monitoring detected something worth watching, but the website remains under automated supervision.",
      };
    }
    return {
      tone: "info",
      icon: <Activity size={20} />,
      title: "Website automation is setting up",
      body: `Deployment: ${(health?.deployment_status || "setting up").replaceAll("_", " ")}.`,
    };
  }, [health]);

  if (!host) return null;

  return createPortal(
    <div style={{ display: "grid", gap: "1rem", marginBottom: "1rem" }}>
      <section className={`notice-card portal-decision-notice ${healthState.tone}`}>
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            {healthState.icon}
            <div>
              <strong>{healthState.title}</strong>
              <p>{healthState.body}</p>
              {health?.nxq_id ? <p className="subtle">NXQ ID: {health.nxq_id}</p> : null}
            </div>
          </div>
          <a className="icon-btn" href="/client/health">Website health</a>
        </div>
      </section>

      <section className={`notice-card portal-decision-notice ${billingState.tone}`}>
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            {billingState.icon}
            <div>
              <strong>{billingState.title}</strong>
              <p>{billingState.body}</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/billing">Billing details</a>
        </div>
      </section>

      <ClientCommercePortalTab />
    </div>,
    host
  );
}