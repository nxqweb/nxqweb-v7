import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock3,
  CreditCard,
  Route,
  Snowflake,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { createPortal } from "react-dom";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { ClientCommercePortalTab } from "./ClientCommercePortalTab";
import { ClientJourneySummaryCard } from "./ClientJourneySummaryCard";
import type { ClientLaunchJourney } from "../lib/clientJourney";

type BillingSummary = {
  billing_status: string;
  status: string;
  pipeline_stop_reason: string | null;
  notes?: string | null;
};

type HealthSummary = {
  health?: string;
  open_alerts?: number;
  deployment_status?: string | null;
  nxq_id?: string | null;
};

type PortalAction = {
  owner: "client" | "nxq";
  tone: "info" | "warning" | "danger" | "success";
  title: string;
  detail: string;
  href: string;
  label: string;
};

type LoadState = "loading" | "ready" | "error";

export function ClientPortalTopCards() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [journey, setJourney] = useState<ClientLaunchJourney | null>(null);
  const [billingStateLoad, setBillingStateLoad] = useState<LoadState>("loading");
  const [healthStateLoad, setHealthStateLoad] = useState<LoadState>("loading");
  const [journeyStateLoad, setJourneyStateLoad] = useState<LoadState>("loading");
  const [summaryError, setSummaryError] = useState("");

  useEffect(() => {
    const portalHeader = document.querySelector(".portal-shell .portal-header");
    if (!portalHeader?.parentElement) return;

    const existingHost = document.getElementById("client-portal-top-cards");
    const nextHost = existingHost || document.createElement("div");
    nextHost.id = "client-portal-top-cards";
    nextHost.className = "client-portal-top-cards";

    if (!existingHost) portalHeader.insertAdjacentElement("afterend", nextHost);
    setHost(nextHost);

    return () => {
      if (!existingHost) nextHost.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPortalSummaries() {
      if (!isSupabaseConfigured || !supabase) {
        if (!active) return;
        setBillingStateLoad("error");
        setHealthStateLoad("error");
        setJourneyStateLoad("error");
        setSummaryError("Portal status is temporarily unavailable because the service connection is not configured.");
        return;
      }

      const sessionResult = await supabase.auth.getSession();
      const session = sessionResult.data.session;
      if (!session) {
        if (!active) return;
        setBillingStateLoad("error");
        setHealthStateLoad("error");
        setJourneyStateLoad("error");
        setSummaryError("Portal status could not be loaded because there is no active session.");
        return;
      }

      const [billingResult, healthResult, journeyResult] = await Promise.all([
        supabase
          .from("clients")
          .select("billing_status,status,pipeline_stop_reason,notes")
          .eq("auth_user_id", session.user.id)
          .maybeSingle(),
        supabase.rpc("current_client_operational_health"),
        supabase.rpc("current_client_launch_journey"),
      ]);

      if (!active) return;

      const failures: string[] = [];

      if (billingResult.error || !billingResult.data) {
        setBilling(null);
        setBillingStateLoad("error");
        failures.push("billing status");
      } else {
        setBilling(billingResult.data as BillingSummary);
        setBillingStateLoad("ready");
      }

      if (healthResult.error || !healthResult.data) {
        setHealth(null);
        setHealthStateLoad("error");
        failures.push("website health");
      } else {
        setHealth(healthResult.data as HealthSummary);
        setHealthStateLoad("ready");
      }

      if (journeyResult.error || !journeyResult.data) {
        setJourney(null);
        setJourneyStateLoad("error");
        failures.push("launch journey");
      } else {
        setJourney(journeyResult.data as ClientLaunchJourney);
        setJourneyStateLoad("ready");
      }

      setSummaryError(
        failures.length > 0
          ? `Some portal status could not be verified: ${failures.join(", ")}. NXQ is showing those areas as unavailable instead of guessing.`
          : ""
      );
    }

    void loadPortalSummaries();
    return () => { active = false; };
  }, []);

  const effectiveJourney = useMemo(() => {
    if (!journey) return null;

    const signedSetupReceived = billing?.notes?.startsWith("NXQ WEB WEBSITE SETUP REPORT") === true;
    const lifecycleHasSetup = ["intake_received", "needs_owner_review", "approved", "active", "overdue", "frozen", "denied"].includes(billing?.status || "");
    const staleSetupCard = journey.stage_key === "setup" && journey.stage_title === "Complete website setup";

    if (!signedSetupReceived || !lifecycleHasSetup || !staleSetupCard) return journey;

    const accepted = ["approved", "active", "overdue", "frozen"].includes(billing?.status || "");
    const denied = billing?.status === "denied";

    return {
      ...journey,
      stage_key: denied ? "stopped" : accepted ? "plan" : "review",
      stage_title: denied ? "Website setup was not approved" : accepted ? "Website plan in progress" : "Setup is under review",
      stage_detail: denied
        ? (billing?.pipeline_stop_reason || "The project is stopped and no new infrastructure will be created.")
        : accepted
          ? "NXQ is turning your approved setup into a protected build plan."
          : "NXQ has your signed setup and the owner decision is the next step.",
      progress_percent: denied ? 0 : Math.max(journey.progress_percent, 17),
      attention_required: false,
      next_action: denied
        ? journey.next_action
        : {
            owner: "nxq" as const,
            title: accepted ? "NXQ is preparing your website plan" : "Waiting for NXQ review",
            detail: accepted
              ? "No action is required unless NXQ asks for a specific detail."
              : "Your information was received. You do not need to resubmit it.",
            href: accepted ? "/client/health" : "/client",
          },
      milestones: journey.milestones.map((milestone, index) => index === 0
        ? { ...milestone, status: "complete" as const, detail: "Your signed website setup was received by NXQ." }
        : milestone),
      requirements: journey.requirements.map((requirement, index) => index === 0
        ? { ...requirement, status: "complete" as const, detail: "Received by NXQ." }
        : requirement),
    } satisfies ClientLaunchJourney;
  }, [billing, journey]);

  const billingState = useMemo(() => {
    if (billingStateLoad === "loading") return {
      tone: "info",
      icon: <Clock3 size={20} />,
      title: "Loading billing status",
      body: "Checking the current billing state for your workspace.",
    };
    if (billingStateLoad === "error" || !billing) return {
      tone: "warning",
      icon: <TriangleAlert size={20} />,
      title: "Billing status is unavailable",
      body: "NXQ could not verify billing status right now. No billing state is being assumed from this screen.",
    };

    const status = billing.billing_status || "not_configured";

    if (status === "frozen") return {
      tone: "danger",
      icon: <Snowflake size={20} />,
      title: "Website service paused",
      body: "Billing still needs to be resolved. You can sign in and contact support, but new website work and launch actions remain paused.",
    };
    if (status === "freeze_review") return {
      tone: "warning",
      icon: <Clock3 size={20} />,
      title: "Billing is under freeze review",
      body: "The grace period has ended. Service has not been frozen automatically and is waiting for owner review.",
    };
    if (status === "past_due") return {
      tone: "warning",
      icon: <Clock3 size={20} />,
      title: "Payment is past due",
      body: "Your account is in the 14-day grace period. Website service remains available while billing is resolved.",
    };
    if (status === "active") return {
      tone: "success",
      icon: <CheckCircle2 size={20} />,
      title: "Billing is active",
      body: "Your billing status is active and no action is currently required.",
    };
    return {
      tone: "info",
      icon: <Clock3 size={20} />,
      title: "Billing setup is not complete",
      body: "Billing has not been fully configured yet. Open billing details or contact support for help.",
    };
  }, [billing, billingStateLoad]);

  const healthState = useMemo(() => {
    if (healthStateLoad === "loading") return {
      tone: "info",
      icon: <Activity size={20} />,
      title: "Loading website health",
      body: "Checking the current website and automation status.",
    };
    if (healthStateLoad === "error" || !health) return {
      tone: "warning",
      icon: <TriangleAlert size={20} />,
      title: "Website health is unavailable",
      body: "NXQ could not verify website health right now. This screen is not treating an unknown state as healthy.",
    };

    const state = health.health || "setting_up";
    if (state === "healthy") return {
      tone: "success",
      icon: <CheckCircle2 size={20} />,
      title: "Website health is good",
      body: `NXQ is monitoring your site. ${health.open_alerts || 0} open alerts.`,
    };
    if (state === "needs_attention") return {
      tone: "danger",
      icon: <TriangleAlert size={20} />,
      title: "NXQ is handling a website issue",
      body: "An automated check needs attention. NXQ will retry safe recovery and escalate only if needed.",
    };
    if (state === "watching") return {
      tone: "warning",
      icon: <Activity size={20} />,
      title: "NXQ is watching a website issue",
      body: "Monitoring detected something worth watching, but the website remains under automated supervision.",
    };
    return {
      tone: "info",
      icon: <Activity size={20} />,
      title: "Website automation is setting up",
      body: `Deployment: ${(health.deployment_status || "setting up").replaceAll("_", " ")}.`,
    };
  }, [health, healthStateLoad]);

  const actionCenter = useMemo<PortalAction[]>(() => {
    if (billingStateLoad === "loading" || healthStateLoad === "loading" || journeyStateLoad === "loading") {
      return [{
        owner: "nxq",
        tone: "info",
        title: "Checking your current website workflow",
        detail: "NXQ is loading billing, website health, and journey status before showing any required action.",
        href: "/client/journey",
        label: "View journey",
      }];
    }

    if (billing?.status === "denied") {
      return [{
        owner: "client",
        tone: "danger",
        title: "Project stopped",
        detail: billing.pipeline_stop_reason || "This website setup was not approved and downstream automation is stopped.",
        href: "/client",
        label: "View status",
      }];
    }

    const actions: PortalAction[] = [];

    if (billingStateLoad === "error") {
      actions.push({
        owner: "nxq",
        tone: "warning",
        title: "Billing status could not be verified",
        detail: "NXQ is not assuming a billing state from missing data. Open billing details for the dedicated status view.",
        href: "/client/billing",
        label: "Billing details",
      });
    } else {
      const billingStatus = billing?.billing_status || "not_configured";
      if (["past_due", "freeze_review", "frozen"].includes(billingStatus)) {
        actions.push({
          owner: "client",
          tone: billingStatus === "frozen" ? "danger" : "warning",
          title: billingStatus === "frozen" ? "Resolve paused billing" : "Review billing",
          detail: billingStatus === "frozen"
            ? "Website work is paused until billing is resolved."
            : "Your billing state needs attention before it becomes a service blocker.",
          href: "/client/billing",
          label: "Open billing",
        });
      } else if (billingStatus !== "active") {
        actions.push({
          owner: "client",
          tone: "info",
          title: "Finish billing setup",
          detail: "Billing is not fully configured yet. Review the billing page for the current state.",
          href: "/client/billing",
          label: "Billing details",
        });
      }
    }

    if (journeyStateLoad === "error") {
      actions.push({
        owner: "nxq",
        tone: "warning",
        title: "Journey status could not be verified",
        detail: "NXQ could not load the launch journey on this summary screen, so no next action is being guessed.",
        href: "/client/journey",
        label: "Journey details",
      });
    } else if (effectiveJourney) {
      actions.push({
        owner: effectiveJourney.next_action.owner,
        tone: effectiveJourney.next_action.owner === "client" ? "warning" : "info",
        title: effectiveJourney.next_action.title,
        detail: effectiveJourney.next_action.detail,
        href: effectiveJourney.next_action.href,
        label: effectiveJourney.next_action.owner === "client" ? "Take action" : "View progress",
      });
    }

    if (healthStateLoad === "error") {
      actions.push({
        owner: "nxq",
        tone: "warning",
        title: "Website health could not be verified",
        detail: "NXQ is not presenting an unknown website-health state as healthy.",
        href: "/client/health",
        label: "Health details",
      });
    } else if (health?.health === "needs_attention" || health?.health === "watching") {
      actions.push({
        owner: "nxq",
        tone: health.health === "needs_attention" ? "danger" : "warning",
        title: health.health === "needs_attention" ? "Website issue under recovery" : "Website issue under observation",
        detail: health.health === "needs_attention"
          ? "NXQ is already handling the issue through the protected recovery path."
          : "NXQ is monitoring the issue and will escalate only if it becomes actionable.",
        href: "/client/health",
        label: "Health details",
      });
    }

    if (actions.length === 0) {
      actions.push({
        owner: "nxq",
        tone: "success",
        title: "Nothing needs your attention",
        detail: "NXQ is handling the current website workflow. We will surface a task here when you need to do something.",
        href: "/client/journey",
        label: "View journey",
      });
    }

    return actions.slice(0, 4);
  }, [billing, billingStateLoad, effectiveJourney, health, healthStateLoad, journeyStateLoad]);

  if (!host) return null;

  const denied = billingStateLoad === "ready" && billing?.status === "denied";
  const clientActionCount = actionCenter.filter((action) => action.owner === "client" && action.tone !== "success").length;
  const hasUnknownState = [billingStateLoad, healthStateLoad, journeyStateLoad].includes("error");

  return createPortal(
    <div style={{ display: "grid", gap: "1rem", marginBottom: "1rem" }}>
      <section className="notice-card portal-action-center info" aria-label="NXQ-Web action center">
        <div className="portal-action-center-head">
          <div className="panel-title">
            <Sparkles size={21} />
            <div>
              <span className="journey-kicker">NXQ-Web action center</span>
              <strong>
                {clientActionCount > 0
                  ? `${clientActionCount} item${clientActionCount === 1 ? "" : "s"} need your attention`
                  : hasUnknownState
                    ? "Some website status is unavailable"
                    : "Your website workflow is on track"}
              </strong>
              <p>Important client tasks rise to the top. Everything marked NXQ is being handled for you.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/journey">Full journey <ArrowRight size={15} /></a>
        </div>

        {summaryError ? <div className="notice-card warning" role="status">{summaryError}</div> : null}

        <div className="portal-action-grid">
          {actionCenter.map((action, index) => (
            <article className={`portal-action-item ${action.tone}`} key={`${action.title}-${index}`}>
              <div className="portal-action-icon">
                {action.owner === "client"
                  ? action.href.includes("billing") ? <CreditCard size={18} /> : <TriangleAlert size={18} />
                  : action.tone === "success" ? <CheckCircle2 size={18} /> : <Route size={18} />}
              </div>
              <div className="portal-action-copy">
                <span>{action.owner === "client" ? "Your action" : "NXQ handling"}</span>
                <strong>{action.title}</strong>
                <p>{action.detail}</p>
              </div>
              <a className="icon-btn" href={action.href}>{action.label}</a>
            </article>
          ))}
        </div>
      </section>

      {effectiveJourney ? <ClientJourneySummaryCard journey={effectiveJourney} /> : null}
      {denied ? (
        <section className="notice-card portal-decision-notice danger">
          <div className="panel-title">
            <Ban size={20} />
            <div>
              <strong>Website setup was not approved</strong>
              <p>{billing?.pipeline_stop_reason || "Your NXQ-Web setup request was denied and automation has been stopped."}</p>
              <p className="subtle">No new website infrastructure or automation will continue. For questions, contact NXQweb@protonmail.com.</p>
            </div>
          </div>
        </section>
      ) : (
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
      )}

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

      {!denied ? <ClientCommercePortalTab /> : null}
    </div>,
    host
  );
}
