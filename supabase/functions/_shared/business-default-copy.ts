// Default website copy used when a client's build plan has no copy of its own, for ANY kind of business. It must stay free of every claim the
// grounding validator in _shared/ai-grounding.mjs rejects (trusted, reliable, professional, premium, fast, safe, quality, ...): a business never
// told us it is any of those. scripts/test-business-default-copy.mjs enforces this against the real validator.
export const defaultEyebrow = (serviceArea: string) => (serviceArea ? `Serving ${serviceArea}` : "Local business");
export const defaultHeadline = (businessName: string) => `${businessName}. Clear services. Simple next steps.`;
export const defaultSubheadline = (businessType: string) => `${businessType} services with clear communication and an easy way to get in touch.`;
export const defaultTrustHeading = "Clear information and simple next steps";
export const defaultTrustPoints = (serviceArea: string) => ["Clear communication", "Straightforward service information", serviceArea ? `Local to ${serviceArea}` : "Local support", "Simple next steps"];
export const defaultAboutHeading = (businessName: string) => `About ${businessName}`;
export const defaultAboutBody = (businessName: string, businessType: string) => `${businessName} provides ${businessType} services. This website explains what the business offers and makes it easy to get in touch.`;
export const defaultServiceDescription = (service: string, businessType: string) => `${service} for local customers${businessType ? ` from a ${businessType} business` : ""}, with clear communication and a straightforward path to getting started.`;
export const defaultFallbackServiceTitle = "Our Services";
