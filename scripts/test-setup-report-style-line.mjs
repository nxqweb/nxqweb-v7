// Offline test for the "desired_style keeps being asked for" bug found in the 2026-10-25 live tier test (Growth and Intelligence test clients both completed Request your website and
// were still told "Complete the missing onboarding information: desired_style"). Cause: the form wrote "Style direction:" and the text on the NEXT line, but the database copies the
// report into the intake record with a single-line reader (extract_setup_report_value, migration 103), so it found no style. The phone was written inline and was never missing.
// The SQL cannot run here, so this test (1) reads the reader's rule out of the migration so a change to it is noticed, (2) applies that rule in JavaScript to the old and new formats.
import fs from "node:fs";
import { inlineReportLines } from "../src/lib/setupReportLines.ts";

let failures = 0;
function check(name, ok) { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}`); } }
const read = (p) => fs.readFileSync(p, "utf8");
const sql = read("supabase/migrations/103_fix_onboarding_automation_and_setup_sync.sql");
const portal = read("src/pages/ClientPortal.tsx");

const fnStart = sql.indexOf("create or replace function public.extract_setup_report_value(");
const fn = sql.slice(fnStart, sql.indexOf("$$;", fnStart));
check("the database reader still matches 'Label:' at the start of ONE line and takes the rest of that line", /left\(line, length\(label\) \+ 1\) = label \|\| ':'/.test(fn) && /substr\(line, length\(label\) \+ 2\)/.test(fn) && /nullif\(btrim\(/.test(fn) && /limit 1/.test(fn));
check("the intake sync reads the style with that single-line reader", /style_value := public\.extract_setup_report_value\(report, 'Style direction'\)/.test(sql));
check("the intake sync reads the phone with it too, and turns 'Not provided' into missing for the phone only", /phone_value := public\.extract_setup_report_value\(report, 'Business phone'\)/.test(sql) && /in \('not provided', 'none', 'n\/a'\)/.test(sql) && !/style_value[^;]*not provided/i.test(sql));

// The same rule as the SQL function, in JavaScript.
function dbSingleLineRead(report, label) {
  for (const line of report.replace(/\r\n/g, "\n").split("\n")) {
    if (line.slice(0, label.length + 1) === `${label}:`) { const v = line.slice(label.length + 1).trim(); return v === "" ? null : v; }
  }
  return null;
}
const report = (styleLines) => ["NXQ WEB WEBSITE SETUP REPORT", "", "Business phone: (555) 123-4567", "", "Services / products:", "Test", "", ...styleLines, "", "Brand difference / positioning:", "Different", ""].join("\n");

check("ROOT CAUSE: the old two-line style format is invisible to the database reader (style comes back missing)", dbSingleLineRead(report(["Style direction:", "Clean, professional, trustworthy."]), "Style direction") === null);
check("the phone, written inline, was always found (so only desired_style was ever flagged)", dbSingleLineRead(report([]), "Business phone") === "(555) 123-4567");
check("FIX: the new inline format is found with the text intact", dbSingleLineRead(report(inlineReportLines("Style direction", "Clean, professional, trustworthy.")), "Style direction") === "Clean, professional, trustworthy.");
check("a style typed on several lines becomes one line, so the reader gets all of it", dbSingleLineRead(report(inlineReportLines("Style direction", "Warm\n\n  cream   and gold\r\nsimple")), "Style direction") === "Warm cream and gold simple");
check("a typed line that looks like another label cannot start a fake field (no newline survives)", inlineReportLines("Style direction", "Modern\nBusiness phone: 000").length === 1 && !inlineReportLines("Style direction", "Modern\nBusiness phone: 000")[0].includes("\n"));
check("a colon inside the answer is kept", dbSingleLineRead(report(inlineReportLines("Style direction", "Mood: calm")), "Style direction") === "Mood: calm");
check("an empty or 'Not provided' answer stays in the two-line form, so a genuinely missing style is still reported as missing", dbSingleLineRead(report(inlineReportLines("Style direction", "")), "Style direction") === null && dbSingleLineRead(report(inlineReportLines("Style direction", "Not provided")), "Style direction") === null && inlineReportLines("Style direction", "  ").join("|") === "Style direction:|Not provided");

check("the full request form and the targeted update both write the style line through the helper", (portal.match(/\.\.\.inlineReportLines\("Style direction"/g) || []).length === 2 && !/`Style direction:`/.test(portal));
check("the portal still reads the style back when it pre-fills the form (it accepts the inline format)", /setStyleDirection\(getSetupReportValue\(setupFields, "Style direction"\)\)/.test(portal) && /const inlineMatch = line\.match\(\/\^\(\[\^:\]\+\):\\s\*\(\.\*\)\$\/\)/.test(portal));
check("the build planner's parser and the owner card parser also accept an inline 'Label: value' line", /const inline = line\.match\(\/\^\(\[\^:\]\+\):\\s\*\(\.\*\)\$\/\)/.test(read("supabase/functions/prepare-build-plan/index.ts")) && /colonIndex > -1 && colonIndex < 35/.test(read("src/pages/OwnerPortal.tsx")));

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll checks passed.");
