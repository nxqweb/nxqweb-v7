// "Report a problem" from inside the client portal. The report travels as a normal portal message (so no new database table is needed) with a
// clear [Problem report] label, the page the client was on and the screen size, so the team can reproduce it. Only the page PATH is included, never
// the query string or hash (those can hold one-time sign-in codes), and never anything the client did not type or choose.
export const problemCategories = [
  { value: "broken", label: "Something is broken" },
  { value: "confusing", label: "Something is confusing" },
  { value: "idea", label: "I have an idea" },
  { value: "other", label: "Something else" },
] as const;
export type ProblemCategory = (typeof problemCategories)[number]["value"];

export const problemLimits = { min: 10, max: 1200 } as const;

export type ProblemInput = { category: string; text: string; path: string; width: number; height: number };
export type ProblemCheck = { ok: true; message: string } | { ok: false; error: string };

export function safePath(path: string): string {
  const only = String(path || "").split(/[?#]/)[0];
  return /^\/[A-Za-z0-9/_\-.]*$/.test(only) && !only.includes("//") && only.length <= 120 ? only : "/";
}

export function buildProblemReport(input: ProblemInput): ProblemCheck {
  const text = input.text.replace(/\r\n/g, "\n").trim();
  const category = problemCategories.find((c) => c.value === input.category);
  if (!category) return { ok: false, error: "Please choose what kind of report this is." };
  if (text.length < problemLimits.min) return { ok: false, error: "Please tell us a little more (at least a short sentence) so we can help." };
  if (text.length > problemLimits.max) return { ok: false, error: `Please keep it under ${problemLimits.max} characters.` };
  const size = Number.isFinite(input.width) && Number.isFinite(input.height) ? `${Math.round(input.width)}x${Math.round(input.height)}` : "unknown";
  return { ok: true, message: `[Problem report] ${category.label}\nPage: ${safePath(input.path)}\nScreen: ${size}\n\n${text}` };
}
