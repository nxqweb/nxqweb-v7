// The ONE switch for website photos in the client portal. It stays null until migration 276 (supabase/migrations/276_site_photos.sql) has been APPLIED to the
// database; then set it to createSitePhotosGateway(supabase) from ./sitePhotosSupabaseGateway (steps in docs/PHOTO_BACKEND_RUNBOOK.md, step D).
// While it is null the photo panel is not shown anywhere, so nothing in the live portal changes.
import type { SitePhotosGateway } from "./sitePhotos";

export const sitePhotosGateway: SitePhotosGateway | null = null;
