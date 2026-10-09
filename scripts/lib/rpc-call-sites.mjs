// Shared source scanner for supabase `.rpc("name", { ... })` call sites.
// Used by scripts/validate-contract-rpc-call-arguments.mjs (static, against migration
// text) and scripts/test-local-full-schema.mjs (against a disposable database).
import fs from "node:fs";
import path from "node:path";

export function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

export function splitTop(text) {
  const parts = [];
  let depth = 0; let quote = null; let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { current += ch; if (ch === quote && text[i - 1] !== "\\") quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; current += ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function balancedEnd(text, openIndex, open = "(", close = ")") {
  let depth = 0; let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === quote && text[i - 1] !== "\\") quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function objectKeys(source) {
  const keys = [];
  for (const raw of splitTop(source.slice(1, -1))) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("...")) return null;
    const key = part.split(":", 1)[0].trim().replace(/^["']|["']$/g, "");
    if (!/^\w+$/.test(key)) return null;
    keys.push(key);
  }
  return keys;
}

/**
 * @returns {{ file: string, area: "src"|"edge", client: string, name: string, keys: string[]|null }[]}
 * `keys` is null when the arguments are not a literal object (cannot be checked statically).
 */
export function collectRpcCallSites(root) {
  const sites = [];
  const targets = [
    ["src", walk(path.join(root, "src"), [".ts", ".tsx"])],
    ["edge", walk(path.join(root, "supabase/functions"), [".ts"])],
  ];
  for (const [area, files] of targets) {
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const re = /(\w+)\s*\.rpc\(\s*["'](\w+)["']/g;
      let match;
      while ((match = re.exec(source))) {
        const rest = source.slice(match.index + match[0].length);
        let keys;
        if (/^\s*\)/.test(rest)) keys = [];
        else if (/^\s*,\s*\{/.test(rest)) {
          const open = match.index + match[0].length + rest.indexOf("{");
          const close = balancedEnd(source, open, "{", "}");
          keys = close === -1 ? null : objectKeys(source.slice(open, close + 1));
        } else keys = null;
        sites.push({ file: path.relative(root, file), area, client: match[1], name: match[2], keys });
      }
    }
  }
  return sites;
}
