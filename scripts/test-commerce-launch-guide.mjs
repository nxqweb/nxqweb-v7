// Offline test: the Commerce launch guide follows the proven order, links only to real pages, warns about the traps found in the
// rehearsal, remembers progress safely, and the dashboard nudge stops when finished or switched off.
import fs from "node:fs";
import {
  guideProgress, launchGuideSteps, nextStepIndex, readAutoOff, readDoneSteps, shouldShowGuidePrompt, toggleStepDone, writeAutoOff, writeDoneSteps,
} from "../src/lib/commerceLaunchGuide.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; }, data };
}
const throwingStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };

const ids = launchGuideSteps.map((s) => s.id);
check("steps follow the proven order", ids.join(",") === "setup,product,live,open,test-order,orders", ids.join(","));
check("every step has instructions and a warning", launchGuideSteps.every((s) => s.doThis.length >= 2 && s.watchOut.length > 20 && s.summary.length > 10));

const app = fs.readFileSync("src/App.tsx", "utf8");
check("every step links to a real Commerce page", launchGuideSteps.every((s) => s.href.startsWith("/client/commerce") && (s.href === "/client/commerce" || app.includes(`path === "${s.href}"`))),
  launchGuideSteps.filter((s) => !app.includes(`path === "${s.href}"`)).map((s) => s.href).join(","));

const text = launchGuideSteps.map((s) => `${s.summary} ${s.doThis.join(" ")} ${s.watchOut}`).join("\n");
check("warns that variant price and on-hand start at 0", /Price and On hand/.test(text) && /\$0 or sold out/.test(text));
check("warns the product image box is not the payment link box", /Only the Stripe Payment Link box takes the payment link/.test(text) && /only accepts a photo you uploaded on the Photos page/.test(text) && /never a payment link or an outside web link/.test(text));
check("explains the live store name is separate from the setup name", /separate from the setup form name/.test(text));
check("tells clients to confirm payment only after seeing the money", /Never confirm a payment you have not seen arrive/.test(text));
check("never tells clients to paste secrets", /Never paste a secret key or password/.test(text));
check("notes a practice order holds stock", /holds one unit of stock/.test(text));
check("makes no unsupported promises", !/\b(guarantee|instant|automatic payout|best|fast(?:est)?)\b/i.test(text));

check("progress math is right", guideProgress([]).percent === 0 && guideProgress(["setup", "product", "live"]).percent === 50 && guideProgress(ids).complete === true);
check("unknown ids do not count toward progress", guideProgress(["setup", "bogus"]).count === 1);
check("toggle adds then removes a step", toggleStepDone([], "setup").join() === "setup" && toggleStepDone(["setup"], "setup").length === 0);
check("guide resumes at the first unfinished step", nextStepIndex([]) === 0 && nextStepIndex(["setup", "product"]) === 2 && nextStepIndex(ids) === 0);

const store = memoryStorage();
writeDoneSteps(["setup", "live"], store);
check("progress round-trips through storage", readDoneSteps(store).join() === "setup,live");
check("corrupt or foreign storage values are ignored", readDoneSteps(memoryStorage({ "nxq-commerce-launch-guide-done-v1": "{nope" })).length === 0
  && readDoneSteps(memoryStorage({ "nxq-commerce-launch-guide-done-v1": '["setup","x",5]' })).join() === "setup");
check("blocked storage never throws and reads as empty", readDoneSteps(throwingStorage).length === 0 && readAutoOff(throwingStorage) === false
  && (() => { try { writeDoneSteps(["setup"], throwingStorage); writeAutoOff(true, throwingStorage); return true; } catch { return false; } })());

check("auto-off switch round-trips", (() => { const s = memoryStorage(); writeAutoOff(true, s); const on = readAutoOff(s); writeAutoOff(false, s); return on === true && readAutoOff(s) === false; })());
check("dashboard nudge shows until finished or switched off", shouldShowGuidePrompt([], false) === true && shouldShowGuidePrompt([], true) === false && shouldShowGuidePrompt(ids, false) === false);

const page = fs.readFileSync("src/pages/ClientCommerceTutorial.tsx", "utf8");
check("tutorial page offers replay and the auto-remind switch", page.includes("Start over from step 1") && page.includes("Remind me about this guide"));
check("tutorial page says it never changes the store", page.includes("The guide never changes your store."));
check("tutorial page does not write to the database", !/\.rpc\(|\.from\(/.test(page));
const dash = fs.readFileSync("src/pages/ClientCommerceDashboard.tsx", "utf8");
check("dashboard shows the nudge with a dismiss button", dash.includes("shouldShowGuidePrompt(") && dash.includes("Don't remind me again") && dash.includes('href="/client/commerce/tutorial"'));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll commerce-launch-guide checks passed (offline).");
process.exit(failures ? 1 : 0);
