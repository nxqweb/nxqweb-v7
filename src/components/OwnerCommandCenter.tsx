import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  DollarSign,
  MessageSquareText,
  RefreshCcw,
  Rocket,
  ShieldAlert,
  Users,
} from "lucide-react";
import { createPortal } from "react-dom";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type OwnerPortalSummary = {
  total_clients: number;
  active_clients: number;
  active_monthly_revenue: number;
  pipeline_clients: number;
  pipeline_monthly_value: number;
  unread_client_messages: number;
  pending_approvals: number;
};

type ExceptionCenterData = {
  healthy_clients: number;
  auto_retrying: number;
  needs_owner_attention: number;
};

type RuntimeDispatchData = {
  open_count: number;
};

type ReadinessCheck = {
  required: boolean;
  status: string;
};

type SourceState = "idle" | "loading" | "ready" | "error";

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function OwnerCommandCenter() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [summary, setSummary] = useState<OwnerPortalSummary | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionCenterData | null>(null);
  const [runtimeOpen, setRuntimeOpen] = useState<number | null>(null);
  const [readiness, setReadiness] = useState<ReadinessCheck[]>([]);
  const [summaryState, setSummaryState] = useState<SourceState>("idle");
  const [exceptionState, setExceptionState] = useState<SourceState>("idle");
  const [runtimeState, setRuntimeState] = useState<SourceState>("idle");
  const [readinessState, setReadinessState] = useState<SourceState>("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const header = document.querySelector(".portal-shell .portal-header");
    if (!header?.parentElement) return;

    const existingHost = document.getElementById("owner-command-center");
    const nextHost = existingHost || document.createElement("div");
    nextHost.id = "owner-command-center";
    nextHost.className = "owner-command-center-host";

    if (!existingHost) header.insertAdjacentElement("afterend", nextHost);
    setHost(nextHost);

    return () => {
      if (!existingHost) nextHost.remove();
    };
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    setSummaryState("loading");
    setExceptionState("loading");
    setRuntimeState("loading");
    setReadinessState("loading");

    if (!isSupabaseConfigured || !supabase) {
      setError("Operational data is unavailable because Supabase is not configured.");
      setSummaryState("error");
      setExceptionState("error");
      setRuntimeState("error");
      setReadinessState("error");
      setLoading(false);
      return;
    }

    const [summaryResult, exceptionResult, runtimeResult, readinessResult] = await Promise.all([
      supabase.rpc("owner_portal_summary"),
      supabase.rpc("owner_exception_center"),
      supabase.rpc("owner_runtime_dispatch_incidents"),
      supabase
        .from("launch_readiness_checks")
        .select("required,status")
        .eq("required", true),
    ]);

    const failures: string[] = [];

    if (summaryResult.error) {
      setSummaryState("error");
      setSummary(null);
      failures.push("owner summary");
    } else {
      const row = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
      setSummary((row || null) as OwnerPortalSummary | null);
      setSummaryState("ready");
    }

    if (exceptionResult.error) {
      setExceptionState("error");
      setExceptions(null);
      failures.push("exception center");
    } else {
      setExceptions((exceptionResult.data || null) as ExceptionCenterData | null);
      setExceptionState("ready");
    }

    if (runtimeResult.error) {
      setRuntimeState("error");
      setRuntimeOpen(null);
      failures.push("runtime incidents");
    } else {
      const runtime = (runtimeResult.data || {}) as RuntimeDispatchData;
      setRuntimeOpen(Number(runtime.open_count || 0));
      setRuntimeState("ready");
    }

    if (readinessResult.error) {
      setReadinessState("error");
      setReadiness([]);
      failures.push("launch readiness");
    } else {
      setReadiness((readinessResult.data || []) as ReadinessCheck[]);
      setReadinessState("ready");
    }

    if (failures.length > 0) {
      setError(`Some operational data could not be loaded: ${failures.join(", ")}. Unknown values are shown as unavailable instead of zero.`);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function openClientChat(event: MouseEvent<HTMLAnchorElement>) {
    const chatButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".portal-shell button"))
      .find((button) => button.textContent?.includes("Client chat"));

    if (!chatButton) return;
    event.preventDefault();
    chatButton.click();
  }

  const readinessSummary = useMemo(() => {
    if (readinessState !== "ready") return null;
    const required = readiness.length;
    const ready = readiness.filter((check) => ["ready", "not_applicable"].includes(check.status)).length;
    return { required, ready, blocked: Math.max(0, required - ready) };
  }, [readiness, readinessState]);

  const ownerAttentionKnown = exceptionState === "ready" && runtimeState === "ready";
  const ownerAttention = ownerAttentionKnown
    ? Number(exceptions?.needs_owner_attention || 0) + Number(runtimeOpen || 0)
    : null;
  const summaryKnown = summaryState === "ready";
  const pendingApprovals = summaryKnown ? Number(summary?.pending_approvals || 0) : null;
  const unreadMessages = summaryKnown ? Number(summary?.unread_client_messages || 0) : null;
  const hasUrgentWork =
    (ownerAttention ?? 0) > 0 ||
    (pendingApprovals ?? 0) > 0 ||
    (unreadMessages ?? 0) > 0;
  const hasUnknownOperationalData =
    [summaryState, exceptionState, runtimeState, readinessState].some((state) => state === "error");

  if (!host) return null;

  return createPortal(
    <section className="owner-command-center" aria-label="NXQ owner command center">
      <div className="owner-command-center-head">
        <div aria-live="polite">
          <span className="owner-command-kicker">NXQ command center</span>
          <h2>
            {hasUrgentWork
              ? "Your attention queue"
              : hasUnknownOperationalData
                ? "Operational status needs review"
                : "Operations are under control"}
          </h2>
          <p>
            {loading
              ? "Loading the current owner workload..."
              : hasUrgentWork
                ? "NXQ keeps routine automation out of your way and surfaces only the decisions, messages, and exceptions that need you."
                : hasUnknownOperationalData
                  ? "One or more operational sources could not be verified, so NXQ is showing those values as unavailable instead of assuming everything is healthy."
                  : "No immediate owner action is surfaced right now. NXQ can keep handling the normal workflow."}
          </p>
        </div>
        <button className="icon-btn owner-command-refresh" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCcw size={16} /> Refresh
        </button>
      </div>

      {error ? <div className="owner-command-error" role="alert">{error}</div> : null}

      <div className="owner-command-priority-grid">
        <a className={`owner-command-priority ${pendingApprovals === null ? "warning" : pendingApprovals > 0 ? "needs-action" : "clear"}`} href="/owner">
          <span className="owner-command-icon"><ShieldAlert size={20} /></span>
          <div>
            <small>Owner decisions</small>
            <strong>{pendingApprovals === null ? "—" : pendingApprovals}</strong>
            <span>{pendingApprovals === null ? "approval status unavailable" : pendingApprovals > 0 ? "approval requests waiting" : "no approval decisions waiting"}</span>
          </div>
          <ArrowRight size={17} />
        </a>

        <a className={`owner-command-priority ${unreadMessages === null ? "warning" : unreadMessages > 0 ? "needs-action" : "clear"}`} href="/owner" onClick={openClientChat}>
          <span className="owner-command-icon"><MessageSquareText size={20} /></span>
          <div>
            <small>Client messages</small>
            <strong>{unreadMessages === null ? "—" : unreadMessages}</strong>
            <span>{unreadMessages === null ? "inbox status unavailable" : unreadMessages > 0 ? "unread messages need review" : "inbox is clear"}</span>
          </div>
          <ArrowRight size={17} />
        </a>

        <a className={`owner-command-priority ${ownerAttention === null ? "warning" : ownerAttention > 0 ? "danger" : "clear"}`} href="/owner/exceptions">
          <span className="owner-command-icon"><AlertTriangle size={20} /></span>
          <div>
            <small>Exceptions</small>
            <strong>{ownerAttention === null ? "—" : ownerAttention}</strong>
            <span>{ownerAttention === null ? "exception status unavailable" : ownerAttention > 0 ? "items automation could not safely finish" : "no owner exceptions"}</span>
          </div>
          <ArrowRight size={17} />
        </a>

        <a className={`owner-command-priority ${readinessSummary === null ? "warning" : readinessSummary.blocked > 0 ? "warning" : "clear"}`} href="/owner/launch-readiness">
          <span className="owner-command-icon"><Rocket size={20} /></span>
          <div>
            <small>Launch readiness</small>
            <strong>{readinessSummary && readinessSummary.required ? `${readinessSummary.ready}/${readinessSummary.required}` : "—"}</strong>
            <span>
              {readinessSummary === null
                ? "readiness status unavailable"
                : readinessSummary.blocked > 0
                  ? `${readinessSummary.blocked} required checks not ready`
                  : readinessSummary.required > 0
                    ? "required checks currently ready"
                    : "no required checks reported"}
            </span>
          </div>
          <ArrowRight size={17} />
        </a>
      </div>

      <div className="owner-command-metrics">
        <div className="owner-command-metric">
          <DollarSign size={18} />
          <span>Active MRR</span>
          <strong>{summaryKnown ? `${money(Number(summary?.active_monthly_revenue || 0))}/mo` : "—"}</strong>
        </div>
        <div className="owner-command-metric">
          <Activity size={18} />
          <span>Pipeline value</span>
          <strong>{summaryKnown ? `${money(Number(summary?.pipeline_monthly_value || 0))}/mo` : "—"}</strong>
        </div>
        <div className="owner-command-metric">
          <Users size={18} />
          <span>Clients</span>
          <strong>{summaryKnown ? `${Number(summary?.active_clients || 0)} active · ${Number(summary?.total_clients || 0)} total` : "—"}</strong>
        </div>
        <div className="owner-command-metric">
          {exceptionState === "ready" && Number(exceptions?.auto_retrying || 0) > 0 ? <Clock3 size={18} /> : <CheckCircle2 size={18} />}
          <span>Automation recovery</span>
          <strong>{exceptionState === "ready" ? `${Number(exceptions?.auto_retrying || 0)} auto-retrying` : "—"}</strong>
        </div>
      </div>

      <div className="owner-command-quick-links" aria-label="Owner operations shortcuts">
        <a href="/owner/automation-health">Automation health</a>
        <a href="/owner/providers">Provider health</a>
        <a href="/owner/exceptions">Exception center</a>
        <a href="/owner/launch-readiness">Launch readiness</a>
        <a href="/owner/sales">Sales pipeline</a>
        <a href="/owner/growth">Growth controls</a>
      </div>
    </section>,
    host
  );
}
