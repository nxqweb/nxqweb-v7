// Website photos panel: the pure rules (src/lib/sitePhotos.ts), the gateway against the real migration 276, and the "off until applied" switch.
// Offline, no network. Node >= 22.18 imports the .ts helpers directly. Planted-bug controls included.
import fs from "node:fs";
import {
  photoProblem, scanLabel, nextSortOrder, roomFor, moveWithinRole, photoFromRow, photosFromRows, photoErrorMessage, roleLabels,
  MAX_PICK_BYTES, MAX_WORK_PHOTOS, MAX_ALL_PHOTOS,
} from "../src/lib/sitePhotos.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const photo = (id, role, sortOrder, extra = {}) => ({ fileId: id, fileName: `${id}.jpg`, role, altText: id, caption: "", sortOrder, scanStatus: "pending", released: false, ...extra });

// ---- what can be picked
check("JPG, PNG and WebP of a sane size are accepted", [["a.jpg", "image/jpeg"], ["a.png", "image/png"], ["a.webp", "image/webp"], ["a.JPG", "IMAGE/JPEG"]].every(([name, type]) => photoProblem({ name, type, size: 5000 }) === ""));
check("PDF, HEIC, GIF, SVG, text and unknown types are refused with the file name in the message", ["application/pdf", "image/heic", "image/gif", "image/svg+xml", "text/plain", ""].every((type) => /^pic\.x: choose a JPG, PNG or WebP/.test(photoProblem({ name: "pic.x", type, size: 5000 }))));
check("the HEIC refusal gives the iPhone tip", /Most Compatible/.test(photoProblem({ name: "p.heic", type: "image/heic", size: 5 })));
check("empty and over-25-MB files are refused", /empty/.test(photoProblem({ name: "e.png", type: "image/png", size: 0 })) && /25 MB/.test(photoProblem({ name: "b.png", type: "image/png", size: MAX_PICK_BYTES + 1 })) && photoProblem({ name: "ok.png", type: "image/png", size: MAX_PICK_BYTES }) === "");
check("the limits match the database (12 in Our work, 24 in all)", MAX_WORK_PHOTOS === 12 && MAX_ALL_PHOTOS === 24);

// ---- scan wording
check("only a clean AND released photo says Ready", scanLabel({ scanStatus: "clean", released: true }).text === "Ready" && scanLabel({ scanStatus: "clean", released: false }).tone === "wait");
check("flagged, errored and pending photos get plain words and never say Ready", scanLabel({ scanStatus: "infected", released: false }).tone === "bad" && scanLabel({ scanStatus: "suspicious", released: true }).tone === "bad" && scanLabel({ scanStatus: "error", released: false }).tone === "bad" && scanLabel({ scanStatus: "pending", released: false }).tone === "wait" && scanLabel({ scanStatus: "scanning", released: false }).tone === "wait" && scanLabel({ scanStatus: "weird", released: true }).tone === "wait");

// ---- room and order
check("next order is one after the highest in that role only", nextSortOrder([photo("a", "work", 3), photo("b", "site", 9)], "work") === 4 && nextSortOrder([], "work") === 1 && nextSortOrder([photo("a", "work", 999)], "work") === 999);
const twelve = Array.from({ length: 12 }, (_, i) => photo(`w${i}`, "work", i + 1));
check("room left: Our work stops at 12, other photos stop at the 24 total", roomFor(twelve, "work") === 0 && roomFor(twelve, "site") === 12 && roomFor([], "work") === 12 && roomFor([...twelve, ...Array.from({ length: 12 }, (_, i) => photo(`s${i}`, "site", i + 1))], "site") === 0);
const trio = [photo("a", "work", 1), photo("b", "work", 2), photo("c", "work", 3), photo("z", "site", 1)];
check("moving up and down swaps only the two neighbours", JSON.stringify(moveWithinRole(trio, "b", -1)) === JSON.stringify([{ fileId: "b", sortOrder: 1 }, { fileId: "a", sortOrder: 2 }]) && JSON.stringify(moveWithinRole(trio, "b", 1)) === JSON.stringify([{ fileId: "b", sortOrder: 3 }, { fileId: "c", sortOrder: 2 }]));
check("the ends cannot move further, another role is never touched, unknown ids are ignored", moveWithinRole(trio, "a", -1) === null && moveWithinRole(trio, "c", 1) === null && moveWithinRole(trio, "z", -1) === null && moveWithinRole(trio, "nope", 1) === null);
check("equal or gappy order numbers still swap cleanly", (() => { const t = [photo("a", "work", 5), photo("b", "work", 5), photo("c", "work", 500)]; const m = moveWithinRole(t, "b", 1); return m && m.length === 2 && m[0].fileId === "b" && m[1].fileId === "c" && m[0].sortOrder !== m[1].sortOrder; })());

// ---- database rows
check("a database row becomes a typed photo and junk is dropped", photoFromRow({ file_id: "x", file_name: "x.jpg", role: "work", alt_text: "t", caption: "c", sort_order: 4, scan_status: "clean", released: true })?.released === true
  && [null, "x", 5, [], {}, { file_id: 5, role: "work" }, { file_id: "x", role: "banner" }].every((row) => photoFromRow(row) === null));
