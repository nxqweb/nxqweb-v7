// Client-safe reasons for Commerce RPC failures. Only messages our own SQL raises on purpose are shown (matched exactly, key =
// the SQL text); anything else (Postgres internals, network errors) keeps the caller's generic text so nothing technical leaks.
// The value is what the client reads, so jargon from the database is rewritten in plain words.
export const commerceReasonMessages: Record<string, string> = {
  "Client workspace not found.": "Client workspace not found.",
  "Product was not found in this workspace.": "Product was not found in this workspace.",
  "Product image must be a valid HTTPS URL.": "Product image must be a valid HTTPS URL.",
  "Every product image must be an existing image owned by this client workspace.":
    "That image link is not one of your uploaded photos. Upload photos on the Photos page, or leave the image box empty. Payment links and outside web links do not work there.",
  "Product price is invalid.": "Product price is invalid.",
  "This workspace has reached its live product limit.": "This workspace has reached its live product limit.",
  "Store name is required.": "Store name is required.",
  "Enter a public Stripe Payment Link beginning with https://buy.stripe.com/.": "Enter a public Stripe Payment Link beginning with https://buy.stripe.com/.",
  "Enter a valid legacy PayPal link.": "Enter a valid legacy PayPal link.",
  "Enter a valid legacy Venmo link.": "Enter a valid legacy Venmo link.",
  "Add a public payment link before opening the store.": "Add a public payment link before opening the store.",
};

export function commerceRpcReason(error: { message?: string | null } | null | undefined): string | null {
  const message = (error?.message ?? "").trim();
  return Object.prototype.hasOwnProperty.call(commerceReasonMessages, message) ? commerceReasonMessages[message] : null;
}

export function withCommerceReason(generic: string, error: { message?: string | null } | null | undefined): string {
  const reason = commerceRpcReason(error);
  return reason ? `${reason} ${generic}` : generic;
}
