// "Our work" photos on the client site: the pure rules (supabase/functions/_shared/site-photos.mjs), the builder wiring and the template's own limits agree.
// Offline, no network, no secrets. Planted-bug controls included.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  imageKindFromBytes, cleanPhotoText, selectGalleryPhotos, galleryFileName, buildGalleryConfig, bytesToBase64, isMissingPhotoFunction, sha256Hex, staleGalleryFiles,
  MAX_GALLERY_PHOTOS, MAX_PUBLISH_BYTES, IMAGE_TYPES,
} from "../supabase/functions/_shared/site-photos.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); }
}
const bytes = (...values) => Uint8Array.from([...values, ...new Array(Math.max(0, 16 - values.length)).fill(0)]);

// ---- what the bytes really are
const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0);
const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const webp = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
check("real JPG, PNG and WebP bytes are recognised", imageKindFromBytes(jpeg) === "image/jpeg" && imageKindFromBytes(png) === "image/png" && imageKindFromBytes(webp) === "image/webp");
check("scripts, SVG, GIF, PDF, RIFF-but-not-WebP and tiny or empty data are refused", [bytes(0x3c, 0x73, 0x76, 0x67), bytes(0x47, 0x49, 0x46, 0x38), bytes(0x25, 0x50, 0x44, 0x46), bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20), Uint8Array.from([0xff, 0xd8, 0xff]), new Uint8Array(0), null, undefined].every((b) => imageKindFromBytes(b) === null));
check("control: a file that claims to be a PNG but is a JPG would be caught by the type comparison", imageKindFromBytes(jpeg) !== "image/png");

// ---- text
check("alt text and captions lose markup and control characters, collapse spaces and stop at 160", cleanPhotoText(" A <b>big</b>\n\ttree\u0000 ") === "A big tree" && cleanPhotoText("x".repeat(500)).length === 160 && cleanPhotoText(null) === "" && cleanPhotoText(5) === "");
check("no angle brackets can survive cleaning", !/[<>]/.test(cleanPhotoText("<<script>>alert(1)</script>")));

// ---- selection
const row = (n, extra = {}) => ({ file_id: `f${n}`, bucket_id: "client-files", storage_path: `c/${n}.jpg`, file_type: "image/jpeg", file_size: 1000, content_sha256: "a".repeat(64), role: "work", alt_text: `a${n}`, caption: "", sort_order: n, ...extra });
const picked = selectGalleryPhotos([row(3), row(1), row(2, { role: "site" }), row(4, { file_type: "application/pdf" }), row(5, { file_size: MAX_PUBLISH_BYTES + 1 }), row(6, { bucket_id: "other" }), row(7, { storage_path: "" })]);
check("only work photos, in the client's order", picked.selected.map((r) => r.file_id).join() === "f1,f3");
check("wrong type, oversize, wrong bucket and missing path are skipped WITH a reason (never silently)", picked.skipped.length === 4 && picked.skipped.every((s) => s.reason));
check("a photo without the scan's fingerprint is skipped (it could not be proven to be the scanned file)", (() => { const r = selectGalleryPhotos([row(1, { content_sha256: null }), row(2, { content_sha256: "xyz" }), row(3, { content_sha256: undefined }), row(4)]); return r.selected.map((x) => x.file_id).join() === "f4" && r.skipped.filter((x) => /fingerprint/.test(x.reason)).length === 3; })());
check("at most 12 photos are published; the rest are reported", (() => { const many = Array.from({ length: 15 }, (_, i) => row(i + 1)); const r = selectGalleryPhotos(many); return r.selected.length === MAX_GALLERY_PHOTOS && r.skipped.length === 3 && r.skipped.every((s) => /more than 12/.test(s.reason)); })());
check("junk input never crashes the selection", [null, undefined, "x", 5, [null, undefined, 5, "x", {}]].every((v) => { try { return selectGalleryPhotos(v).selected.length === 0; } catch { return false; } }));

