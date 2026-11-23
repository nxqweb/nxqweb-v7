// Offline test: the client's own logo and background card (parked patch 10_store_media_frontend.patch; database draft 10; helper src/lib/storeMedia.ts), 2026-11-23.
import fs from "node:fs";
import { extensionFor, mediaFilePath, mediaSaveMessage, parseStoreMedia } from "../src/lib/storeMedia.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const uid = "0a1b2c3d-1111-4222-8333-444455556666";
const own = (f) => `https://abcdefgh.supabase.co/storage/v1/object/public/commerce-website-content/${uid}/branding/${f}`;

check("the storage path is the client's own folder, branding subfolder, with a random token", mediaFilePath(uid, "logo", "png", "a1b2c3d4e5f60718") === `${uid}/branding/logo-a1b2c3d4e5f60718.png` && mediaFilePath(uid, "background", "webp", "a1b2c3d4") === `${uid}/branding/background-a1b2c3d4.webp`);
check("anything odd gives no path (not a uuid, wrong kind, svg, dot-dot, short or non-hex token)", [[ "x", "logo", "png", "a1b2c3d4"], [uid, "banner", "png", "a1b2c3d4"], [uid, "logo", "svg", "a1b2c3d4"], [uid, "logo", "../png", "a1b2c3d4"], [uid, "logo", "png", "abc"], [uid, "logo", "png", "../../x1234"], [uid + "/..", "logo", "png", "a1b2c3d4"], [undefined, undefined, undefined, undefined]].every((a) => mediaFilePath(...a) === null));
check("jpeg files are saved as .jpg and the others keep their extension", extensionFor("jpeg") === "jpg" && extensionFor("png") === "png" && extensionFor("webp") === "webp");
const row = parseStoreMedia({ has_storefront: true, client_id: uid, logo: own("logo-1.png"), background: own("bg-1.webp"), background_overlay: 0.3, owner_logo: false });
check("what the database returns is read back", row.hasStorefront && row.clientId === uid && row.logo === own("logo-1.png") && row.background === own("bg-1.webp") && row.overlay === 0.3 && row.ownerLogo === false);
check("an owner-shipped /brand/ logo is not shown as the client's, and bad pictures or ids are ignored", (() => { const r = parseStoreMedia({ has_storefront: true, client_id: "nope", logo: "/brand/x.png", background: "https://evil.example.com/x.png", background_overlay: 5, owner_logo: true }); return r.logo === null && r.background === null && r.clientId === null && r.ownerLogo === true && r.overlay === 0; })());
check("odd input never throws and means nothing is set", [undefined, null, 5, "x", [], {}].every((v) => { const r = parseStoreMedia(v); return r.hasStorefront === false && r.logo === null && r.background === null && r.clientId === null; }));
check("server refusals become plain words and the server's own sentence is never shown", [["Create your store first.", /Create your store/], ["The background must be a picture uploaded to your own store folder.", /own store folder/], ["The background must be a PNG, JPEG or WEBP picture uploaded to your own store folder.", /PNG, JPEG or WEBP/], ["Client workspace not found.", /sign in/], ["boom sk-SECRET", /could not be saved/], [undefined, /could not be saved/]].every(([raw, want]) => { const m = mediaSaveMessage(raw); return want.test(m) && !/sk-|SECRET|boom/.test(m); }));

const patch = fs.readFileSync("docs/drafts/patches/10_store_media_frontend.patch", "utf8");
check("the parked patch adds the card and puts it on the Live store page", /\+\+\+ b\/src\/components\/StoreMediaCard\.tsx/.test(patch) && /\+\+\+ b\/src\/pages\/ClientCommerceLiveStore\.tsx/.test(patch) && /\+\s+<StoreMediaCard \/>/.test(patch));
check("the card goes through the upload ticket, the existing bucket, then the new save function", /authorizeStorageUpload\(supabase, "commerce-website-content", path, file\)/.test(patch) && /completeStorageUpload/.test(patch) && /rpc\("save_my_store_media"/.test(patch) && /rpc\("get_my_store_media"\)/.test(patch));
check("a failed save removes the just-uploaded file, and a failed upload or finalize cancels the ticket", /remove\(\[path\]\)/.test(patch) && /cancelStorageUpload\(supabase, ticket\)/.test(patch));
check("the rights tick is always required, a small picture needs its own tick, and the save button stays off until the rules allow it", /rightsConfirmed: rights\[kind\]/.test(patch) && /acknowledgedSmall: soft\[kind\]/.test(patch) && /disabled=\{Boolean\(busy\) \|\| !check\?\.ok\}/.test(patch) && /This picture is mine, or I have permission to use it on my store/.test(patch));
check("only PNG, JPEG and WEBP are accepted (SVG refused in plain words) and pictures are stored at most 2400 px", /accept="image\/png,image\/jpeg,image\/webp"/.test(patch) && /SVG pictures are not supported here yet/.test(patch) && /logoStoredSize\(width, height\) : backgroundStoredSize\(width, height\)/.test(patch));
check("a background's softening amount is measured from the picture and saved with it", /readabilityOverlay\(/.test(patch) && /patch\.background_overlay = item\.overlay/.test(patch));
check("the card shows nothing until the database answers and the client has a store", /if \(!media \|\| !media\.hasStorefront\) return null;/.test(patch));
check("no keys, environment values or outside addresses in the card", !/api[_-]?key|process\.env|import\.meta\.env|https?:\/\/(?!abcdefgh)/i.test(patch.split("\n").filter((l) => l.startsWith("+")).join("\n").replace(/\/\/.*$/gm, "")));

const draft = fs.readFileSync("docs/drafts/migrations/10_store_media.sql", "utf8");
check("draft 10 returns the client id so the card can build the client's own folder", /'client_id', client_uuid/.test(draft));
const callers = fs.readdirSync("src", { recursive: true }).filter((f) => /\.tsx?$/.test(f)).filter((f) => /get_my_store_media|save_my_store_media/.test(fs.readFileSync(`src/${f}`, "utf8")));
check("no page in src calls the draft-only functions yet (they wait for the approved migration)", callers.length === 0, callers.join(","));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll store media checks passed (offline).");
process.exit(failures ? 1 : 0);
