// The portal assistant's instant answers. This is a prepared list of plain-words answers matched against what the client typed, NOT a live AI model:
// it never invents anything, and anything it cannot answer (or that needs a person: billing, cancelling, privacy requests) is offered to the NXQX team
// instead. A real AI can be plugged in later by replacing answerQuestion() only; the chat screen does not change.
export type AssistantLink = { href: string; label: string };
export type FaqEntry = { id: string; keywords: string[]; answer: string; link?: AssistantLink; needsTeam?: boolean };
export type AssistantReply = { text: string; link?: AssistantLink; offerTeam: boolean; matched: string | null };

export const faq: FaqEntry[] = [
  { id: "who", keywords: ["who are you", "are you ai", "are you a bot", "are you real", "are you human", "robot"], answer: "I am the NXQX assistant. I answer common questions instantly from a prepared list. I am not a person, and I only say what I know is true. If I cannot help, I can pass your question to the NXQX team and they reply right here." },
  { id: "hello", keywords: ["hello", "hi there", "hey", "good morning", "good afternoon"], answer: "Hi! Ask me anything about your website or your store, for example: what is SEO, how do I add a product, or how do I change my website." },
  { id: "seo", keywords: ["seo", "search engine", "google ranking", "rank on google", "show up on google", "found on google"], answer: "SEO means helping people find your website when they search on Google. It is things like clear page titles, the words people actually search for, and your service area. You do not need to do anything technical: NXQX sets this up for you. Your SEO page shows what was done and what is still open.", link: { href: "/client/business/seo", label: "Open my SEO page" } },
  { id: "analytics", keywords: ["analytics", "visitors", "traffic", "how many people", "heatmap", "clicks", "scroll"], answer: "Analytics shows how many people visit your site and what they click. It is included from the Growth plan up, and heat maps are an Intelligence feature. It only counts visits it is allowed to, and it never records what visitors type.", link: { href: "/client/business/analytics", label: "Open my analytics" } },
  { id: "plans", keywords: ["plan", "plans", "tier", "tiers", "upgrade", "downgrade", "price", "prices", "pricing", "how much", "cost", "costs", "per month", "monthly", "starter", "growth", "intelligence", "enterprise"], answer: "There are four plans: Starter $50 a month, Growth $100, Intelligence $150 and Enterprise from $300. Each one adds more help with search visibility, leads and ongoing improvements. You can ask for a change in your settings and the NXQX team reviews it.", link: { href: "/client/settings", label: "Plan and upgrades" } },
  { id: "timing", keywords: ["how long", "when will", "when is my website", "launch date", "ready yet", "how soon", "status of my website", "timeline"], answer: "I cannot promise a date, because it depends on your setup and on review. The project tracker on your dashboard shows exactly which stage you are in: Setup, Owner Review, Planning, Building, Launch checks or Live. If something looks stuck, I can send a note to the team.", link: { href: "/client", label: "See my project tracker" } },
  { id: "change", keywords: ["change my website", "update my website", "edit my website", "change text", "change a photo", "change the", "update the", "new page", "add a page", "make a change"], answer: "Send a change request and the NXQX team will handle it. Describe what you want changed and where, and add photos or files if you have them.", link: { href: "/client/business/changes", label: "Request a website change" } },
  { id: "files", keywords: ["upload", "logo", "photos for my website", "send photos", "send files", "attach"], answer: "You can upload your logo, photos and documents in the Upload files box on your dashboard. Images only for photos, and the team sees them as soon as they are uploaded.", link: { href: "/client", label: "Go to my dashboard" } },
  { id: "domain", keywords: ["domain", "my own address", ".com", "dns", "connect my domain", "website address"], answer: "To use your own web address, fill in the domain box on your dashboard with the address and where you bought it. The team then tells you exactly what to change at your registrar. You never need to share your registrar password.", link: { href: "/client", label: "Go to my dashboard" } },
  { id: "login", keywords: ["password", "log in", "login", "sign in", "locked out", "forgot"], answer: "On the login page, press Forgot password and follow the email. If the email does not arrive, check spam, wait a few minutes, then ask me to pass it to the team. Never send your password to anyone, including me.", link: { href: "/portal/login", label: "Go to login" } },
  { id: "add-product", keywords: ["add a product", "add product", "new product", "create a product", "add candles", "add items", "list a product", "how do i add"], answer: "Open Products, type the name and price, and how many you have (On hand). Save it, then add photos on the Photos page, and finally press Make visible on the Live store page. Products stay private until you do that.", link: { href: "/client/commerce/products", label: "Add a product" } },
  { id: "photos", keywords: ["product photo", "product picture", "product image", "add pictures", "add images"], answer: "Product photos are added on the Photos page: pick the product and upload 1 to 8 JPG, PNG, WEBP or GIF images. The first one is the main photo.", link: { href: "/client/commerce/images", label: "Add photos" } },
  { id: "open-store", keywords: ["open my store", "store is not open", "not open yet", "make my store live", "go live", "open storefront", "store not showing", "customers cannot see"], answer: "Go to Live store, set the store name, choose how customers order, and press Open. If it says the store is not open yet, it just has not been opened. Products also need Make visible.", link: { href: "/client/commerce/live", label: "Open Live store" } },
  { id: "email-orders", keywords: ["order by email", "orders by email", "over email", "email orders", "by email", "without payment link", "no payment link"], answer: "On Live store, under How do customers order, pick By email. Customers press Email my order, their email app opens with the order written out, and you reply with how to pay. You need a contact email saved in About and contact first. This needs a recent update to be switched on, so if you do not see it yet, I can ask the team.", link: { href: "/client/commerce/live", label: "Open Live store" } },
  { id: "payment", keywords: ["venmo", "paypal", "stripe", "payment link", "get paid", "take payments", "accept payment", "payments"], answer: "Your store does not charge cards itself. Add ONE payment link (Venmo, PayPal or Stripe) on Live store and customers pay you directly with it. You mark the order as paid once the money arrives. Never type a secret key or password anywhere.", link: { href: "/client/commerce/live", label: "Set up payment" } },
  { id: "orders", keywords: ["my orders", "new order", "an order came", "confirm payment", "ship an order", "where are my orders", "order list"], answer: "Orders are on the Orders page. A new one waits for you to confirm that the payment arrived, then you can mark it as shipped or ready for pickup. Your dashboard also tells you how many are waiting.", link: { href: "/client/commerce/orders", label: "Open orders" } },
  { id: "stock", keywords: ["sold out", "out of stock", "inventory", "stock", "on hand", "how many left"], answer: "On hand is how many you can sell right now. At 0 the product shows as Sold out. Change it any time on the Products page, and the store updates for customers.", link: { href: "/client/commerce/products", label: "Open products" } },
  { id: "store-link", keywords: ["store link", "share my store", "store address", "store url", "link to my store"], answer: "Your store address is on the Live store page once the store is open, with a Copy store link button. Paste it in your social profiles or send it to customers.", link: { href: "/client/commerce/live", label: "Get my store link" } },
  { id: "problem", keywords: ["broken", "bug", "not working", "error", "something went wrong", "crash", "problem", "glitch"], answer: "Sorry about that. Press Report a problem (bottom right of the portal) and tell us what happened. It takes a few seconds and the team sees which page you were on.", needsTeam: true },
  { id: "billing", keywords: ["refund", "cancel", "cancellation", "invoice", "charged", "billing", "payment failed", "receipt"], answer: "Billing, refunds and cancelling need a person, so I do not answer those myself. I can send your question to the NXQX team and they reply right here.", needsTeam: true },
  { id: "privacy", keywords: ["delete my data", "delete my account", "privacy", "gdpr", "my data", "personal information"], answer: "Privacy and data requests need a person. I can send this to the NXQX team and they will reply right here.", needsTeam: true },
];

