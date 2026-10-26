// Public Privacy, Terms, About and Contact content. Written in plain words from what the system really does (see docs/PRIVACY_DATA_INVENTORY.md and
// docs/LEGAL_AND_DATA_CHECKLIST.md). THIS IS NOT LEGAL ADVICE and must be reviewed by a qualified person before launch: while legalReviewComplete is false
// every page shows a visible "Draft, pending legal review" notice. Flip it to true only after a lawyer has approved the final wording.
export const legalReviewComplete = false;
export const legalLastUpdated = "October 17, 2026";

export type InfoSection = { heading: string; paragraphs?: string[]; bullets?: string[] };
export type InfoPage = { slug: "privacy" | "terms" | "about" | "contact"; title: string; intro: string; legal: boolean; sections: InfoSection[] };

// Service providers that can receive personal data when their feature is switched on (from the privacy data inventory).
export const serviceProviders = [
  "Supabase (database, sign-in and file storage)",
  "Netlify (website hosting)",
  "GitHub (where website code is stored)",
  "Cloudflare Turnstile (spam protection on forms)",
  "A file scanning service (Scanii or Cloudmersive) that checks uploaded files for viruses",
  "Resend (sending email, when switched on)",
  "Stripe (payments, when billing is switched on)",
  "An AI service that helps draft website plans and replies (when switched on)",
];

export const privacyPage: InfoPage = {
  slug: "privacy",
  title: "Privacy Policy",
  intro: "This page explains, in plain words, what NXQX-Web collects, why, who helps us handle it, and the choices you have.",
  legal: true,
  sections: [
    { heading: "The short version", bullets: [
      "We collect what we need to build and run your website and to keep your account safe.",
      "We never store your card number. When payments are switched on, Stripe handles card details.",
      "We do not sell your personal information.",
      "You can ask for a copy of your data or withdraw your consent from your client portal, or by emailing us.",
    ] },
    { heading: "What we collect", bullets: [
      "Account details: your email address and a password (handled by our sign-in provider).",
      "About your business: your business name, your name, what you offer, where you serve, your goals, and answers you type into our forms.",
      "Messages and files you send us through the portal, including files you upload for your website.",
      "Website visitor numbers for sites on plans that include analytics, such as page views, clicks and how far people scroll. This only runs with the visitor's consent, and it does not record what visitors type.",
      "Security information, such as a one-way scrambled version of an internet address, the type of browser, and sign-in events, so we can protect accounts.",
      "Billing records: which plan you are on and payment status. When billing is live, Stripe holds your payment details.",
    ] },
    { heading: "What we do not collect", paragraphs: ["We do not ask for card numbers, bank numbers, Social Security numbers, government ID, or date of birth in the NXQX-Web portal. Please do not type passwords, card numbers or ID numbers into messages or form boxes."] },
    { heading: "How we use it", bullets: [
      "To build, launch and look after your website.",
      "To answer your questions and send service messages about your project.",
      "To keep accounts and sites secure and to prevent spam and abuse.",
      "To bill you and keep the records the law requires.",
      "To fix problems and improve the service.",
    ] },
    { heading: "Who helps us handle it", paragraphs: ["We use these service providers. They receive personal information only when the related feature is switched on, and only to do their job for us:"], bullets: serviceProviders },
    { heading: "Your customers' and visitors' data", paragraphs: ["If your website or online store collects information from your own customers or visitors (for example orders or contact forms), that information belongs to your business. We handle it for you so the site works. You are responsible for telling your own customers how you use it."] },
    { heading: "The Ask a question button on client websites", paragraphs: ["Some client websites have an Ask a question button that shows answers the business wrote. When a visitor types a question, it is checked against those answers. If no answer fits, the question may be saved for the business so it can add one. We do not save a question that looks like it holds personal details, such as an email address, a long number or a web link, and we do not save the visitor's IP address or identity. Please do not type personal or private information into it."] },
    { heading: "Your choices", bullets: [
      "Ask for a copy of your account data, or withdraw a consent, from the Security and privacy page in your client portal.",
      "Ask us to correct or delete information by emailing us. We will say what we can delete and what we must keep for legal or security reasons.",
      "Opt out of marketing email at any time using the link in any email, or by telling us.",
    ] },
    { heading: "How long we keep it", paragraphs: ["We keep information only as long as we need it for the service or the law. As a guide: portal messages about three years, and security and audit records up to about seven years. Some records may be kept longer if the law requires it."] },
    { heading: "Cookies and analytics", paragraphs: ["The NXQX-Web site uses only what it needs to keep you signed in and the site working. Visitor analytics on client websites runs only with the visitor's consent."] },
    { heading: "Children", paragraphs: ["NXQX-Web is for business owners aged 18 or older. We do not knowingly collect information from children."] },
    { heading: "Changes and contact", paragraphs: ["If we change what we collect, we will update this page. Questions or requests: email the address on our Contact page."] },
  ],
};

