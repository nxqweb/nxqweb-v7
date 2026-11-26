// "Guide me": step-by-step tours that point at the REAL buttons on the REAL portal pages. Tours are plain data (page, target, words), so adding
// one never needs new code. A target is an element carrying data-tour="<name>"; scripts/test-guide-tour.mjs fails if a tour names a target or a
// page that does not exist. Pure functions only in this file (no DOM, no storage), so everything here is tested offline.
export type TourStep = {
  path: string; // the page this step lives on
  pageLabel: string; // what that page is called in the menu
  target: string; // data-tour name of the element to highlight
  title: string;
  text: string;
  missing?: string; // shown when the element is not on the screen yet (for example a button that appears later)
};
export type Tour = { id: string; label: string; steps: TourStep[] };

const products = { path: "/client/commerce/products", pageLabel: "Products" };
const photos = { path: "/client/commerce/images", pageLabel: "Photos" };
const live = { path: "/client/commerce/live", pageLabel: "Live store" };
const orders = { path: "/client/commerce/orders", pageLabel: "Orders" };
const home = { path: "/client/commerce", pageLabel: "Dashboard" };

const formStep: TourStep = { ...products, target: "product-form", title: "Describe your product", text: "Type the product name and its price. Add a short description, the size and how many you have. You can skip anything marked optional." };
const saveStep: TourStep = { ...products, target: "product-save", title: "Save it", text: "Press Save product draft. Your product is saved, and customers cannot see it yet." };
const uploadStep: TourStep = { ...photos, target: "photos-upload", title: "Add photos", text: "Find your product and press Upload photos. Use JPG or PNG pictures. The first photo is the main one customers see.", missing: "Save a product first. Each saved product gets its own Upload photos button on this page." };
const visibleStep: TourStep = { ...live, target: "live-visibility", title: "Show it in your shop", text: "Press Make visible next to a product so customers can see it. Hide product takes it off your shop again." };
const orderModeStep: TourStep = { ...live, target: "live-order-mode", title: "Choose how customers order", text: "Pick one way: online with a payment link, by email, or a menu customers call about. Then press Save ordering choice.", missing: "This choice appears once your store settings have loaded. If it stays missing, use Report a problem." };
const paymentStep: TourStep = { ...live, target: "live-payment", title: "Add how you get paid", text: "For online ordering, paste ONE payment link (PayPal, Venmo or Stripe) and press Save private draft. Never type a password here." };
const shareStep: TourStep = { ...live, target: "live-share", title: "Share your shop", text: "Press Copy store link, then paste it on Instagram, in emails or on your business cards.", missing: "The link appears here once your store is open. Open your store first, then come back to this step." };

const getPaidStep: TourStep = { ...live, target: "live-get-paid", title: "Not sure how to get a link?", text: "Press PayPal, Venmo or Stripe here for three short steps. Then press Test my link to check it opens your own payment page.", missing: "This help shows when your store takes orders online. Choose online ordering first." };

export const tours: Tour[] = [
  { id: "welcome", label: "Show me around", steps: [
    { ...home, target: "nav-products", title: "Products", text: "This is where you add what you sell: the name, the price and how many you have." },
    { ...home, target: "nav-images", title: "Photos", text: "Add pictures of each product here." },
    { ...home, target: "nav-live", title: "Live store", text: "Open your shop, choose which products customers can see, and set how customers pay." },
    { ...home, target: "nav-orders", title: "Orders", text: "When someone orders, it shows up here." },
    { ...home, target: "guide-button", title: "Help is always here", text: "Press Guide me on any page and pick what you want to do. We will point at each button, one step at a time." },
  ] },
  { id: "post-product", label: "Post a product", steps: [formStep, saveStep, uploadStep, visibleStep] },
  { id: "add-photos", label: "Add photos to a product", steps: [uploadStep] },
  { id: "show-in-shop", label: "Show a product in my shop", steps: [visibleStep] },
  { id: "how-to-order", label: "Choose how customers order and pay", steps: [orderModeStep, paymentStep, getPaidStep] },
  { id: "share-link", label: "Share my store link", steps: [shareStep] },
  { id: "see-orders", label: "See my orders", steps: [
    { ...orders, target: "orders-head", title: "Your orders", text: "Every order is listed on this page with the customer, what they bought and the total. Update each order as you pack and send it." },
  ] },
];

export const findTour = (id: unknown): Tour | null => tours.find((tour) => tour.id === id) || null;

// What is remembered while a tour runs (kept for this browser tab only, so a tour survives moving to another page).
export type TourProgress = { tourId: string; step: number };
export function parseProgress(raw: string | null | undefined): TourProgress | null {
  if (!raw || raw.length > 200) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { tourId, step } = parsed as { tourId?: unknown; step?: unknown };
  const tour = findTour(tourId);
  if (!tour || typeof step !== "number" || !Number.isInteger(step) || step < 0 || step >= tour.steps.length) return null;
  return { tourId: tour.id, step };
}
export const serializeProgress = (progress: TourProgress): string => JSON.stringify({ tourId: progress.tourId, step: progress.step });

// Where the words go: under the highlighted element when there is room, above it otherwise, always fully on the screen.
// On a narrow screen the words are docked to the bottom edge instead (done in CSS), so this is only used on wide screens.
export type Box = { top: number; left: number; width: number; height: number };
export function bubblePlace(target: Box, viewport: { width: number; height: number }, bubble: { width: number; height: number }, gap = 14, edge = 12): { top: number; left: number; side: "below" | "above" } {
  const maxLeft = Math.max(edge, viewport.width - bubble.width - edge);
  const left = Math.min(Math.max(edge, target.left + target.width / 2 - bubble.width / 2), maxLeft);
  const below = target.top + target.height + gap;
  const fitsBelow = below + bubble.height + edge <= viewport.height;
  const above = target.top - gap - bubble.height;
  const side: "below" | "above" = fitsBelow || above < edge ? "below" : "above";
  const maxTop = Math.max(edge, viewport.height - bubble.height - edge);
  const top = Math.min(Math.max(edge, side === "below" ? below : above), maxTop);
  return { top, left, side };
}
