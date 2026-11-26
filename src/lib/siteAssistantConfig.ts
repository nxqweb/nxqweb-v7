// The ONE switch for the "My assistant" page (the website Q&A assistant, no AI). It is ON since migration 278 (supabase/migrations/278_site_assistant.sql) was APPLIED to staging
// on 2026-10-26 (run #269) and the answer-site-question function was deployed (run #270). To turn the page, the portal link and the portal card off again, set it back to null.
// If Supabase is not configured in the build (no URL/key) it stays null, so nothing calls the database.
import type { SiteAssistantGateway } from "./siteAssistant";
import { supabase } from "./supabaseClient";
import { createSiteAssistantGateway } from "./siteAssistantSupabaseGateway";

export const siteAssistantGateway: SiteAssistantGateway | null = supabase ? createSiteAssistantGateway(supabase) : null;
