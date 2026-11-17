// Offline test: the "Guide me" tours (src/lib/portalTours.ts). Every tour must point at a button that really exists on a page that really exists,
// the remembered progress must refuse anything odd, and the words must always land fully on the screen.
import fs from "node:fs";
import path from "node:path";
import { bubblePlace, findTour, parseProgress, serializeProgress, tours } from "../src/lib/portalTours.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const read = (file) => fs.readFileSync(file, "utf8");
function sourceFiles(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : /\.tsx$/.test(e.name) ? [path.join(dir, e.name)] : []); }

const app = read("src/App.tsx");
const allSource = sourceFiles("src").map(read).join("\n");
const nav = read("src/components/CommerceNav.tsx");
const guide = read("src/components/GuideMe.tsx");
const steps = tours.flatMap((tour) => tour.steps.map((step) => ({ tour: tour.id, ...step })));

// ---- the tours themselves
check("there are tours, each with a unique id, a label and at least one step", tours.length >= 5 && new Set(tours.map((t) => t.id)).size === tours.length && tours.every((t) => t.label.length >= 5 && t.steps.length >= 1));
check("the first-visit tour and the post-a-product tour exist (the component and the docs name them)", Boolean(findTour("welcome")) && Boolean(findTour("post-product")) && findTour("nope") === null && findTour(undefined) === null);
const badPath = steps.filter((s) => !app.includes(`path === "${s.path}"`));
check("every step lives on a page that App.tsx really routes", badPath.length === 0, badPath.map((s) => `${s.tour}: ${s.path}`).join(", "));
const navTargets = [...nav.matchAll(/href: "([^"]+)"/g)].map((m) => `nav-${m[1].split("/").pop()}`);
const missingTarget = steps.filter((s) => !(allSource.includes(`data-tour="${s.target}"`) || (s.target.startsWith("nav-") && navTargets.includes(s.target) && nav.includes('data-tour={`nav-${href.split("/").pop()}`}'))));
check("every step points at an element that really carries that data-tour name", missingTarget.length === 0, missingTarget.map((s) => `${s.tour}: ${s.target}`).join(", "));
check("a step is only ever on the Commerce pages where the Guide me button is mounted", steps.every((s) => s.path.startsWith("/client/commerce")) && app.includes('window.location.pathname.startsWith("/client/commerce") ? <GuideMe /> : null'));
check("the words are short and plain: a title, at most 240 characters, no jargon", steps.every((s) => s.title.length >= 3 && s.title.length <= 40 && s.text.length >= 20 && s.text.length <= 240 && !/\b(SKU|variant|SEO|RPC|database|backend|deploy)\b/i.test(`${s.title} ${s.text} ${s.missing || ""}`)), steps.filter((s) => s.text.length > 240).map((s) => s.target).join(","));
check("no step tells anyone to type a password, and the payment step warns against it", steps.every((s) => !/(?<!never )type (your|a) password/i.test(s.text)) && steps.some((s) => s.target === "live-payment" && /Never type a password/.test(s.text)));
check("buttons that only appear later explain themselves when missing", ["photos-upload", "live-share", "live-order-mode"].every((t) => steps.filter((s) => s.target === t).every((s) => (s.missing || "").length > 20)));

// ---- remembered progress
check("progress round-trips", JSON.stringify(parseProgress(serializeProgress({ tourId: "post-product", step: 2 }))) === JSON.stringify({ tourId: "post-product", step: 2 }));
check("progress refuses anything odd: junk, unknown tours, steps out of range, fractions, huge text", [null, undefined, "", "not json", "[]", "5", '{"tourId":"nope","step":0}', '{"tourId":"post-product","step":99}', '{"tourId":"post-product","step":-1}',
  '{"tourId":"post-product","step":1.5}', '{"tourId":"post-product","step":"1"}', '{"tourId":"post-product"}', `{"tourId":"post-product","step":0,"x":"${"a".repeat(300)}"}`].every((raw) => parseProgress(raw) === null));
check("progress keeps only the two known fields", Object.keys(parseProgress('{"tourId":"welcome","step":1,"extra":"<script>"}')).join() === "tourId,step");

// ---- where the words go
const viewport = { width: 1280, height: 800 }; const bubble = { width: 360, height: 200 };
const inside = (p) => p.left >= 12 && p.top >= 12 && p.left + bubble.width <= viewport.width - 12 + 0.001 && p.top + bubble.height <= viewport.height - 12 + 0.001;
const spots = [{ top: 100, left: 500, width: 200, height: 50 }, { top: 700, left: 500, width: 200, height: 60 }, { top: 10, left: 0, width: 60, height: 30 }, { top: 300, left: 1240, width: 40, height: 40 }, { top: -200, left: 400, width: 300, height: 100 }, { top: 0, left: 0, width: 1280, height: 800 }, { top: 5000, left: 400, width: 100, height: 40 }];
check("the words always land fully on the screen, wherever the button is", spots.every((s) => inside(bubblePlace(s, viewport, bubble))));
check("the words go under the button when there is room, and above it when there is not", bubblePlace(spots[0], viewport, bubble).side === "below" && bubblePlace(spots[0], viewport, bubble).top === 164 && bubblePlace(spots[1], viewport, bubble).side === "above" && bubblePlace(spots[1], viewport, bubble).top === 486);
check("the words stay on a small phone screen too", (() => { const v = { width: 320, height: 568 }; const b = { width: 296, height: 220 }; const p = bubblePlace({ top: 400, left: 10, width: 300, height: 44 }, v, b); return p.left >= 12 && p.left + b.width <= v.width - 12 + 0.001 && p.top >= 12 && p.top + b.height <= v.height - 12 + 0.001; })());

// ---- the component's promises
check("the tour never talks to the server and never injects HTML", !/supabase|fetch\(|dangerouslySetInnerHTML|innerHTML/.test(guide));
check("the page underneath stays usable: the highlight lets clicks through", /\.guide-ring \{[^}]*pointer-events: none/.test(read("src/styles/guide-tour.css")) && /\.guide-dim \{[^}]*pointer-events: none/.test(read("src/styles/guide-tour.css")));
check("keyboard and screen readers: a labelled dialog that takes focus, Escape stops, the button says whether its menu is open", /role="dialog"/.test(guide) && /aria-labelledby="guide-step-title"/.test(guide) && /bubbleRef\.current\?\.focus\(\)/.test(guide) && /event\.key === "Escape"/.test(guide) && /aria-expanded=\{menuOpen\}/.test(guide));
check("storage problems (private browsing) never break the page", (guide.match(/try \{/g) || []).length >= 4 && /catch \{ return true; \}/.test(guide));
check("the first-visit offer shows once and can be declined", /welcomedKey/.test(guide) && /Not now/.test(guide) && /markWelcomed\(\); setOfferWelcome\(false\)/.test(guide));
check("reduced motion is respected", /prefers-reduced-motion: reduce/.test(guide) && /prefers-reduced-motion: reduce/.test(read("src/styles/guide-tour.css")));
check("every tap target in the tour is at least 44px tall", (read("src/styles/guide-tour.css").match(/min-height: 44px/g) || []).length >= 3);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll guide-tour checks passed (offline).");
process.exit(failures ? 1 : 0);
