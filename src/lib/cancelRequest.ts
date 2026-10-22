// "Cancel my plan" from the client's billing page. It does NOT cancel anything by itself: it sends the NXQX team a labelled portal message (no new database
// table, same path as "Report a problem"), and the team confirms with the client. The page says so in plain words, so nobody thinks a click ended their plan.
export const cancelReasonMax = 600;

export type CancelCheck = { ok: true; message: string } | { ok: false; error: string };

export function buildCancelRequest(reason: string): CancelCheck {
  const text = String(reason ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length > cancelReasonMax) return { ok: false, error: `Please keep your reason under ${cancelReasonMax} characters.` };
  // A reason is optional, but it can never start a line that looks like one of our own labels.
  const safe = text.replace(/\[(Cancellation request|Problem report)\]/gi, "").replace(/^\s*(\w[\w ]{0,30}):/gm, "- $1:");
  return { ok: true, message: `[Cancellation request] I would like to cancel my plan.${safe ? `\n\nReason (optional): ${safe}` : ""}` };
}
