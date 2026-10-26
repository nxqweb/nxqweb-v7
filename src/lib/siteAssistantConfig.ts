// The ONE switch for the "My assistant" page (the website Q&A assistant, no AI). It stays null until migration 278 (supabase/migrations/278_site_assistant.sql) has been APPLIED
// to the database; then set it to createSiteAssistantGateway(supabase) from ./siteAssistantSupabaseGateway (steps in docs/SITE_ASSISTANT_PLAN.md, "Promotion checklist").
// While it is null the page says it is not switched on, the portal shows no "My assistant" link or card, and nothing calls the new database functions.
import type { SiteAssistantGateway } from "./siteAssistant";

export const siteAssistantGateway: SiteAssistantGateway | null = null;
