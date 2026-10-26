// How a multi-word answer is written into the website setup report. The database copies the report into the client's intake record with a SINGLE-LINE reader
// (extract_setup_report_value, migration 103): it only finds "Label: value" on one line. The form used to write the style answer as "Style direction:" followed by the text on
// the NEXT line, so the intake record never got a style and the portal kept asking for `desired_style` (found in the 2026-10-25 live tier test). The portal, the build planner
// and the owner card all read the inline form too (they already do for "Business phone: ..."). An empty answer keeps the two-line "Not provided" form on purpose: the database
// only turns "Not provided" into "missing" for the phone, so an inline "Not provided" would hide a genuinely missing style.
export function inlineReportLines(label: string, value: string): string[] {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!flat || /^not provided$/i.test(flat)) return [`${label}:`, "Not provided"];
  return [`${label}: ${flat}`];
}
