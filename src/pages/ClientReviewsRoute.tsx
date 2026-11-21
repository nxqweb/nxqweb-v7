import { useEffect, useMemo, useState } from "react";
import { ClientReviews } from "./ClientReviews";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { createReviewsGateway } from "../lib/reviewsSupabaseGateway";

// Connects the Reviews page to the database for /client/reviews. A visitor who is not signed in goes to the login page, like the other client pages.
export function ClientReviewsRoute() {
  const gateway = useMemo(() => (isSupabaseConfigured && supabase ? createReviewsGateway(supabase) : null), []);
  const [ready, setReady] = useState(!gateway);
  useEffect(() => {
    if (!supabase || !gateway) return;
    let alive = true;
    void supabase.auth.getSession().then((result) => {
      if (!alive) return;
      if (!result.data.session) { window.location.replace("/portal/login"); return; }
      setReady(true);
    }).catch(() => { if (alive) window.location.replace("/portal/login"); });
    return () => { alive = false; };
  }, [gateway]);
  if (!ready) return <main className="nxq-page"><section className="portal-shell"><div className="empty-state" role="status">Loading...</div></section></main>;
  return <ClientReviews gateway={gateway} />;
}
