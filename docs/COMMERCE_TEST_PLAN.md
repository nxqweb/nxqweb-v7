# NXQX-Commerce test plan (written 2026-10-16)

A step-by-step manual test of the whole Commerce path, from a new client to a customer's order. Run it on the REAL address after the
Oct 22+ deploy (the new pages are not live before that), using a throw-away practice product. Tick each row, write the result, and
screenshot anything odd. Everything here uses the pages as they are in the code on branch `safe/checkpoint-autonomy-wave35-sales`.

**Who does what:** O = owner (you), C = the client, S = a shopper (use a private/incognito window and, for the phone checks, a real phone).

**Safety rules while testing:** use made-up customer details, never a real card, never paste a secret key or password anywhere, and
cancel every practice order afterwards so it stops holding stock.

## 0. Before you start

| # | Check | Expected |
|---|---|---|
| 0.1 | The site shows the new look on `/store/<slug>`: light, warm, not dark | Light cream page, brown buttons |
| 0.2 | `/client/commerce` shows the Commerce menu as ONE swipeable row on a phone | One row, current page scrolled into view |
| 0.3 | O has the temporary "Activate billing (no charge)" button on `/owner/billing` | Button visible (remove it before launch) |

## A. Onboarding a new Commerce client

| # | Who | Steps | Expected |
|---|---|---|---|
| A1 | C | Open `/portal/signup`, fill ONLY the required fields (business name, your name, services and service area, primary website goal, the three "business" questions, email, password of 10+ characters) and press Create account and continue | Redirects to the check-email page, no error |
| A2 | C | Open the email, click the confirmation link, log in at `/portal/login` | Lands on the dashboard |
| A3 | C | On the dashboard find the Website setup sheet | "Services/products" and "Business email" are already filled from signup; the six required fields say (required); the lead and assistant rules are collapsed under "optional" |
| A4 | C | Fill the required fields, tick the agreement, type a FULL name as signature, press Submit website setup | "Website setup submitted" |
| A5 | O | Owner portal, Client approvals, press Refresh | The client appears with APPROVE. Press APPROVE, then Refresh: it moves to Completed approvals (accepted) |
| A6 | O | `/owner/billing`, section "Temporary: activate a test client (no charge)", press Activate billing (no charge) for the client | Billing shows Active |
| A7 | C | `/client/settings`, "Plan & website upgrades": Product family NXQX-Commerce, a tier, a note, press Send plan change for review | "Awaiting owner review" |
| A8 | O | `/owner/plan-changes`, open the request, fee `0`, owner note, Approve plan change, OK on the confirm | Request shows COMPLETED |
| A9 | C | Refresh the dashboard | A "Commerce workspace" card leads with "Start the step-by-step guide"; no wording about a "storefront build" |

## B. Commerce setup form (client)

| # | Steps | Expected |
|---|---|---|
| B1 | `/client/commerce/setup` | A green "Quick start: you only need the Store name" note; only Store name (and the website choice, only for review) say required |
| B2 | Scroll down | "Storefront design and motion" and "Policies, content, and launch" are collapsed and labelled optional |
| B3 | Type a store name, press **Save draft** | "Commerce setup draft saved." Save draft is the big button; "Send to NXQX for review (optional)" is quiet |
| B4 | Reload the page | The store name is still there |
| B5 | Do NOT approve any "Commerce intake ready for review" item in the owner portal | (Approving can start the paused automated build jobs; the store does not need it) |

## C. Products and photos (client)

| # | Steps | Expected |
|---|---|---|
| C1 | `/client/commerce/products`: name, base price, description; under Variant 1 enter the SAME price and an On hand quantity; Save product draft | The product appears under Product drafts |
| C2 | Repeat C1 but leave Variant price and On hand at 0 | Saves, but see E5: it will show $0 or sold out (the guide warns about this) |
| C3 | `/client/commerce/images`: pick the product, Upload photos (1 to 8 JPG/PNG/WEBP/GIF) | Photos appear; the first is the main photo |
| C4 | Upload a file that is not an image (for example a .txt) | A clear refusal, nothing uploaded |
| C5 | Look at `/client/commerce/live` product rows | There is NO image box (it was removed); a line says photos are added on the Photos page |

## D. Live store (client)

