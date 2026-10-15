// Client-safe reasons for Commerce RPC failures. Only messages our own SQL raises on purpose are shown; anything else
// (Postgres internals, network errors) keeps the caller's generic text so nothing technical leaks to clients.
const knownReasons = [
  "Client workspace not found.",
  "Product was not found in this workspace.",
  "Product image must be a valid HTTPS URL.",
  "Product price is invalid.",
  "This workspace has reached its live product limit.",
  "Store name is required.",
  "Enter a public Stripe Payment Link beginning with https://buy.stripe.com/.",
  "Enter a valid legacy PayPal link.",
  "Enter a valid legacy Venmo link.",
  "Add a public payment link before opening the store.",
] as const;

export function commerceRpcReason(error: { message?: string | null } | null | undefined): string | null {
  const message = (error?.message ?? "").trim();
  return knownReasons.find((reason) => message === reason) ?? null;
}

export function withCommerceReason(generic: string, error: { message?: string | null } | null | undefined): string {
  const reason = commerceRpcReason(error);
  return reason ? `${reason} ${generic}` : generic;
}
