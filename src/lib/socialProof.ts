// Real, permissioned client results shown in the "Trusted by" strip on the public home page.
// RULE: add an entry only when the client has agreed in writing and the figure can be verified.
// While this list is empty the strip renders nothing, so no claim is ever invented.
export type ClientResult = {
  business: string; // display name the client approved
  headline: string; // the verified outcome, in the client's own approved words
  metric?: string; // optional verified figure, for example "+38% leads"
  period?: string; // optional time frame, for example "first 90 days"
};

export const clientResults: ClientResult[] = [];