| # | Steps | Expected |
|---|---|---|
| D1 | `/client/commerce/live`: type a Store name, press Save private draft with no payment link | "Saved. Your store stays private until you press Open storefront." |
| D2 | Press Open storefront with NO payment link | A clear message that a payment link is needed (the reason is shown, not a generic error) |
| D3 | Paste `http://example.com/x` into the PayPal box and press Save private draft | A message that the link must be https on the provider's own website; nothing saved |
| D4 | Put a correct Venmo (`https://venmo.com/u/NAME`) or PayPal (`https://paypal.me/NAME`) or Stripe Payment Link in ONE box, leave the others empty, Save private draft, Open storefront, OK | "Your store is open. Customers can now order from it." |
| D5 | Press Make visible on the product from C1 | Confirm box, then it says visible. For the product from C2 (price 0) a warning names the $0 price before it goes live |
| D6 | In "Your store address" press Copy store link, paste it somewhere | The full store URL |
| D7 | "About and contact (optional)": type an About line, a contact email, phone and an https social link, press Save About and contact | "Saved. It now shows at the bottom of your store." Needs migration 269 applied; if the section is missing, 269 is not applied yet |
| D8 | Try a bad email or a link starting `http://` | A plain message, nothing saved |

## E. The public store (shopper, desktop AND phone)

| # | Steps | Expected |
|---|---|---|
| E1 | Open the copied link in a private window | Store name big at the top; tab title is the store name (not "NXQX"); only the small "Website by NXQX-Web" line mentions NXQX |
| E2 | Before any product is visible | "Our shop is opening soon. New products are on the way. Please check back soon." |
| E3 | With products visible | Equal-sized cards in a grid (one column on a phone); a product without a photo shows a neutral placeholder; sold-out variants say Sold out |
| E4 | Press Add to cart on a phone | A sticky "View cart · 1 item · $X" bar appears at the bottom, and the cart count in the header is a link |
| E5 | Check each price and stock | The price matches what the client entered; nothing shows $0 unless the client left it at $0 |
| E6 | Fill the customer details (made-up) and press Place order and continue to payment | "Order <number> created", the total, three plain next steps, a Copy order number button, and a button for the payment provider the client chose |
| E7 | Press the payment button (do NOT pay) | The provider opens in a new tab. For PayPal.me the total is in the link; for Venmo the total and "Order <number>" note are added (UNVERIFIED that Venmo's site honours them: note what you see); for Stripe the order number is passed along |
| E8 | The About and contact block | Shows at the bottom, also after placing an order; email, phone and social links work; no raw web address shows |
| E9 | Keyboard only (Tab through the page) | A visible outline on every link, button and menu |
| E10 | Zoom the page to 200% and rotate the phone | Nothing runs off the screen sideways |

## F. Orders (client)

| # | Steps | Expected |
|---|---|---|
| F1 | `/client` or `/client/commerce` dashboard | An "Orders" card says "1 order is waiting for you to confirm payment." with an Open orders button |
| F2 | `/client/commerce/orders` | The order appears as New / Pending |
| F3 | Press Confirm payment received ONLY if the practice payment really arrived (it did not) | Leave it unconfirmed |
| F4 | Set the fulfillment status to Cancelled (use the order's fulfillment control) | The order is cancelled and the dashboard card goes back to "No orders are waiting for you right now." |
| F5 | Press Create practice order | "Practice order ... created. Nothing was charged and no customer was contacted." and it does NOT count in the dashboard card |

## G. Optional shopper accounts (keep OFF for a real store until a verified email domain exists)

| # | Steps | Expected |
|---|---|---|
| G1 | `/client/commerce/live`, Shopper accounts switch | Off by default; turning on asks for confirmation |
| G2 | With it on: `/store/<slug>/account` | Same light look; Sign in, Create account, "Forgot your password?" |
| G3 | Forgot password with a real inbox | The same message whether or not the email exists; the link returns to the account page and asks for a new password. NOTE: Supabase's built-in email is rate-limited until a verified domain exists |
| G4 | Turn accounts off again | "Shopper accounts are off." |

## H. Safety and isolation

| # | Steps | Expected |
|---|---|---|
| H1 | Logged out, open `/client/commerce` | Sent to the login page |
| H2 | Open another client's `/store/<their-slug>` | You see their public store only, never their dashboard or orders |
| H3 | A QA-only client in `/owner/billing` | Cannot be activated |
| H4 | Open a store that is not open yet | "This storefront is not open yet." |

## I. Clean up

1. Cancel every practice order (F4) so no stock stays reserved.
2. Hide or delete the practice products if this was a real client's account.
3. Turn shopper accounts back off if they were only for testing.
4. Write every surprise into `docs/NXQ_RUNTIME_HANDOFF.md` (friction list).

## Sign-off

| Area | Result | Date | Notes |
|---|---|---|---|
| A Onboarding | | | |
| B Setup form | | | |
| C Products and photos | | | |
| D Live store and About | | | |
| E Public store (desktop and phone) | | | |
| F Orders | | | |
| G Shopper accounts | | | |
| H Safety and isolation | | | |

**Known limits to remember:** email notifications (orders, confirmations) do not work until a verified email domain exists (needs a card);
Stripe Payment Links cannot carry an order amount; the Venmo amount and note parameters are unverified; the failing `NXQ Mega Extended
CI` check (Edge function type checks) is a separate, older issue.
