export const appConfig = {
  companyName: import.meta.env.VITE_COMPANY_NAME || "NXQX",
  productName: import.meta.env.VITE_PRODUCT_NAME || "NXQ-Web",
  appName: import.meta.env.VITE_APP_NAME || import.meta.env.VITE_PRODUCT_NAME || "NXQ-Web",
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || "websitedesignercontact@protonmail.com",
  appEnv: import.meta.env.VITE_APP_ENV || "local",
  publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL || "http://localhost:5173",
  ownerPortalUrl: import.meta.env.VITE_OWNER_PORTAL_URL || "http://localhost:5173/owner",
  clientPortalUrl: import.meta.env.VITE_CLIENT_PORTAL_URL || "http://localhost:5173/client",
};

export const clientDomainPolicy = {
  ownership: "client_owned" as const,
  summary: "Clients purchase, own, and renew their own domains. NXQ-Web only provides connection instructions, verifies DNS, and monitors SSL.",
};
