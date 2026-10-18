// DRAFT (not compiled, not in src/). The real connection for the website photos panel. Copy to src/lib/sitePhotosSupabaseGateway.ts ONLY after migration
// 10_site_photos has been promoted to supabase/migrations and applied (the CI contract rejects calls to database functions that are not in a real migration).
// scripts/test-site-photos-ui.mjs checks these exact call names and argument names against the SQL.
import type { SupabaseClient } from "@supabase/supabase-js";
import { photosFromRows, type SitePhotosGateway } from "./sitePhotos";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function createSitePhotosGateway(client: SupabaseClient): SitePhotosGateway {
  return {
    async list() { return photosFromRows(check(await client.rpc("list_my_site_photos"))); },
    async save(input) {
      check(await client.rpc("save_my_site_photo", {
        target_file_id: input.fileId, target_role: input.role, target_alt_text: input.altText, target_caption: input.caption, target_sort_order: input.sortOrder,
      }));
    },
    async remove(fileId) { check(await client.rpc("remove_my_site_photo", { target_file_id: fileId })); },
  };
}
