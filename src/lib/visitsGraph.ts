// What the "Your visits" card on the client portal home shows. It never draws or implies data that does not exist: the graph appears only when the plan includes analytics, the client
// is approved, and real visits were recorded; every other case says in plain words why there is no graph. Pure functions so a test can pin each case.
export type VisitsAccess = { allowed?: boolean; reason?: string } | null | undefined;
export type VisitsMode = "graph" | "upgrade" | "waiting" | "hidden";

// Reason codes come from current_client_feature_access (migration 186): allowed, client_not_active, tier_not_entitled, feature_not_entitled, client_missing, feature_key_required.
export function visitsGraphMode(access: VisitsAccess): VisitsMode {
  if (!access) return "hidden";
  if (access.allowed) return "graph";
  if (access.reason === "client_not_active") return "waiting"; // checked first on the server too, so a Growth client who is not approved yet is never told to upgrade
  if (access.reason === "tier_not_entitled" || access.reason === "feature_not_entitled") return "upgrade";
  return "hidden";
}

export const visitsGraphCopy = {
  title: "Your visits",
  upgrade: "A daily visits graph is included with the Growth and Intelligence plans. You can ask for a plan change in Settings.",
  waiting: "Your visits graph appears here once your website is approved and live.",
  empty: "No visits recorded yet. The graph appears once real visits are recorded.",
  failed: "Your visits graph could not be loaded right now.",
};

export function visitsGraphSentence(weekChange: { recent: number; changePercent: number } | null) {
  if (!weekChange) return "Page views per day. Not enough earlier data to compare weeks yet.";
  return `Page views this week: ${weekChange.recent} (${weekChange.changePercent >= 0 ? "+" : ""}${weekChange.changePercent}% vs the week before).`;
}
