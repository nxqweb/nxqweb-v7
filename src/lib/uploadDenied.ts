// Plain words for the reasons the server can refuse a file upload (the database function nxq_authorize_storage_upload).
// The page used to show one generic line for every refusal, so a client could not tell "your account is not ready" from "that file is wrong".
// Only the server's own known sentences are translated; anything else returns null and the page keeps its generic message.
// The raw server sentence is never shown to the client.

const reasons: Array<[RegExp, string]> = [
  [/Upload denied by account, tier, or billing state/i, "Uploads are not switched on for your account yet. Your account needs to be approved with billing active. Please message NXQX and we will sort it out."],
  [/Commerce storage requires a Commerce subscription/i, "Product photos are part of the Commerce plan, and this account is not on it yet. Please message NXQX."],
  [/Upload denied by monthly storage limit/i, "You have used all the photo space in your plan this month. Remove a photo you no longer need, or message NXQX about more space."],
  [/Upload size or type is invalid/i, "That photo was not accepted. Use a JPG, PNG, WEBP or GIF picture under 8 MB."],
  [/Authenticated client access required/i, "Please sign in again, then try the upload."],
];

export function uploadDeniedMessage(reason: unknown): string | null {
  const text = typeof reason === "string" ? reason.slice(0, 400) : "";
  if (!text) return null;
  for (const [pattern, message] of reasons) if (pattern.test(text)) return message;
  return null;
}

// Works on whatever was thrown: our own refusal error (carries the server's sentence in `reason`) or anything else.
export function uploadDeniedFromError(error: unknown): string | null {
  if (error && typeof error === "object" && "reason" in error) return uploadDeniedMessage((error as { reason?: unknown }).reason);
  return null;
}
