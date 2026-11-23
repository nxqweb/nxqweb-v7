// Helpers for the client's own logo and background upload card (parked patch 10_store_media_frontend.patch; database draft 10).
// Pure text and number work only: nothing here calls the database or storage, so it is safe to live in the app before the backend exists.
import { storeLookFromRow } from "./storeBranding.ts";

export type MediaKind = "logo" | "background";
export type PictureKind = "png" | "jpeg" | "webp";
export type StoreMedia = { hasStorefront: boolean; clientId: string | null; logo: string | null; background: string | null; overlay: number; ownerLogo: boolean };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const extensionFor = (kind: PictureKind): "png" | "jpg" | "webp" => (kind === "jpeg" ? "jpg" : kind);

// The place a picture is stored: the client's own folder, branding subfolder. Same shape the database checks. Anything odd gives null (nothing is uploaded).
export function mediaFilePath(clientId: unknown, kind: unknown, ext: unknown, token: unknown): string | null {
  if (typeof clientId !== "string" || !uuid.test(clientId)) return null;
  if (kind !== "logo" && kind !== "background") return null;
  if (ext !== "png" && ext !== "jpg" && ext !== "jpeg" && ext !== "webp") return null;
  if (typeof token !== "string" || !/^[a-f0-9]{8,32}$/.test(token)) return null;
  return `${clientId}/branding/${kind}-${token}.${ext}`;
}

// What the database returned for the signed-in client, re-checked. Pictures that do not match the strict own-folder shape are ignored.
export function parseStoreMedia(raw: unknown): StoreMedia {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const look = storeLookFromRow({ logo: row.logo, background: row.background, background_overlay: row.background_overlay });
  return {
    hasStorefront: row.has_storefront === true,
    clientId: typeof row.client_id === "string" && uuid.test(row.client_id) ? row.client_id : null,
    logo: look?.logo && look.logo.startsWith("https://") ? look.logo : null,
    background: look?.background ?? null,
    overlay: look?.backgroundOverlay ?? 0,
    ownerLogo: row.owner_logo === true,
  };
}

// Plain words for what the server can say when saving. The server's own sentence is never shown as it is.
export function mediaSaveMessage(reason: unknown): string {
  const text = typeof reason === "string" ? reason : "";
  if (/Create your store first/i.test(text)) return "Create your store first, then add your logo and background.";
  if (/PNG, JPEG or WEBP/i.test(text) || /must be a file under/i.test(text)) return "That picture type is not accepted. Use a PNG, JPEG or WEBP picture.";
  if (/own store folder/i.test(text)) return "That picture did not upload to your own store folder. Please try again.";
  if (/Client workspace not found/i.test(text)) return "Please sign in again, then try once more.";
  return "Your picture was uploaded but could not be saved to your store this time. Please try again.";
}
