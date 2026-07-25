import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, RefreshCcw, XCircle } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type PlanChangeRequestRow = {
  id: string;
  client_id: string;
  current_product_family_id: string | null;
  current_product_tier_id: string | null;
  requested_product_family_id: string;
  requested_product_tier_id: string;
  requested_monthly_price: number | null;
  one_time_change_fee: number | null;
  client_note: string | null;
  status: string;
  owner_approval_request_id: string | null;
  created_at: string;
};

type ClientRow = {
  id: string;
  business_name: string;
};

type FamilyRow = {
  id: string;
  name: string;
  slug: string;
};

type TierRow = {
  id: string;
  name: string;
  tier_key: string;
  price_label: string | null;
};

type RequestView = PlanChangeRequestRow & {
  clientName: string;
  currentFamilyName: string;
  currentTierName: string;
  requestedFamilyName: string;
  requestedTierName: string;
  requestedPriceLabel: string;
};

function formatMoney(value: number | null) {
  if (value === null) return "Custom";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function OwnerPlanChanges() {
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [fees, setFees] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const pendingCount = useMemo(
    () => requests.filter((request) => request.status === "pending_owner_review").length,
    [requests]
  );

  useEffect(() => {
    void loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError("");
    setMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const requestResult = await supabase
      .from("client_plan_change_requests")
      .select(
        "id, client_id, current_product_family_id, current_product_tier_id, requested_product_family_id, requested_product_tier_id, requested_monthly_price, one_time_change_fee, client_note, status, owner_approval_request_id, created_at"
      )
      .order("created_at", { ascending: false });

    if (requestResult.error) {
      setError(`Plan-change requests failed to load: ${requestResult.error.message}`);
      setLoading(false);
      return;
    }

    const rows = (requestResult.data || []) as PlanChangeRequestRow[];
    const clientIds = [...new Set(rows.map((row) => row.client_id))];
    const familyIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.current_product_family_id, row.requested_product_family_id])
          .filter((value): value is string => Boolean(value))
      ),
    ];
    const tierIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.current_product_tier_id, row.requested_product_tier_id])
          .filter((value): value is string => Boolean(value))
      ),
    ];

    const [clientResult, familyResult, tierResult] = await Promise.all([
      clientIds.length
        ? supabase.from("clients").select("id, business_name").in("id", clientIds)
        : Promise.resolve({ data: [], error: null }),
      familyIds.length
        ? supabase.from("product_families").select("id, name, slug").in("id", familyIds)
        : Promise.resolve({ data: [], error: null }),
      tierIds.length
        ? supabase.from("product_family_tiers").select("id, name, tier_key, price_label").in("id", tierIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const relatedError = clientResult.error || familyResult.error || tierResult.error;

    if (relatedError) {
      setError(`Plan-change details failed to load: ${relatedError.message}`);
      setLoading(false);
      return;
    }

    const clientMap = new Map(
      ((clientResult.data || []) as ClientRow[]).map((client) => [client.id, client])
    );
    const familyMap = new Map(
      ((familyResult.data || []) as FamilyRow[]).map((family) => [family.id, family])
    );
    const tierMap = new Map(
      ((tierResult.data || []) as TierRow[]).map((tier) => [tier.id, tier])
    );

    const views = rows.map<RequestView>((row) => {
      const currentFamily = row.current_product_family_id
        ? familyMap.get(row.current_product_family_id)
        : null;
      const currentTier = row.current_product_tier_id
        ? tierMap.get(row.current_product_tier_id)
        : null;
      const requestedFamily = familyMap.get(row.requested_product_family_id);
      const requestedTier = tierMap.get(row.requested_product_tier_id);

      return {
        ...row,
        clientName: clientMap.get(row.client_id)?.business_name || "Unknown client",
        currentFamilyName: currentFamily?.name || "NXQ Business",
        currentTierName: currentTier?.name || "Starter",
        requestedFamilyName: requestedFamily?.name || "Unknown family",
        requestedTierName: requestedTier?.name || "Unknown tier",
        requestedPriceLabel:
          requestedTier?.price_label || formatMoney(row.requested_monthly_price),
      };
    });

    setRequests(views);
    setFees(
      views.reduce<Record<string, string>>((result, request) => {
        result[request.id] =
          request.one_time_change_fee === null ? "" : String(request.one_time_change_fee);
        return result;
      }, {})
    );
    setNotes(
      views.reduce<Record<string, string>>((result, request) => {
        result[request.id] = "";
        return result;
      }, {})
    );
    setLoading(false);
  }

  async function resolveRequest(request: RequestView, decision: "accepted" | "denied") {
    if (!supabase || !request.owner_approval_request_id) {
      setError("This request is missing its linked owner approval.");
      return;
    }

    const note = (notes[request.id] || "").trim();

    if (!note) {
      setError("Enter an owner note before approving or denying this request.");
      return;
    }

    const rawFee = (fees[request.id] || "").trim();
    const fee = rawFee === "" ? null : Number(rawFee);

    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) {
      setError("The one-time fee must be blank or a valid non-negative number.");
      return;
    }

    const actionLabel = decision === "accepted" ? "APPROVE" : "DENY";
    const confirmed = window.confirm(
      [
        `${actionLabel} PLAN CHANGE`,
        "",
        `Client: ${request.clientName}`,
        `Current: ${request.currentFamilyName} · ${request.currentTierName}`,
        `Requested: ${request.requestedFamilyName} · ${request.requestedTierName}`,
        `New monthly price: ${request.requestedPriceLabel}`,
        `One-time fee: ${fee === null ? "$0 / not set" : formatMoney(fee)}`,
        "",
        decision === "accepted"
          ? "This will update the client's plan and monthly price immediately."
          : "This will leave the current plan unchanged.",
        "",
        "Continue?",
      ].join("\n")
    );

    if (!confirmed) return;

    setBusyId(request.id);
    setError("");
    setMessage("");

    const result = await supabase.rpc("resolve_client_plan_change", {
      target_approval_id: request.owner_approval_request_id,
      decision_status: decision,
      owner_response_text: note,
      one_time_fee: fee,
    });

    setBusyId("");

    if (result.error) {
      setError(`Plan-change decision failed: ${result.error.message}`);
      return;
    }

    const data = result.data as { message?: string } | null;
    setMessage(data?.message || "Plan-change request resolved.");
    await loadRequests();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="portal-header">
          <div>
            <p className="eyebrow">Owner APS</p>
            <h1>Plan changes</h1>
            <p className="subtle">
              Review client upgrades, downgrades, product-family switches, and rebuild fees.
            </p>
          </div>

          <div className="stat-card">
            <span>Pending requests</span>
            <strong>{pendingCount}</strong>
            <a className="wide-btn" href="/owner">
              <ArrowLeft size={16} /> Back to owner
            </a>
          </div>
        </div>

        {error ? <div className="notice-card error">{error}</div> : null}
        {message ? <div className="notice-card success">{message}</div> : null}

        <section className="panel panel-wide">
          <div className="panel-title panel-title-row">
            <div className="panel-title">
              <ArrowRightLeft size={20} />
              <h2>Client plan-change requests</h2>
            </div>
            <button className="icon-btn" type="button" onClick={() => void loadRequests()}>
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>

          {loading ? <div className="empty-state">Loading plan-change requests...</div> : null}

          {!loading && requests.length === 0 ? (
            <div className="empty-state">No plan-change requests have been submitted.</div>
          ) : null}

          <div className="owner-message-list">
            {requests.map((request) => {
              const isPending = request.status === "pending_owner_review";

              return (
                <article className="approval-card" key={request.id}>
                  <div className="approval-top">
                    <span>{request.clientName}</span>
                    <small>{request.status.replaceAll("_", " ")}</small>
                  </div>

                  <h3>{request.requestedFamilyName} · {request.requestedTierName}</h3>
                  <p className="subtle">Submitted {formatDateTime(request.created_at)}</p>

                  <div className="setup-form-grid">
                    <div className="owner-message-card">
                      <span className="subtle">Current plan</span>
                      <strong>{request.currentFamilyName} · {request.currentTierName}</strong>
                    </div>
                    <div className="owner-message-card">
                      <span className="subtle">Requested plan</span>
                      <strong>{request.requestedFamilyName} · {request.requestedTierName}</strong>
                      <p>{request.requestedPriceLabel} monthly</p>
                    </div>
                  </div>

                  {request.client_note ? (
                    <p className="recommendation">Client note: {request.client_note}</p>
                  ) : null}

                  {isPending ? (
                    <>
                      <div className="setup-form-grid">
                        <label>
                          <span>One-time website change fee</span>
                          <input
                            className="auth-input"
                            inputMode="decimal"
                            min="0"
                            placeholder="$0"
                            type="number"
                            value={fees[request.id] || ""}
                            onChange={(event) =>
                              setFees((current) => ({ ...current, [request.id]: event.target.value }))
                            }
                          />
                        </label>
                        <label>
                          <span>Owner note</span>
                          <textarea
                            className="auth-input"
                            placeholder="Explain approval scope, fee, timing, or denial reason."
                            rows={3}
                            value={notes[request.id] || ""}
                            onChange={(event) =>
                              setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                            }
                          />
                        </label>
                      </div>

                      <div className="approval-actions">
                        <button
                          type="button"
                          disabled={busyId === request.id}
                          onClick={() => void resolveRequest(request, "accepted")}
                        >
                          <CheckCircle2 size={16} />
                          {busyId === request.id ? "Saving..." : "Approve plan change"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === request.id}
                          onClick={() => void resolveRequest(request, "denied")}
                        >
                          <XCircle size={16} /> Deny request
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="notice-card">
                      This request has already been resolved.
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
