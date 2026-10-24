// "Cancel my plan" from the client's billing page. It does NOT cancel anything by itself: it sends the NXQX team a labelled portal message (no new database
// table, same path as "Report a problem"), and the team confirms with the client. The page says so in plain words, so nobody thinks a click ended their plan.
export const cancelReasonMax = 600;

export type CancelCheck = { ok: true; message: string } | { ok: false; error: string };

export function buildCancelRequest(reason: string): CancelCheck {
  const text = String(reason ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length > cancelReasonMax) return { ok: false, error: `Please keep your reason under ${cancelReasonMax} characters.` };
  // A reason is optional, but it can never look like one of our own labels or markers: square brackets become round ones (so removing a marker can never
  // glue a new one together) and every line is quoted, so no line of the client's text can start with a label.
  const safe = text.replace(/[[\]]/g, (bracket) => (bracket === "[" ? "(" : ")")).split("\n").map((line) => `> ${line}`).join("\n");
  return { ok: true, message: `[Cancellation request] I would like to cancel my plan.${text ? `\n\nReason (optional):\n${safe}` : ""}` };
}
