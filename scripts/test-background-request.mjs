// Offline test: the client's "make me a background" card (parked patch 12_background_request_button.patch; database draft 11; helper src/lib/backgroundRequest.ts), 2026-11-24.
import fs from "node:fs";
import { MOODS, WHAT_I_SELL_MAX, parseBackgroundStatus, requestPayload, requestProblem, requestResultMessage, statusLine } from "../src/lib/backgroundRequest.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }

check("there are five moods and the first is calm", MOODS.length === 5 && MOODS[0].value === "calm" && MOODS.every((m) => m.label.length > 3));
check("a good form has no problem and becomes the exact arguments the database takes", requestProblem({ mood: "warm", whatISell: "handmade candles" }) === "" && JSON.stringify(requestPayload({ mood: "warm", whatISell: "handmade candles" })) === JSON.stringify({ mood_value: "warm", what_i_sell_value: "handmade candles" }));
check("a mood outside the list, or none, is a plain problem and sends nothing", ["spooky", "", undefined, null].every((m) => requestProblem({ mood: m, whatISell: "" }).length > 10 && requestPayload({ mood: m, whatISell: "" }) === null));
check("a description over the limit is refused, exactly at the limit is fine", requestProblem({ mood: "calm", whatISell: "x".repeat(WHAT_I_SELL_MAX + 1) }).includes("60") && requestProblem({ mood: "calm", whatISell: "x".repeat(WHAT_I_SELL_MAX) }) === "");
check("symbols, tags and new lines are removed and spaces collapsed; empty or tiny means none", requestPayload({ mood: "calm", whatISell: "candles <b>and</b>\n\nsoap!!" }).what_i_sell_value === "candles b and b soap" && requestPayload({ mood: "calm", whatISell: "   " }).what_i_sell_value === null && requestPayload({ mood: "calm", whatISell: "<>" }).what_i_sell_value === null && requestPayload({ mood: "calm", whatISell: "a" }).what_i_sell_value === null);
check("letters from other languages are kept", requestPayload({ mood: "calm", whatISell: "velas artesanales" }).what_i_sell_value === "velas artesanales" && requestPayload({ mood: "calm", whatISell: "bougies faites à la main" }).what_i_sell_value === "bougies faites à la main");

const st = parseBackgroundStatus({ enabled: true, allowance: 3, used: 1, remaining: 2, can_request: true, reason: "", in_progress: false, latest_status: "approved" });
check("the database's status is read back", st.enabled && st.allowance === 3 && st.used === 1 && st.remaining === 2 && st.canRequest && !st.inProgress && st.latestStatus === "approved");
check("anything missing or odd means disabled with nothing to request (the card stays hidden)", [undefined, null, 5, "x", [], {}, { enabled: "true", can_request: 1, allowance: -4, remaining: 2.5 }].every((v) => { const r = parseBackgroundStatus(v); return r.enabled === false && r.canRequest === false && r.allowance === 0 && r.remaining === 0; }));
check("every status has a plain sentence and an unknown one has none", ["requested", "generating", "pending_approval", "approved", "rejected", "failed"].every((s) => statusLine(s).length > 20) && statusLine("weird") === "" && statusLine("") === "");
check("the waiting-for-approval line says it is not live yet", /approve/.test(statusLine("pending_approval")) && /once approved/.test(statusLine("pending_approval")));
check("a success reply says it will be checked, and known refusals pass through in plain words", requestResultMessage({ ok: true }).ok === true && /checks it before it goes live/.test(requestResultMessage({ ok: true }).message) && ["Automatic backgrounds are switched off right now.", "The monthly limit for all stores has been reached. It resets next month, or the owner can raise it.", "This store has used its background pictures for this period.", "Please wait 40 seconds before trying again.", "You already have a background being made or waiting for approval. Please wait for it first.", "Create your store first."].every((reason) => requestResultMessage({ ok: false, reason }).message === reason));
check("an unknown server message is never shown", !/secret|42P01|internal/.test(requestResultMessage({ ok: false, reason: "ERROR 42P01 secret internal detail" }).message) && requestResultMessage({ ok: false, reason: "ERROR 42P01" }).ok === false && [undefined, null, 5, "x", []].every((v) => requestResultMessage(v).ok === false && requestResultMessage(v).message.length > 15));

const patch = fs.readFileSync("docs/drafts/patches/12_background_request_button.patch", "utf8");
check("the parked patch adds the card and puts it on the Live store page", /\+\+\+ b\/src\/components\/StoreBackgroundRequestCard\.tsx/.test(patch) && /\+\+\+ b\/src\/pages\/ClientCommerceLiveStore\.tsx/.test(patch) && /\+\s+<StoreBackgroundRequestCard \/>/.test(patch));
check("the card calls only the two client functions of draft 11", /rpc\("get_my_background_status"\)/.test(patch) && /rpc\("request_my_store_background", payload\)/.test(patch) && !/rpc\("nxq_background/.test(patch) && !/rpc\("owner_/.test(patch));
check("the card stays hidden unless the owner has the maker switched on, and only sends a valid form", /if \(!status \|\| !status\.enabled\) return null;/.test(patch) && /disabled=\{busy \|\| Boolean\(problem\) \|\| !status\.canRequest\}/.test(patch) && /if \(!supabase \|\| !payload \|\| busy\) return;/.test(patch));
check("the client is told the picture is checked before it goes live", /checks it before it goes on your store/.test(patch) || /NXQX checks it before it goes on/.test(patch));
check("no keys, environment values or outside addresses in the card", !/api[_-]?key|process\.env|import\.meta\.env|https?:\/\//i.test(patch.split("\n").filter((l) => l.startsWith("+")).join("\n").replace(/\/\/.*$/gm, "")));

const draft = fs.readFileSync("docs/drafts/migrations/11_store_background_generation.sql", "utf8");
check("draft 11 has the client request function and the server take-next function, with the same moods", /function public\.request_my_store_background\(mood_value text default 'calm', what_i_sell_value text default null\)/.test(draft) && /function public\.nxq_background_take_next\(\)/.test(draft) && MOODS.every((m) => draft.includes(`'${m.value}'`)));
check("draft 11 lets only one request be in progress per store, and caps what they sell at the same 60", /status in \('requested', 'generating', 'pending_approval'\)/.test(draft) && /char_length\(what_they_sell\) <= 60/.test(draft) && WHAT_I_SELL_MAX === 60);
const callers = fs.readdirSync("src", { recursive: true }).filter((f) => /\.tsx?$/.test(f)).filter((f) => /get_my_background_status|request_my_store_background/.test(fs.readFileSync(`src/${f}`, "utf8")));
check("no page in src calls those draft-only functions yet (they wait for the approved migration)", callers.length === 0, callers.join(","));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll background request card checks passed (offline).");
process.exit(failures ? 1 : 0);
