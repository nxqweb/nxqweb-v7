const asText = (value) => typeof value === "string" ? value.trim() : "";

function factualSourceText(input) {
  const services = Array.isArray(input?.services) ? input.services.map(asText) : [];
  return [
    asText(input?.business_name),
    asText(input?.business_type),
    asText(input?.service_area),
    ...services,
    asText(input?.goals),
  ].filter(Boolean).join("\n").toLowerCase();
}

function claimBearingText(strategy) {
  const hero = strategy?.hero && typeof strategy.hero === "object" ? strategy.hero : {};
  const seo = strategy?.seo && typeof strategy.seo === "object" ? strategy.seo : {};
  const serviceDescriptions = Array.isArray(strategy?.service_descriptions)
    ? strategy.service_descriptions.map((item) => asText(item?.description))
    : [];
  const trustPoints = Array.isArray(strategy?.trust_points) ? strategy.trust_points.map(asText) : [];
  const seoKeywords = Array.isArray(seo?.keywords) ? seo.keywords.map(asText) : [];

  return [
    asText(strategy?.positioning),
    asText(strategy?.value_proposition),
    asText(hero?.eyebrow),
    asText(hero?.headline),
    asText(hero?.subheadline),
    ...serviceDescriptions,
    ...trustPoints,
    asText(strategy?.about_summary),
    asText(seo?.title),
    asText(seo?.description),
    ...seoKeywords,
  ].filter(Boolean).join("\n").toLowerCase();
}

export const unsupportedMarketingClaimRules = Object.freeze([
  ["licensing", /\blicen[cs](?:e|ed|ing|ure)?\b/i, /\blicen[cs](?:e|ed|ing|ure)?\b/i],
  ["insurance", /\binsur(?:ed|ance)\b/i, /\binsur(?:ed|ance)\b/i],
  ["certification or bonding", /\b(?:certif(?:ied|ication)|bonded)\b/i, /\b(?:certif(?:ied|ication)|bonded)\b/i],
  ["awards or ratings", /\b(?:award(?:ed|s|[- ]winning)?|top[- ]rated|five[- ]star|5[- ]star|#1)\b/i, /\b(?:award(?:ed|s|[- ]winning)?|top[- ]rated|five[- ]star|5[- ]star|#1)\b/i],
  ["years or experience", /\b(?:\d+\+?\s+years?|years? of experience|experienced)\b/i, /\b(?:\d+\+?\s+years?|years? of experience|experienced)\b/i],
  ["24/7 availability", /\b(?:24\s*\/\s*7|24[- ]hour|around[- ]the[- ]clock)\b/i, /\b(?:24\s*\/\s*7|24[- ]hour|around[- ]the[- ]clock)\b/i],
  ["specific response time", /\b(?:same[- ]day|within\s+\d+\s+(?:minutes?|hours?|days?))\b/i, /\b(?:same[- ]day|within\s+\d+\s+(?:minutes?|hours?|days?))\b/i],
  ["free offer", /\bfree\s+(?:quotes?|estimates?|consultations?|inspections?|assessments?)\b/i, /\bfree\s+(?:quotes?|estimates?|consultations?|inspections?|assessments?)\b/i],
  ["guarantee", /\bguarantee(?:d|s)?\b/i, /\bguarantee(?:d|s)?\b/i],
  ["environmental claim", /\b(?:eco[- ]friendly|eco[- ]conscious|environmentally\s+(?:friendly|responsible)|sustainable)\b/i, /\b(?:eco[- ]friendly|eco[- ]conscious|environmentally\s+(?:friendly|responsible)|sustainable)\b/i],
  ["trust or reliability claim", /\b(?:trusted|trustworthy|reliable|dependable)\b/i, /\b(?:trusted|trustworthy|reliable|dependable)\b/i],
  ["expertise or qualification claim", /\b(?:expert|experts|expertise|skilled|professional|professionals)\b/i, /\b(?:expert|experts|expertise|skilled|professional|professionals)\b/i],
  ["customer satisfaction claim", /\b(?:customer satisfaction|satisfied customers?|customer[- ]approved)\b/i, /\b(?:customer satisfaction|satisfied customers?|customer[- ]approved)\b/i],
  ["market leadership claim", /\b(?:best|leading|leader|premier)\b/i, /\b(?:best|leading|leader|premier)\b/i],
  ["speed or responsiveness claim", /\b(?:fast|rapid|timely|prompt|responsive)\b/i, /\b(?:fast|rapid|timely|prompt|responsive)\b/i],
  ["safety claim", /\b(?:safe|safety|safety[- ]minded)\b/i, /\b(?:safe|safety|safety[- ]minded)\b/i],
  ["quality claim", /\b(?:quality|high[- ]quality)\b/i, /\b(?:quality|high[- ]quality)\b/i],
  ["premium business claim", /\bpremium\b/i, /\bpremium\b/i],
]);

export function findUnsupportedMarketingClaims(strategy, input) {
  const source = factualSourceText(input || {});
  const output = claimBearingText(strategy || {});
  return unsupportedMarketingClaimRules
    .filter(([, claimPattern, supportPattern]) => claimPattern.test(output) && !supportPattern.test(source))
    .map(([label]) => label);
}

export function assertGroundedMarketingClaims(strategy, input) {
  const unsupported = findUnsupportedMarketingClaims(strategy, input);
  if (unsupported.length > 0) {
    throw new Error(`AI build-plan contains unsupported marketing claims: ${unsupported.join(", ")}.`);
  }
  return true;
}
