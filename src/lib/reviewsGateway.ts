// How the Reviews page talks to the database. The page only knows this small interface, so it can be built and tested before the database
// functions exist. The real connection (draft: docs/drafts/ui/reviewsSupabaseGateway.ts) is added when migration 05_reviews_collector is approved and applied.
export type ReviewSettings = { hasSettings: boolean; reviewUrl: string; businessName: string };
export type ReviewsGateway = {
  load: () => Promise<ReviewSettings>;
  save: (reviewUrl: string, businessName: string) => Promise<ReviewSettings>;
};

export const emptyReviewSettings: ReviewSettings = { hasSettings: false, reviewUrl: "", businessName: "" };

export function reviewSettingsFromRow(row: unknown): ReviewSettings {
  const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
  const reviewUrl = typeof source.review_url === "string" ? source.review_url : "";
  return { hasSettings: Boolean(reviewUrl) && source.has_settings !== false, reviewUrl, businessName: typeof source.business_name === "string" ? source.business_name : "" };
}

// Turns a database message into plain words. Unknown messages never leak raw database text to the client.
export function friendlyReviewsError(message: string | null | undefined): string {
  const text = String(message ?? "");
  if (/Client workspace not found/i.test(text)) return "We could not find your workspace. Please sign in again.";
  if (/Enter a review link|web address|500 characters/i.test(text)) return "That review link was not accepted. Copy it again from your review page's Share button.";
  if (/business name/i.test(text)) return "That business name was not accepted. Keep it to 80 characters with no < or > characters.";
  return "We could not save that right now. Nothing was changed. Please try again in a moment.";
}
