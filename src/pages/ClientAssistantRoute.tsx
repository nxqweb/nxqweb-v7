import { useEffect, useState } from "react";
import { ClientAssistant } from "./ClientAssistant";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { siteAssistantGateway } from "../lib/siteAssistantConfig";

// Connects the "My assistant" page to the database for /client/assistant. While the one switch (src/lib/siteAssistantConfig.ts) is null the page shows its own "not switched on"
// message and nothing is read. Once it is on, a visitor who is not signed in goes to the login page, like the other client pages.
export function ClientAssistantRoute() {
  const gateway = siteAssistantGateway;
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
  return <ClientAssistant gateway={gateway} />;
}