// ---- names and config
check("repo file names are chosen by us, never by the client", galleryFileName(0, "image/jpeg") === "work-01.jpg" && galleryFileName(11, "image/webp") === "work-12.webp" && galleryFileName(1, "image/png") === "work-02.png");
check("a name for an unsupported type or position is refused", [["image/svg+xml", 0], ["image/jpeg", 12], ["image/jpeg", -1], ["image/jpeg", 1.5]].every(([t, i]) => { try { galleryFileName(i, t); return false; } catch { return true; } }));
const config = buildGalleryConfig([{ name: "work-01.jpg", alt: "A <b>tree</b>", caption: "Trimmed" }, { name: "../evil.jpg", alt: "x" }, { name: "work-02.png", alt: "Stump", caption: "" }, { name: "work-03.svg", alt: "x" }]);
check("the gallery config lists only our own names, with cleaned text and optional captions", config && config.items.length === 2 && config.items[0].src === "./gallery/work-01.jpg" && config.items[0].alt === "A tree" && config.items[0].caption === "Trimmed" && !("caption" in config.items[1]) && config.items[1].src === "./gallery/work-02.png");
check("no photos means no gallery block (the template hides the section)", buildGalleryConfig([]) === null && buildGalleryConfig(null) === null && buildGalleryConfig([{ name: "x.jpg" }]) === null);
check("every path the config can produce passes the template's own allowlist", (() => {
  const app = fs.readFileSync("templates/business-v1/app.js", "utf8");
  const regex = eval(app.match(/const GALLERY_SRC = (\/.*\/[a-z]*);/)[1]);
  const all = []; for (let i = 0; i < MAX_GALLERY_PHOTOS; i += 1) for (const type of Object.keys(IMAGE_TYPES)) all.push({ name: galleryFileName(i, type), alt: "x" });
  const cfg = buildGalleryConfig(all.filter((_, i) => i % 3 === 0 || true).slice(0, MAX_GALLERY_PHOTOS));
  return cfg.items.every((item) => regex.test(item.src)) && all.every((item) => regex.test(`./gallery/${item.name}`));
})());
check("base64 matches the platform encoder", bytesToBase64(jpeg) === Buffer.from(jpeg).toString("base64") && bytesToBase64(new Uint8Array(70000).fill(255)) === Buffer.from(new Uint8Array(70000).fill(255)).toString("base64"));
check("a missing database function is recognised as 'no photos', real errors are not", isMissingPhotoFunction({ code: "42883" }) && isMissingPhotoFunction({ code: "PGRST202" }) && isMissingPhotoFunction({ message: "Could not find the function public.get_site_photos_for_build in the schema cache" }) && !isMissingPhotoFunction({ code: "42501", message: "permission denied" }) && !isMissingPhotoFunction(null));

