// The ONE switch for website photos in the client portal. It stays null until the photo migration (docs/drafts/migrations/10_site_photos.sql) is promoted and
// applied; then set it to createSitePhotosGateway(supabase) after copying docs/drafts/ui/sitePhotosSupabaseGateway.ts into src/lib (steps in docs/PHOTO_BACKEND_RUNBOOK.md).
// While it is null the photo panel is not shown anywhere, so nothing in the live portal changes.
import type { SitePhotosGateway } from "./sitePhotos";

export const sitePhotosGateway: SitePhotosGateway | null = null;
