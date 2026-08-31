import fs from "node:fs";
import { pathToFileURL } from "node:url";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function serializeDotenvValue(value) {
  if (typeof value !== "string" || !value) {
    throw new Error("Protected staging worker token is unavailable.");
  }
  if (value !== value.trim() || CONTROL_CHARACTER.test(value)) {
    throw new Error("Protected staging worker token is not safe for an HTTP authentication header.");
  }

  // Unquoted dotenv values preserve every supported header character except
  // `#`, which starts a comment. A value already wrapped by the same quote
  // character would be unwrapped by dotenv, so quote it with another delimiter.
  const implicitlyQuoted = ["'", '"', "`"].some((quote) => value.startsWith(quote) && value.endsWith(quote));
  if (!value.includes("#") && !implicitlyQuoted) return value;

  // dotenv preserves the contents of single-quoted and backtick-quoted values
  // byte-for-byte. Double quotes are the final option because dotenv expands
  // literal `\\n` and `\\r` sequences inside them.
  // A trailing backslash would escape the closing delimiter in dotenv syntax.
  if (!value.endsWith("\\") && !value.includes("'")) return `'${value}'`;
  if (!value.endsWith("\\") && !value.includes("`")) return `\`${value}\``;
  if (!value.endsWith("\\") && !value.includes('"') && !value.includes("\\n") && !value.includes("\\r")) return `"${value}"`;

  throw new Error("Protected staging worker token cannot be represented losslessly in dotenv syntax.");
}

export function writeRuntimeGuardsEnv(destination, workerToken) {
  if (typeof destination !== "string" || !destination) {
    throw new Error("A protected runtime-guards destination is required.");
  }
  const serializedToken = serializeDotenvValue(workerToken);
  const content = [
    "NXQ_RUNTIME_ENVIRONMENT=staging",
    `NXQ_AUTOMATION_WORKER_TOKEN=${serializedToken}`,
    "",
  ].join("\n");
  fs.writeFileSync(destination, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    writeRuntimeGuardsEnv(process.argv[2], process.env.NXQ_AUTOMATION_WORKER_TOKEN);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Protected staging runtime guards could not be serialized.";
    console.error(message);
    process.exit(1);
  }
}
