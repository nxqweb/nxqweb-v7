import { useEffect, useState } from "react";
import { ClientScreenAttentionMap } from "../components/ClientScreenAttentionMap";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { screenAttentionGateway } from "../lib/screenAttentionMapConfig";

// Connects /client/attention to the database. While the one switch (src/lib/screenAttentionMapConfig.ts) is null the page says it is not switched on and nothing is read.
export function ClientAttentionRoute() {
  const gateway = screenAttentionGateway;
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
  return <ClientScreenAttentionMap gateway={gateway} />;
}