check("rows are length-capped and numbers kept in range", (() => { const p = photoFromRow({ file_id: "x", role: "site", alt_text: "a".repeat(500), sort_order: 99999, released: "yes" }); return p.altText.length === 160 && p.sortOrder === 999 && p.released === false && p.scanStatus === "pending"; })());
check("a non-list result gives an empty list", photosFromRows(null).length === 0 && photosFromRows({}).length === 0 && photosFromRows([{ file_id: "x", role: "work" }, null]).length === 1);
check("the database's refusals become friendly sentences, never internals", /12 photos/.test(photoErrorMessage(new Error("You can show up to 12 photos in Our work."))) && /24/.test(photoErrorMessage(new Error("You can keep up to 24 website photos."))) && /characters/.test(photoErrorMessage(new Error("Photo descriptions cannot contain the characters < or >."))) && !/syntax|relation|pg_/.test(photoErrorMessage(new Error('relation "x" does not exist'))));
check("both groups have plain labels", /my work/i.test(roleLabels.work) && /other photos/i.test(roleLabels.site));

// ---- gateway vs the real migration SQL
const gateway = fs.readFileSync("src/lib/sitePhotosSupabaseGateway.ts", "utf8");
const sql = fs.readFileSync("supabase/migrations/276_site_photos.sql", "utf8");
const sqlArgs = (name) => { const m = sql.match(new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`)); return m ? m[1].split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean) : null; };
const callArgs = (name) => { const m = gateway.match(new RegExp(`rpc\\("${name}"(?:,\\s*\\{([\\s\\S]*?)\\}\\))?`)); return m ? (m[1] || "").split(",").map((p) => p.split(":")[0].trim()).filter(Boolean) : null; };
for (const name of ["list_my_site_photos", "save_my_site_photo", "remove_my_site_photo"]) {
  const a = sqlArgs(name); const b = callArgs(name);
  check(`gateway calls ${name} with exactly the SQL's argument names`, Boolean(a) && Boolean(b) && JSON.stringify(a) === JSON.stringify(b), `sql=${a} gateway=${b}`);
}
check("control: the comparison would notice a wrong argument name", JSON.stringify(sqlArgs("save_my_site_photo")) !== JSON.stringify(["file_id", "role"]));

// ---- off until promoted
const srcFiles = [];
(function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = `${dir}/${entry.name}`; if (entry.isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(entry.name)) srcFiles.push(full); } })("src");
check("only the gateway file calls the three photo functions from src/", srcFiles.filter((f) => /rpc\(\s*"(?:list_my_site_photos|save_my_site_photo|remove_my_site_photo)"/.test(fs.readFileSync(f, "utf8"))).join() === "src/lib/sitePhotosSupabaseGateway.ts");
check("the gateway is imported only by the one switch", srcFiles.filter((f) => f !== "src/lib/sitePhotosSupabaseGateway.ts" && /from\s+["'][^"']*sitePhotosSupabaseGateway/.test(fs.readFileSync(f, "utf8"))).join() === "src/lib/sitePhotosConfig.ts");
const config = fs.readFileSync("src/lib/sitePhotosConfig.ts", "utf8");
check("the one switch is on (migration 276 is applied to staging) and stays null when Supabase is not configured", /export const sitePhotosGateway: SitePhotosGateway \| null = supabase \? createSitePhotosGateway\(supabase\) : null;/.test(config));
const portal = fs.readFileSync("src/pages/ClientPortal.tsx", "utf8");
const changes = fs.readFileSync("src/pages/ClientBusinessChanges.tsx", "utf8");
check("the brief and the redesign form show the panel only when the switch is on", /sitePhotosGateway && supabase && client \? <ClientSitePhotos/.test(portal) && /sitePhotosGateway && supabase && clientId \? <ClientSitePhotos/.test(changes));
check("control: turning the switch on would be noticed by this test", !/= createSitePhotosGateway/.test(config));
const uploader = fs.readFileSync("src/lib/sitePhotoUpload.ts", "utf8");
check("the uploader uses only functions that already exist in real migrations", /nxq_authorize_storage_upload/.test(fs.readFileSync("src/lib/storageUploadAuthorization.ts", "utf8")) && uploader.includes("current_client_register_uploaded_file") && !/list_my_site_photos|save_my_site_photo/.test(uploader));
check("the uploader cleans up after every failure (stored copy removed, ticket cancelled)", (uploader.match(/cancelStorageUpload\(client, ticket\)/g) || []).length >= 3 && (uploader.match(/\.remove\(\[path\]\)/g) || []).length >= 2);
const panel = fs.readFileSync("src/components/ClientSitePhotos.tsx", "utf8");
check("every photo needs a description before upload, and big photos are shrunk first", panel.includes("altText.trim().length < 3") && panel.includes("await shrinkPhoto(item.file)"));
check("the panel never touches the database directly", !/supabase|\.rpc\(|fetch\(/.test(panel));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll website photo panel checks passed.");
process.exit(failures ? 1 : 0);
