// "Our work" photos for the client site: which uploaded photos may be published, how they are named inside the site repo, and the gallery block of site.config.js.
// Pure functions (no network). The builder (build-business-website) downloads the files; the database function get_site_photos_for_build only ever returns photos
// whose malware scan came back clean AND released. Every rule here is a second line of defence, tested offline in scripts/test-site-photos.mjs.

export const MAX_GALLERY_PHOTOS = 12;
// Photos are shrunk in the browser before upload, so a published photo above this is unusual; it is skipped (and reported) instead of risking the worker's memory.
export const MAX_PUBLISH_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });

// What the bytes really are, not what the file claims to be. A mismatch means the file is skipped.
export function imageKindFromBytes(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return riff && webp ? "image/webp" : null;
}

// Plain one-line text for alt text and captions: no markup characters, no control characters, at most 160 characters.
export function cleanPhotoText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

// Rows come from get_site_photos_for_build (already clean + released). Only 'work' photos go in the gallery; wrong types and oversize files are skipped with a reason.
export function selectGalleryPhotos(rows) {
  const selected = [];
  const skipped = [];
  const list = Array.isArray(rows) ? rows : [];
  const work = list.filter((row) => row && row.role === "work")
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  for (const row of work) {
    const type = typeof row.file_type === "string" ? row.file_type.toLowerCase() : "";
    if (!IMAGE_TYPES[type]) { skipped.push({ file_id: row.file_id, reason: "not a JPG, PNG or WebP" }); continue; }
    if (typeof row.storage_path !== "string" || !row.storage_path || row.bucket_id !== "client-files") { skipped.push({ file_id: row.file_id, reason: "not in the client files bucket" }); continue; }
    if (Number(row.file_size) > MAX_PUBLISH_BYTES) { skipped.push({ file_id: row.file_id, reason: "larger than 4 MB" }); continue; }
    if (typeof row.content_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.content_sha256.toLowerCase())) { skipped.push({ file_id: row.file_id, reason: "the safety check did not record a fingerprint" }); continue; }
    if (selected.length >= MAX_GALLERY_PHOTOS) { skipped.push({ file_id: row.file_id, reason: "more than 12 photos" }); continue; }
    selected.push(row);
  }
  return { selected, skipped };
}

// Names inside the site repo are chosen by us, never by the client: work-01.jpg, work-02.png ...
export function galleryFileName(index, mimeType) {
  const extension = IMAGE_TYPES[mimeType];
  if (!extension || !Number.isInteger(index) || index < 0 || index >= MAX_GALLERY_PHOTOS) throw new Error("Unsupported gallery photo.");
  return `work-${String(index + 1).padStart(2, "0")}.${extension}`;
}

// published: [{ name, alt, caption }] in display order. Returns null when there is nothing to show (the template then hides the section).
export function buildGalleryConfig(published) {
  const items = (Array.isArray(published) ? published : [])
    .filter((item) => item && /^work-\d{2}\.(?:jpg|png|webp)$/.test(item.name))
    .slice(0, MAX_GALLERY_PHOTOS)
    .map((item) => {
      const entry = { src: `./gallery/${item.name}`, alt: cleanPhotoText(item.alt) };
      const caption = cleanPhotoText(item.caption);
      if (caption) entry.caption = caption;
      return entry;
    });
  if (items.length === 0) return null;
  return { label: "Our work", title: "Recent work", intro: "", items };
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

// The database function may not exist yet (migration not applied): that is "no photos", not a failed build.
export function isMissingPhotoFunction(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();
  // Only "this exact function is not there". A bare 42883 ("undefined function") could be a bug INSIDE the function once it exists, which must fail the build, not hide the photos.
  return code === "PGRST202" || (message.includes("get_site_photos_for_build") && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find")));
}

// The safety scan records the SHA-256 of the exact bytes it checked. A downloaded file whose hash differs was changed after the check and is never published.
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Files this feature put in the client's repo (gallery/work-NN.ext) that the current build did not write again: a removed photo, a photo whose scan was later flagged,
// or a slot whose type changed (jpg -> png). They must be deleted, or an old, guessable URL would keep serving a photo the client no longer wants public.
// Anything else in the folder is never touched.
export function staleGalleryFiles(existingNames, keepNames) {
  const keep = new Set(Array.isArray(keepNames) ? keepNames : []);
  return (Array.isArray(existingNames) ? existingNames : []).filter((name) => typeof name === "string" && /^work-\d{2}\.(?:jpg|png|webp)$/.test(name) && !keep.has(name));
}
