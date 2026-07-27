import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
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

  return (
    <nav
      aria-label="Commerce portal"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 60,
        display: "flex",
        justifyContent: "center",
        padding: "0.75rem 1rem 0",
        pointerEvents: "none",
      }}
    >
      <a
        className="icon-btn"
        href="/client/commerce"
        style={{
          pointerEvents: "auto",
          minWidth: "min(92vw, 520px)",
          justifyContent: "center",
          backdropFilter: "blur(18px)",
          boxShadow: "0 18px 45px rgba(0, 0, 0, 0.28)",
        }}
      >
        <ShoppingBag size={17} />
        Commerce
        {access.setup_status ? ` · ${access.setup_status.replaceAll("_", " ")}` : ""}
      </a>
    </nav>
  );
}
