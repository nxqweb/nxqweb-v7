// Manual-testing harness (never part of the production build): mounts the Reviews page with an in-memory gateway so it can be checked in a real
// browser before the database functions exist. ?gw=none (feature not connected), ?gw=fail (every save fails), default = works, ?seed=1 starts with saved settings.
import { createRoot } from "react-dom/client";
import "../../../src/styles/nxq.css";
import "../../../src/styles/portal-premium.css";
import "../../../src/styles/portal-polish.css";
import "../../../src/styles/final-frontend-polish.css";
import "../../../src/styles/plan-forms.css";
import "../../../src/styles/nxqx-neural-glass.css";
import "../../../src/styles/premium-v2.css";
import { ClientReviews } from "../../../src/pages/ClientReviews";
import { emptyReviewSettings, type ReviewSettings, type ReviewsGateway } from "../../../src/lib/reviewsGateway";

const params = new URLSearchParams(window.location.search);
let stored: ReviewSettings = params.get("seed") ? { hasSettings: true, reviewUrl: "https://g.page/r/CabcDEF/review", businessName: "Light of the World Candles" } : emptyReviewSettings;
const gateway: ReviewsGateway | null = params.get("gw") === "none" ? null : {
  load: async () => stored,
  save: async (reviewUrl, businessName) => {
    if (params.get("gw") === "fail") throw new Error('duplicate key value violates unique constraint "client_review_settings_pkey"');
    stored = reviewUrl ? { hasSettings: true, reviewUrl, businessName } : emptyReviewSettings;
    (window as unknown as { __saves: unknown[] }).__saves = [...((window as unknown as { __saves?: unknown[] }).__saves || []), { reviewUrl, businessName }];
    return stored;
  },
};
createRoot(document.getElementById("root") as HTMLElement).render(<ClientReviews gateway={gateway} />);
