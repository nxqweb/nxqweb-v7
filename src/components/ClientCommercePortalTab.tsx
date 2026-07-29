import { useEffect, useState } from "react";
import { ClipboardList, LayoutDashboard, PackagePlus, ShoppingBag } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type CommerceAccess = {
  allowed?: boolean;
  setup_status?: string | null;
};

export function ClientCommercePortalTab() {
  const [access, setAccess] = useState<CommerceAccess | null>(null);

  useEffect(() => {
    let active = true;

    async function loadAccess() {
      if (!isSupabaseConfigured || !supabase) return;

      const sessionResult = await supabase.auth.getSession();
      if (!sessionResult.data.session) return;

      const result = await supabase.rpc("get_my_commerce_access");
      if (!active || result.error) return;

      setAccess((result.data as CommerceAccess) || null);
    }

    void loadAccess();

    return () => {
      active = false;
    };
  }, []);

  if (!access?.allowed) return null;

  const setupStatus = access.setup_status || "draft";
  const setupNeedsAttention = ["draft", "needs_more_info"].includes(setupStatus);

  return (
    <section
      aria-label="Commerce workspace shortcuts"
      className="panel panel-wide"
      style={{
        margin: "1rem auto 0",
        maxWidth: "min(92vw, 1100px)",
      }}
    >
      <div className="panel-title panel-title-row">
        <div className="panel-title">
          <ShoppingBag size={20} />
          <div>
            <h2>Commerce workspace</h2>
            <p className="subtle">
              Set up the storefront, add products, manage inventory, and track future orders here.
            </p>
          </div>
        </div>
        <span className="notice-card" style={{ margin: 0, padding: "0.6rem 0.9rem" }}>
          Setup: {setupStatus.replaceAll("_", " ")}
        </span>
      </div>

      {setupNeedsAttention ? (
        <div className="notice-card">
          Finish Commerce setup before NXQ prepares the storefront build and migration plan.
        </div>
      ) : null}

      <div className="setup-form-grid">
        <a className="wide-btn" href="/client/commerce">
          <LayoutDashboard size={17} />
          Open Commerce dashboard
        </a>

        <a className={setupNeedsAttention ? "wide-btn" : "icon-btn"} href="/client/commerce/setup">
          <ClipboardList size={17} />
          {setupNeedsAttention ? "Complete Commerce setup" : "Review store setup"}
        </a>

        <a className="icon-btn" href="/client/commerce/products">
          <PackagePlus size={17} />
          Manage products
        </a>
      </div>
    </section>
  );
}
