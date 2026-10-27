# Your store: what to send us (candle shop)

Plain words, nothing technical. Send what you can by text or email, in any order. Photos are the only thing you do yourself in your portal.

## 1. Your shop
- **Shop name** (the name customers see)
- **A short web name** for your link, like `glow-candle-co` (letters, numbers and dashes only). Your link will look like `.../store/glow-candle-co`
- **Contact email** customers can reach you at
- **Colors or a vibe** you like (for example "warm cream and gold"), if you have them

## 2. How people pay you
Pick ONE:
- **A payment link** from Stripe, Venmo or PayPal. Send us the link. NEVER send a password or a secret key.
- **By email:** customers fill a cart and press "Email my order"; you reply with how to pay.

Also: how long until orders ship, and your return rule, in one or two sentences.

## 3. Your products (one block per product)
- Name (for example "Lavender Calm Candle")
- A one-line summary and a longer description
- Price
- Sizes or scents, and how many you have of each (an estimate is fine)
- Photos: add these yourself in your portal under **Commerce, then Photos** (clear, bright pictures sell the most)

Not sure yet? Start with 3 products. You can add more any time yourself.

## 4. What happens next
1. We put your shop name, payment choice and products in. Nothing is public until you say go.
2. You look at it, fix anything, and add photos.
3. You press **Make visible** on the products you want, and copy your store link.
4. When an order comes in, it shows under **Orders**. Nothing in the app can charge a customer or move your money.

## 5. Custom candles (customers ask for something made just for them)
Customers can send you a request from your store page ("Request a custom order"). They describe what they want, can paste a link to a photo (Instagram, Pinterest, Google Photos) and can upload a picture. You see every request in your portal under **Commerce, then Customer requests**.
- Set it up once: switch on **Enable customer requests**, tick **Custom product** and **Personalized product**, keep **Allow reference images** on, and fill in the instructions ("Tell us the scent, color and jar size, and add a photo of what you want") and your reply time ("I reply within 2 days").
- For each request pick a status: **Accepted**, **Declined** ("I'm sorry, I can't make that one"), **Need more information** or **Quoted**, add a short note, and press **Save request update**.
- Press **Email** on the request: your email app opens with a friendly reply already written. Read it, change anything, and send. Nothing is sent for you.
- Pictures customers upload are held for a security check first, so you may not be able to open them yet (the request says "restricted pending security approval"). The photo **link** works right away. Once the check is switched on, a **View picture** button appears.
- A request is not an order and nothing is charged. When you accept a custom job, tell the customer the price and send your Venmo or payment link yourself.

---

## For the owner (not for her)
1. She signs up at `/portal/signup` with her real email and verifies it (if the email never arrives, tell Claude: it is one SQL statement to confirm it).
2. You approve her, run the "no charge" billing step (`docs/OWNER_COMPLIMENTARY_BILLING_ACTIVATION.md`) and approve her plan change to NXQX-Commerce.
3. Put what she sent into a copy of `docs/CANDLE_STORE_SAMPLE.json` (or send it to Claude to do) and run `node scripts/make-commerce-seed.mjs her-info.json > her-store.sql`. Paste the output into the STAGING project's SQL editor and Run. It creates her store as a DRAFT with `"make_live": false`, so nothing is public yet. It is safe to run again: a product with the same name is updated, not duplicated. It stops with a plain message if she is not approved, her billing is not active, or the web name is taken.
4. Her photos go in through her portal (the script only accepts photos she already uploaded).
5. She (or you) presses **Make visible** per product and the store goes live from **Live store**.
- Her data lives in the STAGING database: treat orders as showcase-grade until production exists.
- Order numbers say `NXQ-` until migration 281 is applied; after that they use her shop's initials.
- Proven: the script's behavior on a real Postgres (`scripts/sql/local-full-schema/regression/commerce_seed.test.sql`). Not yet run on staging for her.
