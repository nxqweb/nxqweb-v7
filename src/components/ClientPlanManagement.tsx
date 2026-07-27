import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, BadgeDollarSign, CheckCircle2, Clock3 } from "lucide-react";
import {
  productFamilies as PRODUCT_FAMILIES,
  productTiers as PRODUCT_TIERS,
  type ProductFamilySlug,
  type ProductTierKey,
} from "../lib/productCatalog";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CurrentPlan = {
  clientId: string;
  familySlug: ProductFamilySlug;
  familyName: string;
  tierKey: ProductTierKey;
  tierName: string;
  monthlyPrice: number | null;
  priceLabel: string;
};

type PlanChangeRow = {
  id: string;
  current_product_family_id: string | null;
  current_product_tier_id: string | null;
  requested_product_family_id: string;
  requested_product_tier_id: string;
  requested_monthly_price: number | null;
  one_time_change_fee: number | null;
  client_note: string | null;
  owner_note: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

type PlanChangeView = PlanChangeRow & {
  currentPlanLabel: string;
  requestedPlanLabel: string;
};

function formatMoney(value: number | null) {
  if (value === null) return "Custom";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "Not resolved yet";

  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

export function ClientPlanManagement() {
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan | null>(null);
  const [history, setHistory] = useState<PlanChangeView[]>([]);
  const [requestedFamily, setRequestedFamily] = useState<ProductFamilySlug>("business");
  const [requestedTier, setRequestedTier] = useState<ProductTierKey>("starter");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadPlan();
  }, []);

  async function loadPlan() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Plan information is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    const session = sessionResult.data.session;

    if (!session) {
      window.location.replace("/portal/login");
      return;
    }

    const clientResult = await supabase
      .from("clients")
      .select("id, product_family_id, product_tier_id, monthly_price")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (clientResult.error || !clientResult.data) {
      setError(`Plan load failed: ${clientResult.error?.message || "Client workspace was not found."}`);
      setLoading(false);
      return;
    }

    const [familyResult, tierResult, historyResult] = await Promise.all([
      clientResult.data.product_family_id
        ? supabase
            .from("product_families")
            .select("slug, name")
            .eq("id", clientResult.data.product_family_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      clientResult.data.product_tier_id
        ? supabase
            .from("product_family_tiers")
            .select("tier_key, name, price_label, monthly_price")
            .eq("id", clientResult.data.product_tier_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("client_plan_change_requests")
        .select(
          "id, current_product_family_id, current_product_tier_id, requested_product_family_id, requested_product_tier_id, requested_monthly_price, one_time_change_fee, client_note, owner_note, status, created_at, resolved_at"
        )
        .eq("client_id", clientResult.data.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const relatedError = familyResult.error || tierResult.error || historyResult.error;

    if (relatedError) {
      setError(`Plan details failed to load: ${relatedError.message}`);
      setLoading(false);
      return;
    }

    const familySlug = (familyResult.data?.slug || "business") as ProductFamilySlug;
    const tierKey = (tierResult.data?.tier_key || "starter") as ProductTierKey;
    const monthlyPrice =
      clientResult.data.monthly_price === null
        ? tierResult.data?.monthly_price ?? null
        : Number(clientResult.data.monthly_price);

    const loadedPlan: CurrentPlan = {
      clientId: clientResult.data.id,
      familySlug,
      familyName: familyResult.data?.name || "NXQ Business",
      tierKey,
      tierName: tierResult.data?.name || "Starter",
      monthlyPrice,
      priceLabel:
        monthlyPrice === null
          ? tierResult.data?.price_label || "Custom"
          : `${formatMoney(monthlyPrice)}/mo`,
    };

    const rows = (historyResult.data || []) as PlanChangeRow[];
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

    const [historyFamiliesResult, historyTiersResult] = await Promise.all([
      familyIds.length
        ? supabase.from("product_families").select("id, name").in("id", familyIds)
        : Promise.resolve({ data: [], error: null }),
      tierIds.length
        ? supabase.from("product_family_tiers").select("id, name").in("id", tierIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (historyFamiliesResult.error || historyTiersResult.error) {
      setError(
        `Plan history details failed to load: ${
          historyFamiliesResult.error?.message || historyTiersResult.error?.message
        }`
      );
      setLoading(false);
      return;
    }

    const familyMap = new Map(
      (historyFamiliesResult.data || []).map((family) => [family.id as string, family.name as string])
    );
    const tierMap = new Map(
      (historyTiersResult.data || []).map((tier) => [tier.id as string, tier.name as string])
    );

    setCurrentPlan(loadedPlan);
    setRequestedFamily(
      PRODUCT_FAMILIES.some((family) => family.slug === familySlug)
        ? familySlug
        : PRODUCT_FAMILIES[0]?.slug || "business"
    );
    setRequestedTier(tierKey);
    setHistory(
      rows.map((row) => ({
        ...row,
        currentPlanLabel: `${
          (row.current_product_family_id && familyMap.get(row.current_product_family_id)) || "NXQ Business"
        } · ${
          (row.current_product_tier_id && tierMap.get(row.current_product_tier_id)) || "Starter"
        }`,
        requestedPlanLabel: `${
          familyMap.get(row.requested_product_family_id) || "Unknown family"
        } · ${tierMap.get(row.requested_product_tier_id) || "Unknown tier"}`,
      }))
    );
    setLoading(false);
  }

  const selectedFamily = useMemo(
    () => PRODUCT_FAMILIES.find((family) => family.slug === requestedFamily) || PRODUCT_FAMILIES[0],
    [requestedFamily]
  );

  const selectedTier = useMemo(
    () => PRODUCT_TIERS.find((tier) => tier.key === requestedTier) || PRODUCT_TIERS[0],
    [requestedTier]
  );

  const isSamePlan =
    currentPlan?.familySlug === requestedFamily && currentPlan?.tierKey === requestedTier;
  const hasPendingRequest = history.some((request) => request.status === "pending_owner_review");

  async function submitRequest() {
    if (!supabase || isSamePlan || hasPendingRequest) return;

    setSubmitting(true);
    setMessage("");
    setError("");

    const result = await supabase.rpc("request_client_plan_change", {
      requested_family_slug: requestedFamily,
      requested_tier_key: requestedTier,
      client_note: note.trim() || null,
    });

    setSubmitting(false);

    if (result.error) {
      setError(`Plan change request failed: ${result.error.message}`);
      return;
    }

    setMessage("Plan change request sent for owner review. Nothing changes until the request is approved.");
    setNote("");
    await loadPlan();
  }

  return (
    <section className="panel panel-wide">
      <div className="panel-title">
        <ArrowRightLeft size={20} />
        <div>
          <h2>Plan & website upgrades</h2>
          <p className="subtle">Upgrade, downgrade, or request a different NXQ product family.</p>
        </div>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}

      {loading ? (
        <div className="empty-state">Loading current plan...</div>
      ) : (
        <>
          <div className="owner-message-card plan-summary-card">
            <span className="subtle">Current plan</span>
            <strong>{currentPlan?.familyName} · {currentPlan?.tierName}</strong>
            <p>{currentPlan?.priceLabel} monthly</p>
          </div>

          {hasPendingRequest ? (
            <div className="notice-card">A plan-change request is already awaiting owner review.</div>
          ) : null}

          <div className="setup-form-grid">
            <label>
              <span>Product family</span>
              <select
                className="auth-input"
                value={requestedFamily}
                onChange={(event) => setRequestedFamily(event.target.value as ProductFamilySlug)}
              >
                {PRODUCT_FAMILIES.map((family) => (
                  <option key={family.slug} value={family.slug}>
                    {family.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Tier</span>
              <select
                className="auth-input"
                value={requestedTier}
                onChange={(event) => setRequestedTier(event.target.value as ProductTierKey)}
              >
                {PRODUCT_TIERS.map((tier) => (
                  <option key={tier.key} value={tier.key}>
                    {tier.name} — {tier.priceLabel}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="owner-message-card">
            <div className="panel-title">
              <BadgeDollarSign size={18} />
              <div>
                <strong>{selectedFamily.name} · {selectedTier.name}</strong>
                <p>{selectedTier.priceLabel} monthly</p>
              </div>
            </div>
            <p>{selectedFamily.description}</p>
            <p className="subtle">
              One-time website change fee: confirmed by NXQ before approval. Switching product families may require a larger rebuild.
            </p>
          </div>

          <label className="auth-label" htmlFor="plan-change-note">
            What do you want changed?
          </label>
          <textarea
            className="auth-input"
            id="plan-change-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Tell NXQ what you want to add, remove, or improve."
            rows={4}
          />

          <button
            className="wide-btn"
            type="button"
            disabled={submitting || isSamePlan || hasPendingRequest}
            onClick={() => void submitRequest()}
          >
            <CheckCircle2 size={16} />
            {hasPendingRequest
              ? "Awaiting owner review"
              : isSamePlan
                ? "Current plan selected"
                : submitting
                  ? "Sending request..."
                  : "Request plan change"}
          </button>

          <div className="plan-history-section">
            <div className="panel-title">
              <Clock3 size={18} />
              <h3>Plan-change history</h3>
            </div>

            {history.length === 0 ? (
              <div className="empty-state">No plan changes have been requested yet.</div>
            ) : (
              <div className="plan-history-list">
                {history.map((request) => (
                  <article className="plan-history-card" key={request.id}>
                    <div className="approval-top">
                      <strong>{request.currentPlanLabel} → {request.requestedPlanLabel}</strong>
                      <small>{formatStatus(request.status)}</small>
                    </div>
                    <p>
                      Requested {formatDateTime(request.created_at)}
                      {request.resolved_at ? ` · Resolved ${formatDateTime(request.resolved_at)}` : ""}
                    </p>
                    {request.requested_monthly_price !== null ? (
                      <p>Monthly price: {formatMoney(Number(request.requested_monthly_price))}/month</p>
                    ) : null}
                    {request.one_time_change_fee !== null ? (
                      <p>One-time website change fee: {formatMoney(Number(request.one_time_change_fee))}</p>
                    ) : null}
                    {request.client_note ? <p>Client request: {request.client_note}</p> : null}
                    {request.owner_note ? <p className="recommendation">NXQ response: {request.owner_note}</p> : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
