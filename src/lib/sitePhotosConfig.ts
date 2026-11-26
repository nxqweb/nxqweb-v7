// The ONE switch for website photos in the client portal. It is ON since migration 276 (supabase/migrations/276_site_photos.sql) was APPLIED to staging (2026-10-22, run #266);
// switched on 2026-10-29. To hide the photo panel everywhere again, set it back to null (nothing else changes).
// If Supabase is not configured in the build (no URL/key) it stays null, so nothing calls the database.
import type { SitePhotosGateway } from "./sitePhotos";
import { createSitePhotosGateway } from "./sitePhotosSupabaseGateway";
import { supabase } from "./supabaseClient";

export const sitePhotosGateway: SitePhotosGateway | null = supabase ? createSitePhotosGateway(supabase) : null;
