// The real connection for the Reviews page (migration 273_reviews_collector). scripts/test-reviews.mjs checks these exact call names and argument names
// against the SQL, so the two cannot drift apart. The page itself only knows the small ReviewsGateway interface (src/lib/reviewsGateway.ts).
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
