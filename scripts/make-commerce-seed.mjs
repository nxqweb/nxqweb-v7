// Prints the owner-run store-fill script (scripts/sql/commerce-seed.sql) with ONE client's details filled in, ready to paste into the Supabase SQL editor of the STAGING project.
// Usage: node scripts/make-commerce-seed.mjs her-info.json > her-store.sql      (the JSON shape is documented at the top of commerce-seed.sql; docs/CANDLE_STORE_SAMPLE.json is an example)
// It only reads the JSON file and prints text: it never contacts anything. It refuses input the SQL would refuse anyway, so mistakes show up here first.
import fs from "node:fs";

const MAX_PRODUCTS = 50;
export function buildSeed(jsonText, sqlText) {
  let seed;
  try { seed = JSON.parse(jsonText.replace(/^﻿/, "")); } catch { throw new Error("The file is not valid JSON (check commas and quotes)."); }
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) throw new Error("The JSON must be one object { ... }.");
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(seed.client_email))) throw new Error("client_email must be her contact email address.");
  if (!text(seed.store_name)) throw new Error("store_name is required.");
  if (text(seed.store_slug) && !/^[a-z0-9][a-z0-9-]{2,60}$/.test(text(seed.store_slug))) throw new Error("store_slug must be 3-61 lowercase letters, numbers or dashes, like glow-candle-co.");
  if (text(seed.stripe_payment_link) && !/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+/i.test(text(seed.stripe_payment_link))) throw new Error("stripe_payment_link must start with https://buy.stripe.com/ .");
  if (text(seed.paypal_url) && !/^https:\/\/(www\.)?(paypal\.me|paypal\.com)\//i.test(text(seed.paypal_url))) throw new Error("paypal_url must be a PayPal link.");
  if (text(seed.venmo_url) && !/^https:\/\/(www\.)?venmo\.com\//i.test(text(seed.venmo_url))) throw new Error("venmo_url must be a Venmo link.");
  if (seed.make_live === true && !text(seed.stripe_payment_link) && !text(seed.paypal_url) && !text(seed.venmo_url)) throw new Error("make_live needs at least one payment link.");
  const products = seed.products === undefined ? [] : seed.products;
  if (!Array.isArray(products)) throw new Error("products must be a list [ ... ].");
  if (products.length > MAX_PRODUCTS) throw new Error(`At most ${MAX_PRODUCTS} products per run.`);
  const seen = new Set();
  products.forEach((p, i) => {
    if (!p || typeof p !== "object" || !text(p.name)) throw new Error(`Product ${i + 1} needs a name.`);
    const key = text(p.name).toLowerCase();
    if (seen.has(key)) throw new Error(`Two products are named "${text(p.name)}": names must be different.`);
    seen.add(key);
    if (!(Number(p.base_price) >= 0)) throw new Error(`Product "${text(p.name)}" needs a price (a number, 0 or more).`);
    for (const v of Array.isArray(p.variants) ? p.variants : []) if (!(Number(v.price) >= 0)) throw new Error(`A size/variant of "${text(p.name)}" needs a price.`);
  });
  const json = JSON.stringify(seed);
  if (json.includes("$nxq$")) throw new Error("The text cannot contain $nxq$.");
  const block = sqlText.slice(sqlText.indexOf("do $$"));
  if (!block.startsWith("do $$") || !block.includes("end $$;")) throw new Error("commerce-seed.sql changed shape: cannot find its DO block.");
  return `-- Generated from your JSON by scripts/make-commerce-seed.mjs. Paste ALL of this into the Supabase SQL editor of the STAGING project and press Run.\n-- Needs: her account exists, you approved her, and the complimentary billing step made her billing active (the script stops with a plain message if not).\nselect set_config('nxq.commerce_seed', $nxq$${json}$nxq$, false);\n\n${block.trimEnd()}\n`;
}

if (process.argv[1] && process.argv[1].endsWith("make-commerce-seed.mjs")) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node scripts/make-commerce-seed.mjs her-info.json > her-store.sql"); process.exit(2); }
  try { process.stdout.write(buildSeed(fs.readFileSync(file, "utf8"), fs.readFileSync(new URL("./sql/commerce-seed.sql", import.meta.url), "utf8"))); }
  catch (error) { console.error(`Cannot build the script: ${error.message}`); process.exit(1); }
}
