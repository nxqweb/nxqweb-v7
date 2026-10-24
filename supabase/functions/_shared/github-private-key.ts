function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function derLength(length: number) {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derWrap(tag: number, body: Uint8Array) {
  return concatBytes(Uint8Array.of(tag), derLength(body.length), body);
}

function pemBodyBytes(pem: string) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToPem(label: string, bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  const lines = encoded.match(/.{1,64}/g)?.join("\n") || encoded;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

export function normalizeGithubPrivateKey(raw: string) {
  let pem = raw.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  pem = pem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();

  if (pem.includes("-----BEGIN PRIVATE KEY-----")) return pem;
  if (!pem.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be a PKCS#8 or PKCS#1 RSA PEM private key.");
  }

  const pkcs1 = pemBodyBytes(pem);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  const privateKeyOctet = derWrap(0x04, pkcs1);
  const pkcs8 = derWrap(0x30, concatBytes(version, rsaAlgorithm, privateKeyOctet));
  return bytesToPem("PRIVATE KEY", pkcs8);
}
