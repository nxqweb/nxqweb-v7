from pathlib import Path

WORKER = Path('supabase/functions/provision-storefront/index.ts')
BUSINESS_WORKER = Path('supabase/functions/provision-project-infrastructure/index.ts')

KEY_HELPER = r'''function concatBytes(...parts: Uint8Array[]) {
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

function normalizeGithubPrivateKey(raw: string) {
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
'''

TOKEN_HELPER = r'''
function protectedTokenMatches(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(actual);
  const right = encoder.encode(expected);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}
'''


def ensure_key_normalization(path: Path, commerce: bool = False) -> None:
    source = path.read_text()
    marker = 'async function githubInstallationToken() {\n'
    if 'function normalizeGithubPrivateKey(' not in source:
        if marker not in source:
            raise SystemExit(f'{path}: GitHub token function marker missing; refusing ambiguous patch.')
        helper = KEY_HELPER + (TOKEN_HELPER if commerce else '') + '\n'
        source = source.replace(marker, helper + marker, 1)

    normalized = '  const privateKey = await importPKCS8(normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY")), "RS256");'
    if normalized not in source:
        if commerce:
            start = '  const privateKeyText = requiredSecret("GITHUB_APP_PRIVATE_KEY").replace('
            start_index = source.find(start)
            if start_index < 0:
                raise SystemExit(f'{path}: Commerce private-key line missing; refusing ambiguous patch.')
            end_marker = '  const now = Math.floor(Date.now() / 1000);'
            end_index = source.find(end_marker, start_index)
            if end_index < 0:
                raise SystemExit(f'{path}: Commerce private-key block end missing; refusing ambiguous patch.')
            source = source[:start_index] + normalized + '\n' + source[end_index:]
        else:
            candidates = [
                '  const privateKey = await importPKCS8(requiredSecret("GITHUB_APP_PRIVATE_KEY").replace(/\\\\n/g, "\\n"), "RS256");',
                '  const privateKey = await importPKCS8(requiredSecret("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"), "RS256");',
            ]
            for candidate in candidates:
                if candidate in source:
                    source = source.replace(candidate, normalized, 1)
                    break
            else:
                raise SystemExit(f'{path}: Business private-key line missing; refusing ambiguous patch.')

    path.write_text(source)


def ensure_commerce_worker_auth() -> None:
    source = WORKER.read_text()
    if 'function protectedTokenMatches(' not in source:
        marker = 'async function githubInstallationToken() {\n'
        if marker not in source:
            raise SystemExit('Commerce token helper marker missing; refusing ambiguous patch.')
        source = source.replace(marker, TOKEN_HELPER + '\n' + marker, 1)

    old_auth = '''  const authorization = request.headers.get("Authorization") || "";

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) {
    return response({ error: "Owner access required." }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const ownerAccess = await admin
    .from("owner_users")
    .select("id,role")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (ownerAccess.error || !ownerAccess.data) {
    return response({ error: "Owner access required." }, 403);
  }
'''
    new_auth = '''  const authorization = request.headers.get("Authorization") || "";
  const suppliedWorkerToken = request.headers.get("x-nxq-worker-token")?.trim() || "";
  const expectedWorkerToken = Deno.env.get("NXQ_AUTOMATION_WORKER_TOKEN")?.trim() || "";
  const workerAuthorized = protectedTokenMatches(suppliedWorkerToken, expectedWorkerToken);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  if (!workerAuthorized) {
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) {
      return response({ error: "Owner access or protected worker token required." }, 403);
    }

    const ownerAccess = await admin
      .from("owner_users")
      .select("id,role")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    if (ownerAccess.error || !ownerAccess.data) {
      return response({ error: "Owner access required." }, 403);
    }
  }
'''

    if old_auth in source:
        source = source.replace(old_auth, new_auth, 1)
    elif 'const workerAuthorized = protectedTokenMatches' not in source:
        raise SystemExit('Commerce owner-auth block missing; refusing ambiguous patch.')

    source = source.replace(
        '"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",',
        '"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nxq-worker-token",',
        1,
    )
    WORKER.write_text(source)


ensure_key_normalization(BUSINESS_WORKER, commerce=False)
ensure_key_normalization(WORKER, commerce=True)
ensure_commerce_worker_auth()

result = WORKER.read_text()
required = [
    'normalizeGithubPrivateKey(requiredSecret("GITHUB_APP_PRIVATE_KEY"))',
    'x-nxq-worker-token',
    'workerAuthorized = protectedTokenMatches',
]
missing = [needle for needle in required if needle not in result]
if missing:
    raise SystemExit(f'Commerce hardening verification failed: {missing}')

print('Commerce worker auth and GitHub App key hardening patch applied safely.')
