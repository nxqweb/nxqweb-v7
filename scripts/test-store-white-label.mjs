// Offline test: a client's public store never names NXQX except one small credit line at the very bottom (owner decision 2026-10-15).
import fs from "node:fs";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

const pages = {
  storefront: "src/pages/PublicCommerceStorefront.tsx",
  checkout: "src/pages/PublicCommerceCheckout.tsx",
  request: "src/pages/PublicCommerceRequest.tsx",
};
const source = Object.fromEntries(Object.entries(pages).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
const credit = fs.readFileSync("src/components/StoreCredit.tsx", "utf8");

for (const [key, text] of Object.entries(source)) {
  const withoutImports = text.split("\n").filter((line) => !line.startsWith("import ")).join("\n").replace(/\bnxq-[a-z-]+/g, "");
  check(`${key} page does not name NXQ anywhere`, !/nxq/i.test(withoutImports), (withoutImports.match(/.{0,30}nxq.{0,30}/i) || [""])[0]);
}
check("credit line reads 'Website by NXQX-Web'", credit.includes("Website by NXQX-Web"));
check("credit line is small and centred, not a banner", /fontSize: "0\.8rem"/.test(credit) && /textAlign: "center"/.test(credit));
check("storefront page shows the credit last, inside the page", /<StoreCredit \/>\s*<\/section><\/main>/.test(source.storefront));
check("checkout page shows the credit last, inside the page", /<StoreCredit \/>\s*<\/main>/.test(source.checkout));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store white-label checks passed (offline).");
process.exit(failures ? 1 : 0);
