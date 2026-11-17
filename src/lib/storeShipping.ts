// The store's shipping rule (draft migration 08). Pure helpers shared by the public store page and the owner's Live store page.
// The server always works out the real fee; what is computed here is only the preview the shopper sees before ordering.
// Any missing or odd value means "no shipping fee", so an older database (without the shipping functions) behaves exactly as before.

export type ShippingRule = { mode: "none" | "flat"; flatFee: number; freeOver: number | null; pickupAllowed: boolean; pickupNote: string };
export type DeliveryMethod = "ship" | "pickup";

export const noShipping: ShippingRule = { mode: "none", flatFee: 0, freeOver: null, pickupAllowed: false, pickupNote: "" };

const money = (value: unknown): number | null => {
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(amount) && amount >= 0 && amount <= 999999.99 ? Math.round(amount * 100) / 100 : null;
};

export function shippingRuleFromRow(row: unknown): ShippingRule {
  if (!row || typeof row !== "object" || Array.isArray(row)) return noShipping;
  const raw = row as Record<string, unknown>;
  const fee = money(raw.flat_fee);
  const flat = raw.mode === "flat" && fee !== null && fee > 0;
  const freeOver = flat ? money(raw.free_over) : null;
  const pickupAllowed = raw.pickup_allowed === true;
  return {
    mode: flat ? "flat" : "none",
    flatFee: flat ? fee : 0,
    freeOver: freeOver !== null && freeOver > 0 ? freeOver : null,
    pickupAllowed,
    pickupNote: pickupAllowed && typeof raw.pickup_note === "string" ? raw.pickup_note.trim().slice(0, 300) : "",
  };
}

// True when the page must use the shipping-aware order function (a fee can apply, or the shopper may choose pickup).
export const shippingRuleActive = (rule: ShippingRule): boolean => rule.mode === "flat" || rule.pickupAllowed;

// The same sum the server does: one fee per order, only when something needs shipping, never for pickup, free at or above the threshold.
export function shippingFor(rule: ShippingRule, subtotal: number, needsShipping: boolean, method: DeliveryMethod): number {
  if (rule.mode !== "flat" || !needsShipping) return 0;
  if (method === "pickup" && rule.pickupAllowed) return 0;
  if (rule.freeOver !== null && subtotal >= rule.freeOver) return 0;
  return rule.flatFee;
}

// One short line for the shopper, or "" when there is nothing to say.
export function shippingHint(rule: ShippingRule, subtotal: number, needsShipping: boolean, method: DeliveryMethod, format: (amount: number) => string): string {
  if (rule.mode !== "flat" || !needsShipping) return "";
  if (method === "pickup" && rule.pickupAllowed) return "Pickup is free.";
  if (rule.freeOver === null) return "";
  if (subtotal >= rule.freeOver) return "This order ships free.";
  return `Add ${format(Math.round((rule.freeOver - subtotal) * 100) / 100)} more for free shipping.`;
}

export type ShippingFormInput = { mode: string; flatFee: string; freeOver: string; pickupAllowed: boolean; pickupNote: string };
export type ShippingFormCheck =
  | { ok: true; args: { mode_value: "none" | "flat"; flat_fee_value: number; free_over_value: number | null; pickup_allowed_value: boolean; pickup_note_value: string | null } }
  | { ok: false; message: string };

// What the owner typed, checked in plain words before it is sent. The server repeats every check.
export function checkShippingForm(input: ShippingFormInput): ShippingFormCheck {
  const mode = input.mode === "flat" ? "flat" : "none";
  const note = input.pickupNote.trim();
  if (note.length > 300) return { ok: false, message: "Please keep the pickup note to 300 characters or fewer." };
  let fee = 0;
  let freeOver: number | null = null;
  if (mode === "flat") {
    const typedFee = money(input.flatFee.trim().replace(/^\$/, ""));
    if (typedFee === null || typedFee <= 0 || typedFee > 9999.99) return { ok: false, message: "Type the shipping fee as a number above 0, like 6.50." };
    fee = typedFee;
    if (input.freeOver.trim() !== "") {
      const typedFree = money(input.freeOver.trim().replace(/^\$/, ""));
      if (typedFree === null || typedFree <= 0) return { ok: false, message: "Type the free-shipping amount as a number above 0, like 50, or leave it empty." };
      freeOver = typedFree;
    }
  }
  return { ok: true, args: { mode_value: mode, flat_fee_value: fee, free_over_value: freeOver, pickup_allowed_value: input.pickupAllowed, pickup_note_value: input.pickupAllowed && note ? note : null } };
}

export const shippingFormFromRule = (rule: ShippingRule): ShippingFormInput => ({
  mode: rule.mode,
  flatFee: rule.mode === "flat" ? rule.flatFee.toFixed(2) : "",
  freeOver: rule.freeOver !== null ? rule.freeOver.toFixed(2) : "",
  pickupAllowed: rule.pickupAllowed,
  pickupNote: rule.pickupNote,
});
