// Shared display formatters. Each function is byte-for-byte equivalent in behavior to the local
// copy it replaced (proved by scripts/test-format-helpers.mjs). Variants with page-specific
// fallback text (for example "Not set" or "Custom") intentionally stay in their pages.

export function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

export function formatDateTimeShort(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

export function formatUsdWhole(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function formatMoneyIn(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value || 0));
}
