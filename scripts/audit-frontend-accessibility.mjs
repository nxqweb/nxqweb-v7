import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const walk = (directory) => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(relative) : [relative];
});
const pageFiles = walk("src/pages").filter((file) => file.endsWith(".tsx"));
const componentFiles = walk("src/components").filter((file) => file.endsWith(".tsx"));
const jsxFiles = [...pageFiles, ...componentFiles];
const jsx = jsxFiles.map((file) => `\n/* ${file} */\n${read(file)}`).join("\n");
const html = read("index.html");
const app = read("src/App.tsx");
const css = read("src/styles/nxq.css");
const tutorial = read("src/components/ClientPortalTutorialOverlay.tsx");
const commercePreview = read("src/pages/ClientCommercePreview.tsx");
const ownerCommandCenter = read("src/components/OwnerCommandCenter.tsx");
const portalLogin = read("src/pages/PortalLogin.tsx");
const portalSignup = read("src/pages/PortalSignup.tsx");
const forgotPassword = read("src/pages/ForgotPassword.tsx");
const resetPassword = read("src/pages/ResetPassword.tsx");

const checks = [
  ["Document language is declared", /<html\s+lang="en"/.test(html)],
  ["Viewport title and description are present", html.includes('name="viewport"') && html.includes("<title>") && html.includes('name="description"')],
  ["Skip link targets a focusable application landmark", html.includes('class="nxq-skip-link" href="#main-content"') && app.includes('id="main-content" tabIndex={-1}')],
  ["Every route page provides semantic main content", pageFiles.every((file) => read(file).includes("<main"))],
  ["Loading fallback announces its status", app.includes('role="status">Loading NXQ')],
  ["Global keyboard focus is highly visible", css.includes(":where(a, button, input, select, textarea, [tabindex]):focus-visible") && css.includes("outline: 3px solid")],
  ["Reduced-motion mode suppresses animation and transitions", css.includes("@media (prefers-reduced-motion: reduce)") && css.includes("transition-duration: 0.01ms") && css.includes("animation-duration: 0.01ms")],
  ["Tutorial dialog is labelled and described", tutorial.includes('aria-labelledby="nxq-client-tutorial-title"') && tutorial.includes('aria-describedby="nxq-client-tutorial-description"')],
  ["Tutorial dialog traps focus and supports Escape", tutorial.includes('event.key !== "Tab"') && tutorial.includes('event.key === "Escape"') && tutorial.includes("document.body.style.overflow = \"hidden\"")],
  ["Commerce product dialog has an accessible name", commercePreview.includes('aria-labelledby="commerce-product-preview-title"') && commercePreview.includes('id="commerce-product-preview-title"')],
  ["Owner command-center status changes are announced", ownerCommandCenter.includes('aria-live="polite"') && ownerCommandCenter.includes('role="alert"')],
  ["Portal login exposes accessible status and error messages", portalLogin.includes('role="alert"') && portalLogin.includes('role="status"')],
  ["Signup tier choices expose pressed state", portalSignup.includes("aria-pressed={isSelected}")],
  ["Signup uses browser credential autocomplete hints", portalSignup.includes('autoComplete="email"') && portalSignup.includes('autoComplete="new-password"')],
  ["Login uses browser credential autocomplete hints", portalLogin.includes('autoComplete="email"') && portalLogin.includes('autoComplete="current-password"')],
  ["Password recovery forms expose accessible result states", forgotPassword.includes('role="alert"') && forgotPassword.includes('role="status"') && resetPassword.includes('role="alert"') && resetPassword.includes('role="status"')],
  ["Clickable non-controls are not used in place of buttons", !/<(?:div|span|article|section)\b[^>]*\bonClick=/.test(jsx)],
];

const imageTags = [...jsx.matchAll(/<img\b[\s\S]*?\/>/g)].map((match) => match[0]);
checks.push(["Every JSX image has alternative text", imageTags.every((tag) => /\balt=/.test(tag))]);

const buttonTags = [...jsx.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)];
const inaccessibleButtons = buttonTags.filter((match) => {
  const attributes = match[1];
  const body = match[2];
  if (/aria-label=|aria-labelledby=/.test(attributes)) return false;
  const withoutTags = body.replace(/<[^>]+>/g, " ").replace(/[{}()?:.`$=>]/g, " ").replace(/\b(?:size|className|disabled|current|true|false)\b/g, " ");
  return !/[A-Za-z0-9]{2,}/.test(withoutTags);
});
checks.push(["Every button has visible text or an accessible label", inaccessibleButtons.length === 0]);

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) { console.log(`PASS  ${label}`); passed += 1; }
  else console.error(`FAIL  ${label}`);
}
console.log(`\n${passed}/${checks.length} frontend accessibility checks passed.`);
if (passed !== checks.length) process.exit(1);
