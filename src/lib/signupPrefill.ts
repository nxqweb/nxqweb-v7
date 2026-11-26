// The signup page stores what the client typed in their account data. The website setup sheet used to start empty, so clients
// typed the same things twice. These helpers turn those saved answers into starting values (only text, trimmed, never overwriting).
export type SignupPrefill = { services: string; locations: string; businessEmail: string; industry: string; businessPhone: string };

function text(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function signupPrefillForSetup(metadata: unknown, email: unknown): SignupPrefill {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const answers = meta.intake_family_answers && typeof meta.intake_family_answers === "object"
    ? (meta.intake_family_answers as Record<string, unknown>)
    : {};
  return {
    services: text(answers.services) || text(meta.intake_family_details),
    locations: text(meta.intake_service_area, 500),
    businessEmail: text(email, 320),
    industry: text(meta.intake_industry, 120),
    businessPhone: text(meta.intake_phone, 40),
  };
}
