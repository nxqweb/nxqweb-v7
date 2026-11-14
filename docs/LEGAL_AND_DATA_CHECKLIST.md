# Legal and data checklist: "are we required to collect certain info?" (written 2026-10-17)

**Not legal advice. I am not a lawyer.** This lists what the system actually collects (from the code and `docs/PRIVACY_DATA_INVENTORY.md`), the
general kinds of rules that usually apply to a business like NXQX-Web, and the exact questions to ask a lawyer or accountant. Rules vary by
state and country, and change. Treat every "usually" below as a question to confirm, not an answer.

## 1. The short answer
- In general, **no law makes a small web business collect extra personal data about customers**, and privacy rules push the other way: collect only what you need.
- What a business is usually **required to keep** is *records*: invoices, payments, tax records and contracts, for a number of years. NXQX-Web keeps those through billing records and, later, Stripe.
- What a business is usually **required to provide** is *information to the customer*: a privacy policy, terms, a way to opt out of marketing email, and a way to ask about their data.
- Some obligations come from **other companies**, not the government: Stripe will collect and verify the owner's identity and bank details itself (NXQX never needs your SSN, ID, or bank number in the app), and Google/Stripe ask for public privacy and terms pages.

## 2. What the system collects today (verified against the code)
| Data | Why | Needed? | Notes |
|---|---|---|---|
| Email and password (login) | Account | Yes | Passwords are handled by Supabase Auth, never stored by NXQX in plain text |
| Business name, contact name | Run the project, invoices | Yes | |
| Services/what the business does, service area, main goal, extra answers | Build the website | Yes for the service | Free text: clients may type more than needed. The form says what to include |
| Phone | Contact | **Optional** in most places | Only collect it where you really call people |
| Messages and uploaded files | Support, building the site | Yes for the service | Files are scanned by a malware service (Scanii or Cloudmersive) |
| Website visitor analytics (clients on Growth and up) | Reports | Optional, consent-gated | No IP column; coarse clicks and scroll only; no typed text |
| Contact-form protection fingerprint | Stop spam | Yes | A one-way hash of IP + browser, not the IP itself |
| Security events (hashed IP, browser family) | Protect accounts | Yes | Kept about 7 years: **ask a lawyer whether that is justified** |
| Billing records | Get paid | Yes | No card numbers stored by NXQX; Stripe holds card data once billing is live |
| Referral data (codes, credits) | Rewards | Only if the program is on | Program is OFF |
| Store customers' name, email, address (Commerce clients' shoppers) | Fill orders | The CLIENT's data | NXQX stores it for the client (likely a "processor"; the client is the "controller") |

**Things we do NOT collect:** card numbers, bank numbers, SSN or tax ID, government ID, date of birth, health data, precise location, or anything from children.

## 3. Possible over-collection to review (smaller is safer)
1. **Keep phone optional** and say why it is asked.
2. **Security event retention of about 7 years** is long. Shorten unless a lawyer says to keep it.
3. **Free-text intake boxes** invite sensitive details; the forms should say "do not include passwords, card numbers or ID numbers".
4. **Order notes and addresses in client stores** are the client's customers' data: tell Commerce clients to collect only what they ship with, and to delete old practice orders.
5. **Analytics must stay opt-in** for visitors in places that require it (EU/UK especially).

## 4. Rules that commonly apply (questions for a lawyer, by topic)
| Topic | Why it might apply | Question to ask |
|---|---|---|
| Privacy policy | Almost every site that collects emails; also Stripe and Google OAuth review | Does our drafted policy (page `/privacy`, draft banner on) cover everything? |
| Terms of service | Contract with clients: scope, payment, cancellation, no guarantees | Cancellation, refunds, liability cap, governing law |
| California privacy law (CCPA/CPRA) | Applies above certain revenue/data thresholds | Are we under the thresholds? Do we still want a "request my data" path (we have export and consent withdrawal) |
| EU/UK law (GDPR) | If we knowingly serve EU/UK people | Do we serve or market to them? If yes, we need a legal basis list, sub-processor list, and a data processing agreement |
| Email marketing (CAN-SPAM, state laws) | Our outreach emails to prospects | Needs a real postal address and a working opt-out in every email, honored promptly. **Outreach is OFF; we have no postal address set up yet** |
| Texting | Not used | Do not text without prior written consent |
| Children (COPPA) | Not applicable: business owners only | Add "must be 18 or older" to the terms |
| Accessibility (ADA) | Public sites are often targeted | We test with axe; keep doing it; consider an accessibility statement |
| Sales tax for client stores | The client's duty, not ours | Terms should say each store owner is responsible for their own taxes and laws |
| Business registration, licenses, insurance | Needed to run and to open a Stripe account | Entity type, state registration, business bank account |
| Referral rewards | Disclosure, tax, fairness | See `docs/REFERRAL_TERMS_DRAFT.md` |
| Founding Business Grant | Contest/sweepstakes-like rules | Needs its own written award terms |
| AI use | Disclosure when AI drafts content | Say so in the terms; do not feed clients' private files to a model without telling them |
| Data breach notice | Most states require telling affected people | Write a short incident plan: who tells whom, how fast |

## 5. What we are building (draft, banner on until reviewed)
Public pages `/privacy`, `/terms`, `/about`, `/contact` written in plain words from the facts above. They show a visible "Draft, pending legal review" notice until the
owner sets `legalReviewComplete = true` in `src/lib/legalContent.ts` after a lawyer has checked them.

## 6. Owner to-do list (no code needed)
- [ ] Pick a lawyer or a legal-forms service; ask them the questions in section 4.
- [ ] Decide a postal address for email footers (a PO box or virtual office is common).
- [ ] Decide cancellation, refund and notice rules, then update the terms.
- [ ] Decide whether you will market to people in the EU/UK.
- [ ] Decide retention for security logs and billing records with your accountant.
- [ ] Make a sub-processor list (the providers named in the privacy page) and sign each provider's data processing terms where offered.
