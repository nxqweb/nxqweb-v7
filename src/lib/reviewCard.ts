// The words on a client's review card and the ready-to-send messages. Plain text only (the page shows it as text, never as HTML).
// Wording rules (Google and most review sites forbid paying for reviews or only asking happy customers): ask everyone, offer nothing in return,
// and never promise anything about rankings or results.

export type ReviewTexts = {
  heading: string;
  line: string;
  scanLabel: string;
  smsText: string;
  emailSubject: string;
  emailBody: string;
};

const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

export function buildReviewTexts(businessName: string, url: string): ReviewTexts {
  const name = tidy(businessName);
  const thanks = name ? `Thanks for choosing ${name}!` : "Thanks for choosing us!";
  return {
    heading: name ? `Thanks for choosing ${name}` : "Thanks for choosing us",
    line: "If you have a minute, a quick review helps other people find us. It means a lot.",
    scanLabel: "Scan to leave a review",
    smsText: `${thanks} If you have a minute, would you leave us a quick review? ${url}`,
    emailSubject: name ? `Would you review ${name}?` : "Would you leave us a review?",
    emailBody: `Hi,\n\n${thanks} If you have a minute, a short review helps other people find us. You can leave one here:\n${url}\n\nThank you!${name ? `\n${name}` : ""}`,
  };
}

// Shown under the card. This is the honest part of the feature: reviews are only worth having if they are real and asked for fairly.
export const reviewFairnessNotes = [
  "Ask every customer, not only the ones who seem happy. Review sites remove businesses that pick and choose.",
  "Never offer a discount, gift or anything else in exchange for a review.",
  "Reviews can help people choose you, but nobody can promise a higher ranking or more customers from them.",
] as const;
