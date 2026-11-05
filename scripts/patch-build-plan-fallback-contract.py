from pathlib import Path

p = Path('supabase/functions/generate-business-build-plan/index.ts')
s = p.read_text()
start_marker = 'function stagingFallback(request: BuildPlanRequest) {'
end_marker = '\n\nDeno.serve(async (request) => {'
if start_marker not in s or end_marker not in s:
    raise SystemExit('stagingFallback markers missing; refusing ambiguous patch')
start = s.index(start_marker)
end = s.index(end_marker, start)
replacement = '''function stagingFallback(request: BuildPlanRequest) {
  const n = request.input.business_name;
  const t = request.input.business_type;
  const a = request.input.service_area;
  const services = request.contract.allowed_services;
  const pages = request.contract.allowed_pages;
  const style = request.input.desired_style.toLowerCase();
  const theme = style.includes("gold") ? "charcoal_gold"
    : style.includes("green") ? "forest_emerald"
    : style.includes("purple") || style.includes("violet") ? "royal_violet"
    : "midnight_blue";
  const clip = (value: string, max: number) => value.replace(/\\s+/g, " ").trim().slice(0, max).trim();
  const shortType = clip(t, 48) || "local service";
  const shortName = clip(n, 52) || "Local Business";
  const areaText = a ? clip(` across ${a}`, 110) : " in the local service area";

  return {
    schema_version: schemaVersion,
    request_fingerprint: request.request_fingerprint,
    confidence: 0.9,
    risk_flags: [],
    strategy: {
      positioning: clip(`${shortName} is positioned as a dependable professional ${shortType} provider focused on clear service information, responsive communication, and qualified local leads.`, 300),
      audiences: ["Local property owners", "Commercial property managers", "Customers needing prompt service"],
      value_proposition: clip(`${shortName} presents its approved services with a clear path to request help, emphasizing professional execution, responsive communication, and a polished customer experience.`, 320),
      voice: "Professional, confident, direct, trustworthy, and helpful without exaggerated claims.",
      hero: {
        eyebrow: clip(`${shortName} Professional Service`, 80),
        headline: clip(`${shortName} Professional Service You Can Reach Fast`, 110),
        subheadline: clip(`${shortName} makes it simple to understand available services, request a quote, and reach the team when timely professional help matters.`, 260),
      },
      service_descriptions: services.map((service) => ({
        service,
        description: clip(`${shortName} provides ${service} with a professional, safety-minded approach, clear communication, and an easy path for customers to request service.`, 280),
      })),
      trust_points: [
        "Clear and responsive customer communication",
        "Professional service planning and execution",
        "Simple quote and contact pathways",
      ],
      about_summary: clip(`${shortName} serves customers looking for dependable ${shortType} support${areaText}. The website should communicate services clearly, make inquiries easy to route, and reinforce a professional customer experience without unsupported claims.`, 600),
      seo: {
        title: clip(`${shortName} Professional Local Service`, 60),
        description: clip(`${shortName} provides professional ${shortType} service with clear information, responsive contact options, and an easy quote request process.`, 160),
        keywords: [shortType, ...services.slice(0, 4), "local professional service"].map((value) => clip(value, 80)).slice(0, 10),
      },
      page_strategy: pages.map((page) => ({
        page,
        objective: clip(`Give the ${page} page a focused customer objective grounded only in the approved intake and guide visitors toward the right next step.`, 240),
        sections: ["Page introduction", "Primary page content", "Supporting trust content", "Contact call to action"],
      })),
      design: {
        theme_key: request.contract.allowed_theme_keys.includes(theme) ? theme : request.contract.allowed_theme_keys[0],
        mood: "Premium, modern, polished, confident, high-contrast, and appropriate for a professional local-service business.",
        palette_guidance: ["Use a dark premium foundation", "Keep accent contrast strong and restrained", "Preserve excellent text readability"],
        typography_guidance: "Use large confident headings, readable body type, and a disciplined hierarchy that feels premium rather than flashy.",
        motion_guidance: "Use subtle purposeful transitions and restrained motion that supports clarity without distracting from calls to action.",
      },
    },
  };
}'''
s = s[:start] + replacement + s[end:]
p.write_text(s)
