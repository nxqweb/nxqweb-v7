const blockedHostSuffixes = [".localhost", ".local", ".internal", ".home", ".lan"];
const blockedExactHosts = new Set([
  "localhost",
  "0.0.0.0",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data.ec2.internal",
  "169.254.169.254",
  "100.100.100.200",
]);

function parseIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return null;
  return octets;
}

function isPrivateIpv4(octets: number[]) {
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isUnsafeHostname(rawHostname: string) {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || blockedExactHosts.has(hostname) || blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix))) return true;

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return isPrivateIpv4(ipv4);

  if (hostname.includes(":")) {
    const compact = hostname.replace(/^0+(?=[0-9a-f])/g, "");
    return hostname === "::1"
      || hostname === "::"
      || compact.startsWith("fc")
      || compact.startsWith("fd")
      || /^fe[89ab]/.test(compact)
      || hostname.startsWith("::ffff:127.")
      || hostname.startsWith("::ffff:10.")
      || hostname.startsWith("::ffff:169.254.")
      || hostname.startsWith("::ffff:192.168.");
  }

  return false;
}

export function requirePublicHttpsUrl(value: string, label = "Outbound URL") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain embedded credentials.`);
  if (url.port && url.port !== "443") throw new Error(`${label} must use the standard HTTPS port.`);
  if (isUnsafeHostname(url.hostname)) throw new Error(`${label} must resolve through a public hostname.`);
  return url;
}

export function validatedRedirectTarget(location: string, currentUrl: URL, label = "Redirect target") {
  const next = new URL(location, currentUrl);
  return requirePublicHttpsUrl(next.toString(), label);
}
