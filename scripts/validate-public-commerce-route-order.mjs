import fs from "node:fs";

const app = fs.readFileSync("src/App.tsx", "utf8");

const checkoutRoute = 'if (path === "/store/checkout")';
const requestRoute = 'if (path === "/store/request")';
const storefrontMatcher = 'if (/^\\/store\\/[^/]+\\/?$/.test(path))';

const checkoutIndex = app.indexOf(checkoutRoute);
const requestIndex = app.indexOf(requestRoute);
const storefrontIndex = app.indexOf(storefrontMatcher);

const missing = [
  ["checkout", checkoutIndex],
  ["request", requestIndex],
  ["generic storefront", storefrontIndex],
].filter(([, index]) => Number(index) < 0);

if (missing.length > 0) {
  throw new Error(`Missing public Commerce route contract: ${missing.map(([name]) => name).join(", ")}.`);
}

if (!(checkoutIndex < storefrontIndex && requestIndex < storefrontIndex)) {
  throw new Error(
    "Reserved /store/checkout and /store/request routes must be declared before the generic /store/:slug matcher."
  );
}

console.log("PASS  reserved Commerce routes are protected from the generic storefront matcher.");
