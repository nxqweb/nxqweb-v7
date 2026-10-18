// Website photos in the client's brief ("Photos for your website"): the pure rules (what can be chosen, how big photos are shrunk, how scan results are
// worded) and the types the panel needs. The three database calls are a draft gateway (docs/drafts/ui/sitePhotosSupabaseGateway.ts) until the
// photo migration is promoted; uploading itself uses functions that already exist (src/lib/sitePhotoUpload.ts).

export type PhotoRole = "work" | "site";

export type SitePhoto = {
  fileId: string;
  fileName: string;
  role: PhotoRole;
  altText: string;
  caption: string;
  sortOrder: number;
  scanStatus: string;
  released: boolean;
};

export type SitePhotosGateway = {
  list(): Promise<SitePhoto[]>;
  save(input: { fileId: string; role: PhotoRole; altText: string; caption: string; sortOrder: number }): Promise<void>;
  remove(fileId: string): Promise<void>;
};

export type PhotoUploader = (file: File) => Promise<{ ok: true; fileId: string } | { ok: false; message: string }>;

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PICK_BYTES = 25 * 1024 * 1024;
export const MAX_WORK_PHOTOS = 12;
export const MAX_ALL_PHOTOS = 24;
export const MAX_EDGE = 2000;
const KEEP_AS_IS_BYTES = 1_500_000;

export const roleLabels: Record<PhotoRole, string> = { work: "Photos of my work (shown on my website)", site: "Other photos for my website team" };

// Why a picked file cannot be used, in plain words (empty string = fine).
export function photoProblem(file: { name: string; type: string; size: number }) {
  if (!PHOTO_TYPES.includes((file.type || "").toLowerCase())) {
    return `${file.name}: choose a JPG, PNG or WebP picture. On an iPhone, Settings > Camera > Formats > Most Compatible gives you JPG photos.`;
  }
  if (file.size < 1) return `${file.name}: this file is empty.`;
  if (file.size > MAX_PICK_BYTES) return `${file.name}: this picture is larger than 25 MB.`;
  return "";
}

// Plain-words scan state for the photo list.
export function scanLabel(photo: Pick<SitePhoto, "scanStatus" | "released">) {
  const status = photo.scanStatus.toLowerCase();
  if (status === "clean" && photo.released) return { text: "Ready", tone: "ok" as const };
  if (status === "infected" || status === "suspicious") return { text: "Could not be used (the safety check flagged it)", tone: "bad" as const };
  if (status === "error" || status === "skipped") return { text: "Could not be checked yet. NXQX will look at it.", tone: "bad" as const };
  return { text: "Being checked for safety. Photos show on your website only after this finishes.", tone: "wait" as const };
}

export function nextSortOrder(photos: SitePhoto[], role: PhotoRole) {
  const inRole = photos.filter((photo) => photo.role === role);
  return Math.min(999, inRole.reduce((max, photo) => Math.max(max, photo.sortOrder), 0) + 1);
}

// Room left before the database would refuse (12 in "my work", 24 in all).
export function roomFor(photos: SitePhoto[], role: PhotoRole) {
  const work = photos.filter((photo) => photo.role === "work").length;
  const all = photos.length;
  return Math.max(0, Math.min(role === "work" ? MAX_WORK_PHOTOS - work : MAX_ALL_PHOTOS, MAX_ALL_PHOTOS - all));
}

// Swap a photo with its neighbour inside its role; returns the two updated sort orders, or null at the ends.
export function moveWithinRole(photos: SitePhoto[], fileId: string, direction: -1 | 1) {
  const target = photos.find((photo) => photo.fileId === fileId);
  if (!target) return null;
  const inRole = photos.filter((photo) => photo.role === target.role).sort((a, b) => a.sortOrder - b.sortOrder);
  const index = inRole.findIndex((photo) => photo.fileId === fileId);
  const other = inRole[index + direction];
  if (!other) return null;
  // Positions are compared by index, not by the stored numbers, so equal or gappy numbers still swap cleanly.
  const first = Math.min(index, index + direction);
  return [
    { fileId: inRole[index].fileId, sortOrder: first + (direction === -1 ? 0 : 1) + 1 },
    { fileId: other.fileId, sortOrder: first + (direction === -1 ? 1 : 0) + 1 },
  ];
}

export function photoFromRow(row: unknown): SitePhoto | null {
  const value = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
  if (!value || typeof value.file_id !== "string" || (value.role !== "work" && value.role !== "site")) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    fileId: value.file_id,
    fileName: text(value.file_name, 255),
    role: value.role,
    altText: text(value.alt_text, 160),
    caption: text(value.caption, 160),
    sortOrder: Number.isFinite(Number(value.sort_order)) ? Math.max(0, Math.min(999, Number(value.sort_order))) : 0,
    scanStatus: text(value.scan_status, 30) || "pending",
    released: value.released === true,
  };
}

export function photosFromRows(rows: unknown): SitePhoto[] {
  return (Array.isArray(rows) ? rows : []).map(photoFromRow).filter((photo): photo is SitePhoto => photo !== null);
}

// Friendly version of the database's refusals; never shows internals.
export function photoErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/up to 12/i.test(message)) return "You can show up to 12 photos in Our work.";
  if (/up to 24/i.test(message)) return "You can keep up to 24 website photos.";
  if (/< or >|cannot contain the characters/i.test(message)) return "Photo descriptions cannot contain the characters < or >.";
  if (/Only JPG, PNG or WebP/i.test(message)) return "Only JPG, PNG or WebP pictures can be used on your website.";
  if (/does not allow website photos/i.test(message)) return "Photos cannot be added to this account right now.";
  return "That did not work. Nothing was changed; please try again.";
}

// Shrinks big photos in the browser (longest side 2000 px, JPEG) so uploads are fast and the website stays quick. Small photos are kept as they are.
// Returns the original file whenever shrinking is not possible, so a failure here never blocks the upload.
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    if (file.size <= KEEP_AS_IS_BYTES && file.type !== "image/png") return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= KEEP_AS_IS_BYTES) { bitmap.close(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); return file; }
    context.fillStyle = "#ffffff"; // transparent areas of a PNG become white instead of black
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
