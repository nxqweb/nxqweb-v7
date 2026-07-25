import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, BadgeDollarSign, CheckCircle2 } from "lucide-react";
import {
  productFamilies as PRODUCT_FAMILIES,
  productTiers as PRODUCT_TIERS,
  type ProductFamilySlug,
  type ProductTierKey,
} from "../lib/productCatalog";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CurrentPlan = {
  familySlug: ProductFamilySlug;
  familyName: string;
  tierKey: ProductTierKey;
  tierName: string;
  priceLabel: string;
};

export function ClientPlanManagement() {
  const [currentPlan, setCurrentPlan] = useState<CurrentPlan | null>(null);
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
      .select("product_family_id, product_tier_id")
      .eq("auth_user_id", session.user.id)
      .maybeSingle();

    if (clientResult.error) {
      setError(`Plan load failed: ${clientResult.error.message}`);
      setLoading(false);
      return;
    }

    const familyResult = clientResult.data?.product_family_id
      ? await supabase
          .from("product_families")
          .select("slug, name")
          .eq("id", clientResult.data.product_family_id)
          .maybeSingle()
      : null;

    const tierResult = clientResult.data?.product_tier_id
      ? await supabase
          .from("product_family_tiers")
          .select("tier_key, name, price_label")
          .eq("id", clientResult.data.product_tier_id)
          .maybeSingle()
      : null;

    const familySlug = (familyResult?.data?.slug || "business") as ProductFamilySlug;
    const tierKey = (tierResult?.data?.tier_key || "starter") as ProductTierKey;

    const loadedPlan: CurrentPlan = {
      familySlug,
      familyName: familyResult?.data?.name || "NXQ Business",
      tierKey,
      tierName: tierResult?.data?.name || "Starter",
      priceLabel:
        tierResult?.data?.price_label ||
        PRODUCT_TIERS.find((tier) => tier.key === tierKey)?.priceLabel ||
        "Custom",
    };

    setCurrentPlan(loadedPlan);
    setRequestedFamily(familySlug);
    setRequestedTier(tierKey);
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

  async function submitRequest() {
    if (!supabase || isSamePlan) return;

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
          <div className="owner-message-card">
            <span className="subtle">Current plan</span>
            <strong>
              {currentPlan?.familyName} · {currentPlan?.tierName}
            </strong>
            <p>{currentPlan?.priceLabel} monthly</p>
          </div>

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
            disabled={submitting || isSamePlan}
            onClick={() => void submitRequest()}
          >
            <CheckCircle2 size={16} />
            {isSamePlan ? "Current plan selected" : submitting ? "Sending request..." : "Request plan change"}
          </button>
        </>
      )}
    </section>
  );
}