export const termsPage: InfoPage = {
  slug: "terms",
  title: "Terms of Service",
  intro: "These terms describe the agreement between you and NXQX-Web when you use our managed website service.",
  legal: true,
  sections: [
    { heading: "What the service is", paragraphs: ["NXQX-Web designs, builds, hosts and maintains premium websites for businesses, with a client portal for requests, files and messages. What you get depends on your plan."] },
    { heading: "Your account", bullets: [
      "You must be 18 or older and have the right to act for your business.",
      "Keep your password private. You are responsible for what happens under your account.",
      "Give us accurate information and tell us when it changes.",
    ] },
    { heading: "Plans and payment", bullets: [
      "Plans are billed monthly at the price shown when you chose your plan. Plans and features are listed on our Plans page.",
      "Payments are handled by Stripe when billing is switched on. We do not store card numbers.",
      "[To be confirmed with legal review: late payment, pausing service for unpaid invoices, and price changes.]",
    ] },
    { heading: "Your content and your domain", bullets: [
      "You keep ownership of the text, photos, logos and other material you give us.",
      "You give us permission to use that material to build and run your website.",
      "You keep ownership of your domain name. We only give you instructions. We never need your registrar password.",
    ] },
    { heading: "What we do not promise", paragraphs: ["We work hard on every site, but we cannot promise search rankings, visitors, leads or sales. Reports and analytics are summaries to help you decide, not guarantees."] },
    { heading: "Answers you write for your website", paragraphs: ["If you turn on the Ask a question button, you write the questions and answers it shows. You are responsible for those answers being true, current and lawful, and you should not put medical, legal, financial or safety advice in them unless you are qualified to give it. The button only shows what you wrote, and it is not a person or a promise from NXQX-Web."] },
    { heading: "AI tools", paragraphs: ["We may use AI tools to help draft website plans, text and replies. Important steps are reviewed by a person before they go live."] },
    { heading: "Online stores", paragraphs: ["If you use NXQX-Web to run a store, you are the seller. You are responsible for your products, prices, orders, shipping, refunds, taxes and local laws. Payment links go to your own payment provider, and we do not hold your customers' payments."] },
    { heading: "Acceptable use", paragraphs: ["Do not use the service for anything illegal, deceptive or harmful, to send spam, or to put other people's private information on your site without permission. We may remove content or pause a site that breaks these rules."] },
    { heading: "Cancelling", paragraphs: ["[To be confirmed with legal review: how to cancel, notice period, refunds, and what happens to your site and files after you cancel.]"] },
    { heading: "Limits and governing law", paragraphs: ["[To be confirmed with legal review: limits on liability, how disagreements are handled, and which state's law applies.]"] },
    { heading: "Changes and contact", paragraphs: ["We may update these terms. If a change matters, we will tell you before it applies. Questions: email the address on our Contact page."] },
  ],
};

export const aboutPage: InfoPage = {
  slug: "about",
  title: "About NXQX-Web",
  intro: "NXQX-Web builds and looks after premium websites for businesses, and keeps them part of an active system after launch.",
  legal: false,
  sections: [
    { heading: "What we do", paragraphs: ["We design a polished website for your business, launch it, and keep it healthy with updates, reports and improvements, all from one client portal."] },
    { heading: "How it works", bullets: [
      "Choose a plan and tell us about your business.",
      "We review your details and build a plan for your site.",
      "We build, check and launch your website.",
      "After launch you can ask for changes, see reports and message us from your portal.",
    ] },
    { heading: "Premium only", paragraphs: ["Every NXQX-Web site is built to look and work like a premium site."] },
    { heading: "Plans", paragraphs: ["Starter, Growth, Intelligence and Enterprise plans add more help with visibility, leads and ongoing improvement. See the Plans page for what each one includes."] },
    { heading: "What is open now", paragraphs: ["NXQX-Business is open now. Other systems, such as stores, booking, menus and more, are planned and open one at a time."] },
  ],
};

export const contactPage: InfoPage = {
  slug: "contact",
  title: "Contact",
  intro: "Questions, privacy requests, or want to talk about your website? Email us.",
  legal: false,
  sections: [
    { heading: "Email", paragraphs: ["Use the address below. Please do not include passwords, card numbers or ID numbers."] },
    { heading: "Already a client?", paragraphs: ["Sign in to your portal. You can ask the assistant, send a question to the team, or press Report a problem on any page."] },
    { heading: "Privacy requests", paragraphs: ["To ask for a copy of your data, a correction, or a deletion, email us and say what you need. Signed-in clients can also use the Security and privacy page in the portal."] },
  ],
};

export const infoPages = { privacy: privacyPage, terms: termsPage, about: aboutPage, contact: contactPage } as const;
export const footerLinks = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;
