// One "Request your ..." front door for every product line. The words, the third step and where the button goes are decided here, in one place,
// so Business, Booking and Commerce clients all see the same three steps (account, plan, request) and a new line is one more entry.
// This only chooses wording and a destination. It never gates anything: the plan lock lives on the send button, and the server decides the rest.

export type ProductFlow = {
  family: string;
  noun: string;
  title: string;
  requestStep: string;
  buttonLabel: string;
  // null = the brief opens inside the portal; a path = the line has its own setup page.
  setupHref: string | null;
};

const BUSINESS: ProductFlow = {
  family: "business",
  noun: "website",
  title: "Request your website",
  requestStep: "A short form, already filled in with what we know. You can start it now; it is saved on this device until you send it.",
  buttonLabel: "Request your website",
  setupHref: null,
};

const FLOWS: Record<string, ProductFlow> = {
  business: BUSINESS,
  booking: {
    ...BUSINESS,
    family: "booking",
    noun: "booking website",
    title: "Request your booking website",
    buttonLabel: "Request your booking website",
  },
  commerce: {
    family: "commerce",
    noun: "store",
    title: "Request your store",
    requestStep: "Your store setup page, already filled in with what we know. Only the store name is required, and you can save a draft any time.",
    buttonLabel: "Set up your store",
    setupHref: "/client/commerce/setup",
  },
};

export function productFlowFor(slug: unknown): ProductFlow {
  const key = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(FLOWS, key) ? FLOWS[key] : BUSINESS;
}

export function familySlugFromMetadata(metadata: unknown): string {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  return typeof meta.product_family_slug === "string" ? meta.product_family_slug.trim().toLowerCase().slice(0, 60) : "";
}

// What the client already told us at signup, shaped for the store setup page. Only text, trimmed, only used to fill EMPTY boxes.
export function commerceSetupPrefill(metadata: unknown, businessName: unknown): { storeName: string; productTypes: string } {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const answers = meta.intake_family_answers && typeof meta.intake_family_answers === "object" ? (meta.intake_family_answers as Record<string, unknown>) : {};
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return {
    storeName: text(businessName, 120),
    productTypes: text(answers.products, 2000) || text(answers.services, 2000) || text(meta.intake_family_details, 2000),
  };
}
