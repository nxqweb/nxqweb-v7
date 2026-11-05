// Offline test: the client Rewards page speaks plain words. No fraud or risk details, no raw database errors, every status is a sentence, copy and share
// give feedback, and the three database calls keep their real names and argument names.
import fs from "node:fs";
import { creditEntryLabel, friendlyRewardsError, genericRewardsError, grantStatusSentence, money, referralStatusSentence, shareText, wholeDollars } from "../src/lib/rewardsCopy.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const page = read("src/pages/ClientRewards.tsx");
const sql = read("supabase/migrations/229_referrals_grants_and_cost_guards.sql");

// ---- sentences
const statuses = ["pending_payment", "holding", "qualified", "blocked", "reversed"];
check("every real referral status has its own plain sentence, none is the raw word", statuses.every((s) => { const t = referralStatusSentence(s); return t.length > 15 && !t.includes("_") && t !== s && t !== referralStatusSentence("zzz"); }));
check("the statuses in the sentence list match the database's allowed statuses", statuses.every((s) => sql.includes(`'${s}'`)), statuses.filter((s) => !sql.includes(`'${s}'`)).join(","));
check("a holding referral names the date when it has one, and still reads well without", /ready after /.test(referralStatusSentence("holding", "2026-11-05T12:00:00Z")) && referralStatusSentence("holding", "nonsense") === "Paid. Your reward is on a short review." && referralStatusSentence("holding", null) === "Paid. Your reward is on a short review.");
check("blocked never explains why (no fraud rule is revealed)", !/risk|fraud|suspic|score|same payment|owner/i.test(referralStatusSentence("blocked")) && !/risk|fraud|score/i.test(referralStatusSentence("reversed").replace("refunded or disputed", "")));
check("grant status reads naturally, with the group position when known", grantStatusSentence("submitted") === "Submitted. We will review it." && grantStatusSentence("eligible", 12) === "Eligible. Waiting for the owner's decision. You are number 12 in the group." && grantStatusSentence("weird") === "In progress.");
const grantStatuses = ["draft", "submitted", "eligible", "selected", "not_selected", "revoked"];
check("every real grant status is handled", grantStatuses.every((s) => grantStatusSentence(s) !== "In progress.") && grantStatuses.every((s) => sql.includes(`'${s}'`)));
check("money and whole-dollar helpers never show NaN or negative zero surprises", money(undefined) === "$0.00" && money("12.5") === "$12.50" && money(null) === "$0.00" && money("abc") === "$0.00" && wholeDollars(undefined, 10) === "$10" && wholeDollars(5, 10) === "$5" && wholeDollars(0, 10) === "$10");
check("a reversed credit entry says so", creditEntryLabel("Qualified referral reward", "reversed") === "Qualified referral reward (reversed)" && creditEntryLabel("x", "available") === "x");
check("the share text carries the link and reads like a person wrote it", shareText("https://x.test/portal/signup?ref=NXQ1A2B3C4D5").includes("https://x.test/portal/signup?ref=NXQ1A2B3C4D5") && /discount on your first invoice/.test(shareText("l")));

// ---- errors
const raised = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]);
const known = ["The referral program is not open yet.", "Referral code not found.", "Self-referrals are not allowed.", "This client already has a referral attribution.", "Referral attribution must be completed before the first verified payment.", "QA-only clients cannot participate in referrals.", "Founding Grant applications are not open yet.", "This account is outside the founding cohort.", "Please provide at least 30 characters."];
check("every message that gets its own kind sentence is really raised by the database", known.every((m) => raised.includes(m)), known.filter((m) => !raised.includes(m)).join(" | "));
check("known messages become kind sentences, everything else becomes one calm line", known.every((m) => friendlyRewardsError(m) !== genericRewardsError && friendlyRewardsError(m) !== m || m === "Founding Grant applications are not open yet.") && ['duplicate key value violates unique constraint "x"', "permission denied for table nxq_referral_attributions", "Failed to fetch", "", null, undefined].every((m) => friendlyRewardsError(m) === genericRewardsError));

// ---- the page
check("the page never prints a raw error message or any risk score", !/setError\(result\.error\.message\)/.test(page) && !/error\.message\)/.test(page.replace(/friendlyRewardsError\(result\.error\.message\)/g, "")) && !/risk/i.test(page));
check("copy has feedback and a failure message, share falls back to copy, and the closed share sheet is not an error", /copied \? "Link copied" : "Copy link"/.test(page) && /Could not copy automatically/.test(page) && /typeof navigator\.share === "function"/.test(page) && /else await copyLink\(\)/.test(page) && /person closed the share sheet/.test(page));
check("the page uses the three real database functions with their real argument names", /rpc\("nxq_referral_dashboard"\)/.test(page) && /call\("nxq_claim_referral", \{ target_referral_code: code \}/.test(page) && /call\("nxq_submit_founding_grant_application", \{ target_statement: statement \}/.test(page) && /function public\.nxq_claim_referral\(target_referral_code text\)/.test(sql) && /function public\.nxq_submit_founding_grant_application\(target_statement text\)/.test(sql));
check("the invite link is the same ?ref= link the signup page reads", /\/portal\/signup\?ref=\$\{data\.profile\.referral_code\}/.test(page));
check("the three steps use the program's real numbers, not fixed ones", /friendDiscount = wholeDollars\(program\.first_month_discount, 10\)/.test(page) && /reward = wholeDollars\(program\.reward, 10\)/.test(page) && /holdDays/.test(page) && /\{friendDiscount\} off/.test(page) && /\{reward\} off/.test(page));
check("a closed program says so kindly and the code box is disabled", /Referrals are not open yet\. Your link is saved/.test(page) && /!program\.enabled/.test(page) && /Codes can be added once referrals open/.test(page));
check("form boxes have real labels (link, code, grant statement) and messages are announced", /htmlFor="rewards-link"/.test(page) && /aria-label="Referral code"/.test(page) && /htmlFor="grant-statement"/.test(page) && /role="alert"/.test(page) && /role="status"/.test(page));
check("the rarely needed parts are tucked away (code entry, grant, history)", (page.match(/<OptionalSection/g) || []).length === 3);
check("jargon from the old page is gone from everything a person can read", ![...page.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).concat([...page.matchAll(/(?:title|hint|placeholder|aria-label)="([^"]+)"/g)].map((m) => m[1])).some((text) => /attribut|ledger|non-transferable|bounded|cohort|verified payment clears/i.test(text)));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll rewards-page checks passed (offline).");
process.exit(failures ? 1 : 0);