const normalize = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9.\s]/g, " ").replace(/\s+/g, " ").trim()} `;

// A keyword counts when it appears as whole words (so "hi" never matches inside "which"). Longer phrases score higher than single words.
function score(question: string, entry: FaqEntry): number {
  let best = 0;
  for (const keyword of entry.keywords) {
    if (question.includes(` ${keyword} `) || (keyword.startsWith(".") && question.includes(keyword))) best = Math.max(best, keyword.split(" ").length);
  }
  return best;
}

export const noAnswerText = "I do not have an answer for that yet. I can send your question to the NXQX team, and they will reply right here in your messages.";

export function answerQuestion(question: string): AssistantReply {
  const asked = normalize(question);
  if (asked.trim().length < 2) return { text: "Type your question and I will do my best to help.", offerTeam: false, matched: null };
  let top: FaqEntry | null = null;
  let topScore = 0;
  for (const entry of faq) {
    const value = score(asked, entry);
    if (value > topScore) { top = entry; topScore = value; }
  }
  if (!top) return { text: noAnswerText, offerTeam: true, matched: null };
  return { text: top.answer, link: top.link, offerTeam: Boolean(top.needsTeam), matched: top.id };
}

export const suggestedQuestions = ["What is SEO?", "How do I add a product?", "How do I change my website?", "How long will my website take?"];

// What the team receives when the client presses "Send to the NXQX team": the question in the client's own words, clearly marked.
export const maxTeamQuestionLength = 1000;
export function teamMessage(question: string): string {
  return `[Assistant question] ${question.replace(/\s+/g, " ").trim().slice(0, maxTeamQuestionLength)}`;
}
