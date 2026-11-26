// Analytics stores WHICH page was viewed, never what was in the address bar after it. Query strings and fragments can carry personal data
// (emails, names, tokens, campaign ids), so only the path survives. Applied again at ingest (defence in depth) because older generated
// sites ship the previous script that also sent window.location.search.
export function pagePathOnly(value: unknown, max = 500): string {
  if (typeof value !== "string") return "/";
  let path = value.trim();
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  // A full URL (scheme + host) is reduced to its path as well.
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  path = path.slice(0, max);
  if (!path.startsWith("/")) path = `/${path}`;
  return path || "/";
}
