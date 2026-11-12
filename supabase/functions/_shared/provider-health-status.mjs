// How one adapter answer becomes database rows. Pure logic so the Node tests can run it exactly as the Edge function does
// (scripts/test-provider-health-status.mjs). Bug found 2026-11-12: the adapter answers "not_configured" for providers that have no read-only check
// (billing, Stripe, the AI adapters ...). That word is not allowed in nxq_provider_health_events.status (migration 134), so the INSERT failed and
// the whole sweep returned HTTP 500 as soon as one such provider was due (an owner "Recheck now" makes it due).
export const HEALTH_EVENT_STATUSES = Object.freeze(["healthy", "degraded", "error", "rate_limited", "unauthorized", "timeout", "recovered"]);

export function classifyHealthStatus(status) {
  const value = String(status || "error");
  // No check exists: the provider stays "not configured"; nothing is recorded as a health event (the table cannot hold it) and nothing is called degraded.
  if (value === "not_configured") return { kind: "not_configured", eventStatus: null, connectionStatus: "not_configured" };
  // Any other word the adapter might invent is recorded as an error rather than crashing the sweep.
  const eventStatus = HEALTH_EVENT_STATUSES.includes(value) ? value : "error";
  let connectionStatus = "error";
  if (eventStatus === "healthy" || eventStatus === "recovered") connectionStatus = "healthy";
  else if (eventStatus === "degraded" || eventStatus === "rate_limited" || eventStatus === "timeout") connectionStatus = "degraded";
  return { kind: "checked", eventStatus, connectionStatus };
}
