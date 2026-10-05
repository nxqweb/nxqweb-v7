// Regression test for the front-end access guards. Static checks only (no browser login):
// it fails if an owner page loses its OwnerProtectedRoute wrapper, if the owner check changes
// shape, or if a client page loses its sign-in redirect. This protects against accidental lockouts
// AND accidental exposure during refactors. It does not replace an authenticated browser test.
import fs from "node:fs";
import path from "node:path";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const read = (file) => fs.readFileSync(file, "utf8");

// ---- 1. Owner routes in App.tsx ----
const app = read("src/App.tsx");
const lines = app.split("\n");
const ownerRouteLines = lines.filter((l) => /path === "\/owner/.test(l));
const unguarded = ownerRouteLines.filter((l) => !l.includes("OwnerProtectedRoute") && !/window\.location\.replace\("\/portal\/login"\)/.test(l));
check(`all ${ownerRouteLines.length} owner route lines are guarded or redirect to sign-in`, ownerRouteLines.length >= 20 && unguarded.length === 0, unguarded.join(" | "));
const ownerElements = lines.filter((l) => /<Owner[A-Za-z]+\s*\/>/.test(l));
const exposed = ownerElements.filter((l) => !l.includes("<OwnerProtectedRoute>"));
check(`all ${ownerElements.length} <Owner... /> elements render inside <OwnerProtectedRoute>`, ownerElements.length >= 19 && exposed.length === 0, exposed.join(" | "));
check("unknown /owner/* paths redirect to the guarded /owner page", /path\.startsWith\("\/owner\/"\)\) \{ window\.location\.replace\("\/owner"\)/.test(app));
check("/owner/login redirects to the shared sign-in", /path === "\/owner\/login"\) \{ window\.location\.replace\("\/portal\/login"\)/.test(app));

// ---- 2. The owner check itself ----
const guard = read("src/components/OwnerProtectedRoute.tsx");
check("no session -> redirect to /portal/login", /if \(!session\) \{\s*window\.location\.replace\("\/portal\/login"\);\s*return;/.test(guard));
check("owner access is decided by an owner_users row for the signed-in user", guard.includes('.from("owner_users")') && guard.includes('.eq("auth_user_id", session.user.id)'));
check("a query error or a missing owner row denies access", guard.includes("setIsOwner(false)") && guard.includes("not approved as an NXQ owner"));
check("access is granted only after an owner row is found", /if \(!ownerResult\.data\) \{[\s\S]*?return;\s*\}\s*setIsOwner\(true\)/.test(guard));
check("the owner guard does not read billing, plan or payment state (billing cannot lock the owner out)", !/billing|subscription|payment|plan_/i.test(guard));

// ---- 2b. Owner portal log out ----
const ownerPortal = read("src/pages/OwnerPortal.tsx");
check("owner portal has a log out button that signs out and returns to the shared sign-in", ownerPortal.includes("handleOwnerLogout") && ownerPortal.includes("supabase.auth.signOut()") && ownerPortal.includes('window.location.replace("/portal/login")') && ownerPortal.includes("<LogOut size={16} /> Log out"));

// ---- 3. Client pages ----
const clientPages = fs.readdirSync("src/pages").filter((n) => /^Client.*\.tsx$/.test(n));
// Pages that rely on server-enforced RPCs (current_client_*, which reject unauthenticated callers)
// instead of a client-side redirect. Each entry needs a reason.
const serverEnforced = new Map([["ClientBusinessDashboard.tsx", "reads only current_client_* RPCs, which the database refuses without a session"]]);
const missing = clientPages.filter((n) => !read(path.join("src/pages", n)).includes("/portal/login") && !serverEnforced.has(n));
check(`${clientPages.length} client pages redirect to sign-in (or are listed as server-enforced)`, missing.length === 0, missing.join(", "));
for (const [name] of serverEnforced) {
  const src = read(path.join("src/pages", name));
  check(`${name} (server-enforced) only uses current_client_* RPCs and no direct table reads`, /rpc\("current_client_/.test(src) && !/\.from\(/.test(src));
}

// ---- 4. Secrets and keys in the browser bundle sources ----
const srcFiles = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(e.name)) srcFiles.push(p); } })("src");
const leaks = srcFiles.filter((f) => /service_role|SERVICE_ROLE|SUPABASE_SERVICE/.test(read(f)));
check("no front-end source references the service-role key", leaks.length === 0, leaks.join(", "));
const client = read("src/lib/supabaseClient.ts");
check("the browser client uses only the public anon key from the environment", client.includes("VITE_SUPABASE_ANON_KEY") && !/eyJ[A-Za-z0-9_-]{20,}/.test(client));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll access-guard checks passed (static; no authenticated browser session was used).");
process.exit(failures ? 1 : 0);
