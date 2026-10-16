// Replayable first-launch guide for NXQX-Commerce clients. Steps follow the order that was proven end to end
// (setup -> product -> photos -> live store -> open store -> test order -> confirm payment -> add more products). Progress lives in this
// browser only; it is a convenience, never a source of truth about the store.

export type LaunchGuideStep = {
  id: string;
  title: string;
  summary: string;
  doThis: string[];
  watchOut: string;
  href: string;
  action: string;
};

export const launchGuideSteps: LaunchGuideStep[] = [
  {
    id: "setup",
    title: "Tell NXQX about your store",
    summary: "A short form so we know what you sell. Saving it never publishes anything.",
    doThis: [
      "Type your store name, roughly how many products you have, and what you sell.",
      "Write your main category (for example: Candles).",
      "Tick Shipping if you ship orders, and type your payment provider (Stripe, PayPal, or Venmo).",
      "Scroll to the bottom and press Save draft.",
    ],
    watchOut: "Everything else on the form is optional. Press Save draft, not Submit, until you are ready for NXQX to review it.",
    href: "/client/commerce/setup",
    action: "Open setup",
  },
  {
    id: "product",
    title: "Add your first product",
    summary: "Each product starts as a private draft until you make it visible.",
    doThis: [
      "Enter the product name, base price, and a short description.",
      "Scroll to Variant 1 and enter the same price, plus how many you have on hand.",
      "Press Save product draft. It then appears under Product drafts.",
    ],
    watchOut: "The variant Price and On hand boxes start at 0. Leave them at 0 and the product shows as $0 or sold out.",
    href: "/client/commerce/products",
    action: "Add a product",
  },
  {
    id: "photos",
    title: "Add photos to your product",
    summary: "Customers buy what they can see.",
    doThis: [
      "Open Photos and pick the product you just saved.",
      "Press Upload photos and choose up to 8 clear, well-lit pictures. The first one is the main photo.",
      "Check the photos show up, then go on to the Live store page.",
    ],
    watchOut: "Photos are added on the Photos page. Never paste a web address or a payment link into the Live store image box.",
    href: "/client/commerce/images",
    action: "Open photos",
  },
  {
    id: "live",
    title: "Connect your payment link and show the store",
    summary: "Customers pay you directly. NXQX never holds your money.",
    doThis: [
      "Set the Store name exactly as customers should see it. It is separate from the setup form name.",
      "Paste your public payment link into the Stripe Payment Link box (it starts with https://buy.stripe.com/).",
      "Press Save private draft.",
      "Under Product visibility, press Make visible on each product you want customers to see.",
    ],
    watchOut: "Only the Stripe Payment Link box takes the payment link. The product image box on Live store only accepts a photo you uploaded on the Photos page, never a payment link or an outside web link, so leave it empty and add photos on the Photos page. Never paste a secret key or password anywhere.",
    href: "/client/commerce/live",
    action: "Open live store",
  },
  {
    id: "open",
    title: "Open your store and look at it",
    summary: "Check it the way a customer will see it.",
    doThis: [
      "On the Live store page press Open storefront and confirm.",
      "Press Open verified storefront when it appears.",
      "Check the product name, price, and that Add to cart works.",
    ],
    watchOut: "If the product is missing, go back to Live store and make sure it says active, not draft.",
    href: "/client/commerce/live",
    action: "Open live store",
  },
  {
    id: "test-order",
    title: "Place a practice order",
    summary: "Walk through checkout once so nothing surprises you with a real customer.",
    doThis: [
      "In your store, press Add to cart, then fill in made-up customer details.",
      "Press Place order and continue to payment and note the order number it shows.",
      "Press Continue to Stripe to confirm it opens your payment page.",
    ],
    watchOut: "Use made-up details, not a real customer's email. A practice order holds one unit of stock until you cancel it in Orders.",
    href: "/client/commerce/orders",
    action: "Open orders",
  },
  {
    id: "orders",
    title: "Confirm payments when money arrives",
    summary: "Real orders appear in Orders. You mark each one paid after you see the money.",
    doThis: [
      "Open Orders and find the new order by its number.",
      "Check your own Stripe, PayPal, or Venmo to see that the money arrived.",
      "Only then press Confirm payment received, and update fulfillment as you ship.",
    ],
    watchOut: "Never confirm a payment you have not seen arrive in your own account.",
    href: "/client/commerce/orders",
    action: "Open orders",
  },
  {
    id: "more",
    title: "Add more products any time",
    summary: "Repeat the same three steps for every new product.",
    doThis: [
      "Products: enter the name, price and description, then the Variant price and On hand, and press Save product draft.",
      "Photos: upload the pictures for that product.",
      "Live store: press Make visible on that product. It stays hidden until you do.",
    ],
    watchOut: "Open your store afterward and check the new product. A product left at $0 or 0 on hand shows as $0 or sold out.",
    href: "/client/commerce/products",
    action: "Add a product",
  },
];

export const guideStorageKeys = {
  done: "nxq-commerce-launch-guide-done-v1",
  autoOff: "nxq-commerce-launch-guide-auto-off-v1",
} as const;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function readDoneSteps(storage: StorageLike | null = browserStorage()): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(guideStorageKeys.done) || "[]");
    if (!Array.isArray(parsed)) return [];
    const known = new Set(launchGuideSteps.map((step) => step.id));
    return parsed.filter((id): id is string => typeof id === "string" && known.has(id));
  } catch { return []; }
}

export function writeDoneSteps(ids: string[], storage: StorageLike | null = browserStorage()) {
  try { storage?.setItem(guideStorageKeys.done, JSON.stringify(ids)); } catch { /* convenience only */ }
}

export function toggleStepDone(done: string[], id: string): string[] {
  return done.includes(id) ? done.filter((item) => item !== id) : [...done, id];
}

export function guideProgress(done: string[]) {
  const count = launchGuideSteps.filter((step) => done.includes(step.id)).length;
  return { count, total: launchGuideSteps.length, percent: Math.round((count / launchGuideSteps.length) * 100), complete: count === launchGuideSteps.length };
}

export function nextStepIndex(done: string[]): number {
  const index = launchGuideSteps.findIndex((step) => !done.includes(step.id));
  return index === -1 ? 0 : index;
}

export function readAutoOff(storage: StorageLike | null = browserStorage()): boolean {
  try { return storage?.getItem(guideStorageKeys.autoOff) === "true"; } catch { return false; }
}

export function writeAutoOff(off: boolean, storage: StorageLike | null = browserStorage()) {
  try { if (off) storage?.setItem(guideStorageKeys.autoOff, "true"); else storage?.removeItem(guideStorageKeys.autoOff); } catch { /* convenience only */ }
}

// The dashboard nudges new clients until they finish the guide or turn the nudge off.
export function shouldShowGuidePrompt(done: string[], autoOff: boolean): boolean {
  return !autoOff && !guideProgress(done).complete;
}
