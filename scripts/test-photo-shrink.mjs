// Offline test: product photos are made a sensible size in the owner's browser before upload (src/lib/photoShrink.ts). The picture work
// itself needs a browser (checked separately with a real one); this checks the size plan, which pictures are touched, the file name,
// and that the upload uses the smaller file everywhere, including the size it tells the server.
import fs from "node:fs";
import { shrinkMaxSide, shrinkPhoto, shrinkPlan, shrinkSkipBelowBytes, shrinkTarget, shrunkName } from "../src/lib/photoShrink.ts";

let failures = 0;
function check(name, ok, detail = "") { if (ok) console.log(`PASS  ${name}`); else { failures += 1; console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`); } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check("a phone photo is scaled so its longest side is 1600, keeping its shape", same(shrinkPlan(4032, 3024), { width: 1600, height: 1200, resize: true }) && same(shrinkPlan(3024, 4032), { width: 1200, height: 1600, resize: true }) && shrinkMaxSide === 1600);
check("a picture that already fits is never enlarged", same(shrinkPlan(1200, 800), { width: 1200, height: 800, resize: false }) && same(shrinkPlan(1600, 1600), { width: 1600, height: 1600, resize: false }));
check("a very long thin picture never gets a zero side", shrinkPlan(20000, 3).height === 1 && shrinkPlan(20000, 3).width === 1600);
check("odd sizes give no plan (the original is then kept)", [[0, 100], [100, 0], [NaN, 5], [-4, 4], [Infinity, 4]].every(([w, h]) => shrinkPlan(w, h) === null) && shrinkPlan(100, 100, 0) === null);

const big = 3 * 1024 * 1024;
check("JPEG, PNG and WEBP over 500 KB are shrunk and keep their kind", shrinkTarget("image/jpeg", big) === "image/jpeg" && shrinkTarget("image/png", big) === "image/png" && shrinkTarget("image/webp", big) === "image/webp");
check("a small picture, a GIF (it may be animated) and unknown kinds are left alone", shrinkTarget("image/jpeg", shrinkSkipBelowBytes) === null && shrinkTarget("image/gif", big) === null && shrinkTarget("image/heic", big) === null && shrinkTarget("", big) === null && shrinkTarget("image/jpeg", NaN) === null);

check("the file name gets the extension of what the picture now is", shrunkName("IMG_0042.HEIC", "image/jpeg") === "IMG_0042.jpg" && shrunkName("candle.photo.png", "image/png") === "candle.photo.png" && shrunkName("x.jpeg", "image/webp") === "x.webp");
check("a missing or extension-only name still gives a usable name", shrunkName("", "image/jpeg") === "photo.jpg" && shrunkName(".png", "image/jpeg") === "photo.jpg");

// Without a browser (no createImageBitmap, no document) the function must hand back the very same file and never throw.
const file = new File([new Uint8Array(600 * 1024)], "big.jpg", { type: "image/jpeg" });
check("when shrinking is not possible the original file comes back untouched", (await shrinkPhoto(file)) === file && (await shrinkPhoto(new File(["x"], "tiny.jpg", { type: "image/jpeg" }))).name === "tiny.jpg");

const source = fs.readFileSync("src/lib/photoShrink.ts", "utf8");
check("a result is used only if it is exactly the asked kind and really smaller", source.includes("if (!blob || blob.type !== target || blob.size === 0 || blob.size >= file.size) return file;"));
check("any failure returns the original (the upload never breaks because of shrinking)", /\} catch \{ return file; \}/.test(source) && source.includes('imageOrientation: "from-image"'));
check("nothing is sent anywhere by the shrinker", !/fetch\(|supabase|XMLHttpRequest|https?:\/\//.test(source));

const manager = fs.readFileSync("src/components/ProductImageManager.tsx", "utf8");
const upload = manager.slice(manager.indexOf("async function uploadFiles"), manager.indexOf("} finally {", manager.indexOf("async function uploadFiles")));
check("every picked photo goes through the shrinker before anything is uploaded", upload.includes("for (const original of selectedFiles) preparedFiles.push(await shrinkPhoto(original));") && upload.indexOf("shrinkPhoto(original)") < upload.indexOf("authorizeStorageUpload("));
check("the upload, its size check and the size told to the server all use the smaller file", upload.includes("for (const file of preparedFiles) {") && !/for \(const file of selectedFiles\)/.test(upload) && upload.includes("preparedFiles.some((file) => file.size > maxFileSize)") && /authorizeStorageUpload\(storageClient, bucketName, filePath, file\)/.test(upload) && /\.upload\(filePath, file, \{/.test(upload));
check("the stored size limit is unchanged (8 MB) and a refused batch frees the page again", manager.includes("const maxFileSize = 8 * 1024 * 1024;") && /still too large after it was made smaller\."\);\s*setBusy\(false\);\s*return;/.test(upload));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll photo shrink checks passed (offline).");
process.exit(failures ? 1 : 0);
