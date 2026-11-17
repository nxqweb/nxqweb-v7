// Makes a phone photo a sensible size before it is uploaded. A modern phone photo is 3 to 12 MB and 4000+ pixels wide; a store page
// shows it at a few hundred pixels. Uploading the original made uploads slow or refused ("up to 8 MB"), and made every shopper's phone
// download the full picture. Shrinking happens in the owner's browser; nothing is sent anywhere else.
// Safety rules: any failure, an animated GIF, an unknown type, or a result that is not smaller returns the ORIGINAL file untouched.

export const shrinkMaxSide = 1600; // longest side in pixels: sharp on a large phone and a product page, small to download
export const shrinkSkipBelowBytes = 500 * 1024; // already small: leave it alone
export const shrinkJpegQuality = 0.85;

export type ShrinkPlan = { width: number; height: number; resize: boolean };

// The new size: the longest side becomes at most maxSide, the shape is kept, and a picture is never enlarged.
export function shrinkPlan(width: number, height: number, maxSide = shrinkMaxSide): ShrinkPlan | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || !Number.isFinite(maxSide) || maxSide < 1) return null;
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width: Math.round(width), height: Math.round(height), resize: false };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resize: true };
}

// Which pictures are worth shrinking, and what they become. JPEG stays JPEG. PNG stays PNG (it may have see-through parts that JPEG
// cannot keep). WEBP becomes JPEG only when the browser cannot write WEBP, which is decided at run time. GIF is never touched (animation).
export function shrinkTarget(type: string, size: number): "image/jpeg" | "image/png" | "image/webp" | null {
  if (!Number.isFinite(size) || size <= shrinkSkipBelowBytes) return null;
  if (type === "image/jpeg") return "image/jpeg";
  if (type === "image/png") return "image/png";
  if (type === "image/webp") return "image/webp";
  return null;
}

// The file name with the extension that matches what the picture now is.
export function shrunkName(name: string, type: string): string {
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const base = (name || "photo").replace(/\.[A-Za-z0-9]{1,5}$/, "") || "photo";
  return `${base}.${extension}`;
}

// Returns a smaller copy of the photo, or the original file when shrinking is not possible or not worth it. Never throws.
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const target = shrinkTarget(file.type, file.size);
    if (!target || typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const plan = shrinkPlan(bitmap.width, bitmap.height);
      if (!plan) return file;
      const canvas = document.createElement("canvas");
      canvas.width = plan.width; canvas.height = plan.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, target, target === "image/png" ? undefined : shrinkJpegQuality));
      // A browser that cannot write the asked type silently writes PNG instead: only accept exactly what was asked for.
      if (!blob || blob.type !== target || blob.size === 0 || blob.size >= file.size) return file;
      return new File([blob], shrunkName(file.name, target), { type: target, lastModified: file.lastModified });
    } finally { bitmap.close?.(); }
  } catch { return file; }
}
