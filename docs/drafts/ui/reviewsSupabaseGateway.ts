// DRAFT (not compiled, not in src/). The real connection for the Reviews page. Copy it to src/lib/reviewsSupabaseGateway.ts ONLY after migration
// 05_reviews_collector has been promoted to supabase/migrations and applied: the CI contract rejects code that calls a database function which does not
// exist in a real migration yet. Then wire the page (see docs/drafts/ui/README.md) and run scripts/test-reviews.mjs, which checks these exact call names
// and argument names against the SQL.
import type { SupabaseClient } from "@supabase/supabase-js";
import { reviewSettingsFromRow, type ReviewsGateway } from "./reviewsGateway";

export function createReviewsGateway(client: SupabaseClient): ReviewsGateway {
  return {
    async load() {
      const result = await client.rpc("get_my_review_settings");
      if (result.error) throw new Error(result.error.message);
      return reviewSettingsFromRow(result.data);
    },
    async save(reviewUrl, businessName) {
      const result = await client.rpc("save_my_review_settings", { review_url_value: reviewUrl || null, business_name_value: businessName || null });
      if (result.error) throw new Error(result.error.message);
      return reviewSettingsFromRow(result.data);
    },
  };
}