// ---- the scan fingerprint and stale files
check("sha256Hex matches the platform hash", (await sha256Hex(Buffer.from("abc"))) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" && (await sha256Hex(jpeg)) === (await import("node:crypto")).createHash("sha256").update(jpeg).digest("hex"));
check("stale gallery files: only our own work-NN.ext names that this build did not write again", JSON.stringify(staleGalleryFiles(["work-01.jpg", "work-02.png", "work-03.jpg", "README.md", "logo.png", "work-1.jpg", "work-04.gif", "../work-05.jpg"], ["work-01.jpg", "work-02.png"])) === JSON.stringify(["work-03.jpg"]));
check("a slot that changed type leaves a stale file to remove; removing every photo removes every file; junk input is harmless", JSON.stringify(staleGalleryFiles(["work-01.jpg"], ["work-01.png"])) === JSON.stringify(["work-01.jpg"]) && staleGalleryFiles(["work-01.jpg", "work-02.png"], []).length === 2 && staleGalleryFiles(null, null).length === 0 && staleGalleryFiles([5, null, "work-01.jpg"], ["work-01.jpg"]).length === 0);

// ---- builder patch (the builder change waits in docs/drafts/functions until the photo migration is promoted)
const patchPath = "docs/drafts/functions/build-business-website-photos.diff";
const patch = fs.readFileSync(patchPath, "utf8");
const added = patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n");
const live = fs.readFileSync("supabase/functions/build-business-website/index.ts", "utf8");
check("the builder patch still applies cleanly to the current builder (it cannot rot unnoticed)", spawnSync("git", ["apply", "--check", patchPath], { encoding: "utf8" }).status === 0);
check("the live builder does NOT call the draft database function yet (CI would reject it)", !live.includes("get_site_photos_for_build") && !live.includes("site-photos.mjs"));
const builder = added; // the added lines of the draft patch
const wiring = {
  "the builder asks the database (clean + released only) instead of listing files itself": (b) => b.includes('admin.rpc("get_site_photos_for_build", { target_client_id: job.client_id })') && !/from\("client_files"\)/.test(b),
  "each photo is type-checked from its bytes against the type it claims": (b) => b.includes("imageKindFromBytes(bytes)") && /kind !== String\(row\.file_type\)\.toLowerCase\(\)/.test(b),
  "size is checked again after download": (b) => b.includes("bytes.length > MAX_PUBLISH_BYTES"),
  "files are committed under names the builder chooses, in a gallery/ folder": (b) => b.includes("galleryFileName(published.length, kind)") && b.includes("`gallery/${name}`"),
  "a paused client or kill switch is checked before every photo and never swallowed": (b) => /for \(const row of selected\) \{\s*await assertProviderMutationAllowed\(admin, job\);/.test(b),
  "each download must hash to the scan's fingerprint, or it is skipped": (b) => b.includes("await sha256Hex(bytes) !== String(row.content_sha256).toLowerCase()"),
  "gallery files the build did not write are deleted (removed or flagged photos never stay public)": (b) => b.includes("staleGalleryFiles([file.name], published.map((item) => item.name))") && b.includes("deleteRepoFile(owner, repo, branch, `gallery/${stale.name}`"),
  "a read error stops the build to retry instead of silently dropping the photos": (b) => b.includes('throw new Error("Website photos could not be read, so the build will retry.")'),
  "the gallery block reaches both the written config and the quality check": (b) => (b.match(/\{ gallery: gallery\.config \}/g) || []).length === 2,
  "a missing photo function (migration not applied yet) is treated as no photos": (b) => b.includes("isMissingPhotoFunction(photoRes.error)"),
};
for (const [name, test] of Object.entries(wiring)) check(name, test(builder));
const plant = (name, from, to, key) => check(`control: ${name}`, builder.includes(from) && !wiring[key](builder.split(from).join(to)));
plant("skipping the byte check is noticed", "imageKindFromBytes(bytes)", "row.file_type", "each photo is type-checked from its bytes against the type it claims");
plant("trusting the client's own file name is noticed", "galleryFileName(published.length, kind)", "String(row.file_name)", "files are committed under names the builder chooses, in a gallery/ folder");
plant("dropping the kill-switch check is noticed", "await assertProviderMutationAllowed(admin, job); // a paused client", "// a paused client", "a paused client or kill switch is checked before every photo and never swallowed");
plant("listing files directly instead of the clean-only function is noticed", 'admin.rpc("get_site_photos_for_build", { target_client_id: job.client_id })', 'admin.from("client_files").select("*")', "the builder asks the database (clean + released only) instead of listing files itself");

plant("skipping the fingerprint comparison is noticed", "await sha256Hex(bytes) !== String(row.content_sha256).toLowerCase()", "false", "each download must hash to the scan's fingerprint, or it is skipped");
plant("not deleting stale gallery files is noticed", "deleteRepoFile(owner, repo, branch, `gallery/${stale.name}`", "noop(owner, repo, branch, `gallery/${stale.name}`", "gallery files the build did not write are deleted (removed or flagged photos never stay public)");
plant("swallowing a photo-list read error is noticed", 'throw new Error("Website photos could not be read, so the build will retry.")', "return none", "a read error stops the build to retry instead of silently dropping the photos");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll site photo checks passed.");
process.exit(failures ? 1 : 0);
