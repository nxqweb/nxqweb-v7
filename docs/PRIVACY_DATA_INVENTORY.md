# Privacy data inventory — what NXQ collects (from the code)

Written 2026-10-04 from reading migrations, Edge functions, and the website template. This is a
**partial engineering review, not legal advice**. Use it as the factual basis for a privacy
policy that a qualified person must review before launch (already an open item under "legal
copy"). Where something could not be confirmed from code it is marked (verify).

## 1. What is collected, by area

| Area | Data | Where / notes |
|---|---|---|
| Accounts and signup | Email (login), names, business name, contact name, phone, city/postal code, free-text notes | `clients`, intake tables, auth. Collected from the person signing up. |
| Client messages | Message text and notes between client and owner | Retention policy `client_messages`: 1,095 days, legal hold supported. |
| Client files | Uploaded files (private storage bucket), SHA-256 checksum, scan result | Contents are sent to the malware-scan provider for scanning (see section 3). |
| Website contact forms (on client sites) | Whatever fields the client's form defines, plus a **request fingerprint**: a SHA-256 hash of a secret salt + IP address + browser user-agent | `business_lead_intake_attempts` stores only the hash, for rate limiting. The visitor's IP is also sent to Cloudflare Turnstile to verify the visitor is human (it is not stored by the function). |
| Visitor analytics (optional, consent-based) | Page views, clicks, scroll depth, coarse heatmap coordinates, an anonymous session key, consent version | `website_analytics_events` has **no IP column**. Template privacy text says it does not collect form text or passwords. Raw events: 90 days (hard delete 120); daily aggregates: 730 days (800). Heatmap data only on supported plans. |
| Account security events | Event type, severity, **hashed IP**, user-agent *family*, device reference | `account_security_events`; retention `security_events`: 2,555 days (about 7 years). |
| Automation audit log | Operational actions on accounts and jobs | Retention `automation_audit`: 2,555 days, legal hold supported. |
| Identity verification references | Reference values only | Retention 365 days. |
| Billing | Manual billing state and notes today. After Stripe is enabled: Stripe customer-to-client mapping | NXQ does not store card numbers; Stripe would hold payment details. Billing is not live. |
| Notifications | Recipient email and message content | Sent through the email provider (Resend, when configured). |
| AI features | Business details used in the build plan and change-request text | Sent to the configured AI provider (not yet configured). |

## 2. Data-subject requests (privacy rights)

`process-data-subject-request` handles requests. Seen in the code: **export** (a bounded export of
the account, product memberships, client profile and related records) and **consent withdrawal**,
with a notification to the person when done. (Verify: whether erasure/deletion and rectification
request types are implemented, and what an erasure removes versus retains under legal hold.)

## 3. Third parties that receive personal data (candidate sub-processors)

Supabase (database, auth, storage), Netlify (website hosting), GitHub (source repositories),
Cloudflare Turnstile (bot check; sees visitor IP), a malware-scan provider (receives uploaded
files; Cloudmersive today, alternatives under review), an email provider (Resend), an AI provider
(when configured), Stripe (when billing is enabled). Each needs a data processing agreement and a
line in the privacy policy. Hosting providers also keep their own server logs that include IP
addresses, outside NXQ's control (verify each provider's retention).

## 4. Things to decide or verify before launch

1. **Retention lengths.** Seven years for security events and the audit log is long and should be
   justified by a legal basis, or shortened.
2. **Raw IP anywhere?** NXQ code stores hashes, but check Turnstile, Supabase, and Netlify logs.
3. **Salt handling.** The request fingerprint depends on a secret salt (`NXQ_LEAD_FINGERPRINT_SALT`);
   keep it in secrets only, and rotating it changes all fingerprints.
4. **Consent/cookies.** The template's analytics is consent-based; confirm what a visitor sees
   (banner wording, withdrawal path) and that the policy matches (verify).
5. **Client-side content.** Clients' own websites collect their visitors' data. NXQ is likely a
   processor for that data and each client a controller; the terms should say so.
6. **Policy must match the code.** Any change to what is collected needs a policy update.
7. **Malware scanner choice** affects what leaves your control: a hosted scanner receives client
   files; self-hosting would not. See `docs/UNIT_ECONOMICS_AND_SCALE.md` section 5.
