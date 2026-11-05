// Offline test: referral links. The shared link (/portal/signup?ref=CODE) must actually be read at signup, stored with the new account, and applied
// once after sign-in; bad codes are ignored, and the retry/finished decision matches the database's real messages.
import fs from "node:fs";
import { claimOutcome, claimedReferralKey, isFreshStamp, isNewAccount, newAccountMaxAgeMs, normalizeReferralCode, pendingReferralAtKey, pendingReferralKey, pendingReferralMaxAgeMs, referralCodeFromSearch, referralCodeFromUser } from "../src/lib/referralCode.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");

// ---- reading the code
check("a real code is read from the link and tidied", referralCodeFromSearch("?ref=nxq1a2b3c4d5") === "NXQ1A2B3C4D5" && referralCodeFromSearch("?x=1&ref=NXQ1A2B3C4D5&y=2") === "NXQ1A2B3C4D5" && referralCodeFromSearch("?ref=%20NXQ1A2B3C4D5%20") === "NXQ1A2B3C4D5");
check("bad codes are ignored (too short, too long, symbols, markup, empty)", ["?ref=", "?ref=abc", "?ref=NXQ1A2B3C4D5NXQ1A2B3C4D5X", "?ref=NXQ-1A2B3C4D5", "?ref=<script>alert(1)</script>", "?ref=NXQ1A2B3C4D5'--", "?other=NXQ1A2B3C4D5", ""].every((s) => referralCodeFromSearch(s) === ""));
check("the code a new account carries is read from its saved data, and only if valid", referralCodeFromUser({ user_metadata: { referral_code: "nxq1a2b3c4d5" } }) === "NXQ1A2B3C4D5" && referralCodeFromUser({ user_metadata: { referral_code: "bad code" } }) === "" && referralCodeFromUser({ user_metadata: {} }) === "" && referralCodeFromUser(null) === "" && normalizeReferralCode(42) === "");
check("codes made by the database (NXQ plus 9 letters or digits) are accepted", normalizeReferralCode("NXQ9F8E7D6C5") === "NXQ9F8E7D6C5");

// ---- what a failure means
const sql = read("supabase/migrations/229_referrals_grants_and_cost_guards.sql");
const raised = [...sql.slice(sql.indexOf("function public.nxq_claim_referral"), sql.indexOf("function public.nxq_record_referral_first_payment")).matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]);
const finalOnes = ["Referral code not found.", "Self-referrals are not allowed.", "QA-only clients cannot participate in referrals.", "This client already has a referral attribution.", "Referral attribution must be completed before the first verified payment."];
check("every 'finished for good' message really is raised by the database claim function", finalOnes.every((m) => raised.includes(m)), finalOnes.filter((m) => !raised.includes(m)).join(" | "));
check("those messages are finished for good", finalOnes.every((m) => claimOutcome(m) === "done"));
check("program-not-open, workspace missing, network and unknown errors are retried later", ["The referral program is not open yet.", "Client workspace not found.", "Failed to fetch", "", null, undefined, "something odd"].every((m) => claimOutcome(m) === "retry"));
check("the program-not-open and workspace messages exist in the database function", raised.includes("The referral program is not open yet.") && raised.includes("Client workspace not found."));

// ---- wiring
const signup = read("src/pages/PortalSignup.tsx");
const claimer = read("src/components/ReferralClaimer.tsx");
const app = read("src/App.tsx");
const rewards = read("src/pages/ClientRewards.tsx");
check("the signup page reads ?ref, remembers it, tells the visitor, and saves it with the new account", /referralCodeFromSearch\(window\.location\.search\)/.test(signup) && /savePendingReferral\(referralCode\)/.test(signup) && /\.\.\.\(referralCode \? \{ referral_code: referralCode \} : \{\}\)/.test(signup) && /data-testid="referral-note"/.test(signup));
check("the share link the rewards page hands out uses the same ?ref= name the signup reads", /\/portal\/signup\?ref=\$\{data\.profile\.referral_code\}/.test(rewards));
check("the claimer runs on client pages only and shows nothing", /startsWith\("\/client"\) \? <><ReportProblem \/><ReferralClaimer \/><\/>/.test(app) && /return null;/.test(claimer));
check("the claimer calls the existing database function with its real argument name", /rpc\("nxq_claim_referral", \{ target_referral_code: code \}\)/.test(claimer));
check("a code is applied once per person: a done flag is checked first and set after success or a final answer", /claimedReferralKey\(user\.id\)\)\) return/.test(claimer) && /!result\.error \|\| claimOutcome\(result\.error\.message\) === "done"/.test(claimer) && claimedReferralKey("u1") === "nxq-referral-done-v1-u1" && pendingReferralKey === "nxq-pending-referral-v1");
check("two overlapping runs cannot both claim (guard flag, released at the end)", /let attempting = false;/.test(claimer) && /if \(attempting \|\| /.test(claimer) && /finally \{ attempting = false; \}/.test(claimer));
check("failures stay silent and never block the page", /catch \{ \/\* try again on a later visit \*\/ \}/.test(claimer));

// ---- a remembered code cannot leak to a different person on a shared computer
const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 20);
const lib = read("src/lib/referralCode.ts");
const portal = read("src/pages/ClientPortal.tsx");
check("a browser-remembered code expires (fresh stamp ok, old, missing, junk and future stamps are refused)", isFreshStamp(now - day, now) && !isFreshStamp(now - pendingReferralMaxAgeMs - 1, now) && !isFreshStamp(null, now) && !isFreshStamp("abc", now) && !isFreshStamp(now + 10 * day, now) && !isFreshStamp(0, now));
check("the browser-remembered code only counts for a brand-new account", isNewAccount(new Date(now - day).toISOString(), now) && !isNewAccount(new Date(now - newAccountMaxAgeMs - day).toISOString(), now) && !isNewAccount(undefined, now) && !isNewAccount("not a date", now));
check("reading the remembered code requires the fresh stamp, and clearing removes both keys", /isFreshStamp\(window\.localStorage\.getItem\(pendingReferralAtKey\), nowMs\)/.test(lib) && /removeItem\(pendingReferralKey\); window\.localStorage\.removeItem\(pendingReferralAtKey\)/.test(lib) && pendingReferralAtKey === "nxq-pending-referral-at-v1");
check("the claimer only uses the browser's code for a new account, and the account's own code always counts", /referralCodeFromUser\(user\) \|\| \(isNewAccount\(user\.created_at, Date\.now\(\)\) \? readPendingReferral\(\) : ""\)/.test(claimer));
check("logging out forgets any remembered code", /async function handleLogout\(\) \{[\s\S]{0,160}clearPendingReferral\(\);/.test(portal) && /import \{ clearPendingReferral \} from "\.\.\/lib\/referralCode"/.test(portal));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll referral-link checks passed (offline).");
process.exit(failures ? 1 : 0);
