import { useEffect, useMemo, useState } from "react";
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
  const [runtimeOpen, setRuntimeOpen] = useState(0);
  const [readiness, setReadiness] = useState<ReadinessCheck[]>([]);
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

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
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

    if (summaryResult.error) setError(`Owner summary failed: ${summaryResult.error.message}`);
    if (!summaryResult.error) {
      const row = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
      setSummary((row || null) as OwnerPortalSummary | null);
    }

    if (!exceptionResult.error) setExceptions((exceptionResult.data || null) as ExceptionCenterData | null);
    if (!runtimeResult.error) {
      const runtime = (runtimeResult.data || {}) as RuntimeDispatchData;
      setRuntimeOpen(Number(runtime.open_count || 0));
    }
    if (!readinessResult.error) setReadiness((readinessResult.data || []) as ReadinessCheck[]);

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const readinessSummary = useMemo(() => {
    const required = readiness.length;
    const ready = readiness.filter((check) => ["ready", "not_applicable"].includes(check.status)).length;
    return { required, ready, blocked: Math.max(0, required - ready) };
  }, [readiness]);

  const ownerAttention = Number(exceptions?.needs_owner_attention || 0) + runtimeOpen;
  const pendingApprovals = Number(summary?.pending_approvals || 0);
  const unreadMessages = Number(summary?.unread_client_messages || 0);
  const hasUrgentWork = ownerAttention > 0 || pendingApprovals > 0 || unreadMessages > 0;

  if (!host) return null;

  return createPortal(
    <section className="owner-command-center" aria-label="NXQ owner command center">
      <div className="owner-command-center-head">
        <div>
          <span className="owner-command-kicker">NXQ command center</span>
          <h2>{hasUrgentWork ? "Your attention queue" : "Operations are under control"}</h2>
          <p>
            {loading
              ? "Loading the current owner workload..."
              : hasUrgentWork
                ? "NXQ keeps routine automation out of your way and surfaces only the decisions, messages, and exceptions that need you."
                : "No immediate owner action is surfaced right now. NXQ can keep handling the normal workflow."}
          </p>
        </div>
        <button className="icon-btn owner-command-refresh" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCcw size={16} /> Refresh
        </button>
      </div>

      {error ? <div className="owner-command-error" role="alert">{error}</div> : null}

      <div className="owner-command-priority-grid">
        <a className={`owner-command-priority ${pendingApprovals > 0 ? "needs-action" : "clear"}`} href="/owner">
          <span className="owner-command-icon"><ShieldAlert size={20} /></span>
          <div>
            <small>Owner decisions</small>
            <strong>{pendingApprovals}</strong>
            <span>{pendingApprovals > 0 ? "approval requests waiting" : "no approval decisions waiting"}</span>
          </div>
          <ArrowRight size={17} />
        </a>

        <a className={`owner-command-priority ${unreadMessages > 0 ? "needs-action" : "clear"}`} href="/owner">
          <span className="owner-command-icon"><MessageSquareText size={20} /></span>
          <div>
            <small>Client messages</small>
            <strong>{unreadMessages}</strong>
            <span>{unreadMessages > 0 ? "unread messages need review" : "inbox is clear"}</span>
          </div>
          <ArrowRight size={17} />
        </a>

        <a className={`owner-command-priority ${ownerAttention > 0 ? "danger" : "clear"}`} href="/owner/exceptions">
          <span className="owner-command-icon"><AlertTriangle size={20} /></span>
          <div>
            <small>Exceptions</small>
            <strong>{ownerAttention}</strong>
            <span>{ownerAttention > 0 ? "items automation could not safely finish" : "no owner exceptions"}</span>
          </div>
          <ArrowRight size={17} />
        </a>

        <a className={`owner-command-priority ${readinessSummary.blocked > 0 ? "warning" : "clear"}`} href="/owner/launch-readiness">
          <span className="owner-command-icon"><Rocket size={20} /></span>
          <div>
            <small>Launch readiness</small>
            <strong>{readinessSummary.required ? `${readinessSummary.ready}/${readinessSummary.required}` : "—"}</strong>
            <span>{readinessSummary.blocked > 0 ? `${readinessSummary.blocked} required checks not ready` : "required checks currently ready"}</span>
          </div>
          <ArrowRight size={17} />
        </a>
      </div>

      <div className="owner-command-metrics">
        <div className="owner-command-metric">
          <DollarSign size={18} />
          <span>Active MRR</span>
          <strong>{money(Number(summary?.active_monthly_revenue || 0))}/mo</strong>
        </div>
        <div className="owner-command-metric">
          <Activity size={18} />
          <span>Pipeline value</span>
          <strong>{money(Number(summary?.pipeline_monthly_value || 0))}/mo</strong>
        </div>
        <div className="owner-command-metric">
          <Users size={18} />
          <span>Clients</span>
          <strong>{Number(summary?.active_clients || 0)} active · {Number(summary?.total_clients || 0)} total</strong>
        </div>
        <div className="owner-command-metric">
          {Number(exceptions?.auto_retrying || 0) > 0 ? <Clock3 size={18} /> : <CheckCircle2 size={18} />}
          <span>Automation recovery</span>
          <strong>{Number(exceptions?.auto_retrying || 0)} auto-retrying</strong>
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
