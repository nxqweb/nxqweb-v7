import { useEffect, useState } from "react";
import { ClientBooking } from "./ClientBooking";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { ownerBookingGateway } from "../lib/bookingConfig";

// Connects /client/booking to the database. While the one switch (src/lib/bookingConfig.ts) is null the page says the feature is not open yet and nothing is read.
// Once it is on, a visitor who is not signed in goes to the login page, like the other client pages.
export function ClientBookingRoute() {
  const gateway = ownerBookingGateway;
  const [ready, setReady] = useState(!gateway);
  useEffect(() => {
    if (!gateway) return;
    if (!isSupabaseConfigured || !supabase) { window.location.replace("/portal/login"); return; }
    let alive = true;
    void supabase.auth.getSession().then((result) => {
      if (!alive) return;
      if (!result.data.session) { window.location.replace("/portal/login"); return; }
      setReady(true);
    }).catch(() => { if (alive) window.location.replace("/portal/login"); });
    return () => { alive = false; };
  }, [gateway]);
  if (!ready) return <main className="nxq-page"><section className="portal-shell"><div className="empty-state" role="status">Loading...</div></section></main>;
  return <ClientBooking gateway={gateway} />;
}
