export const appConfig = {
  appName: import.meta.env.VITE_APP_NAME || "NXQ Web V7",
  appEnv: import.meta.env.VITE_APP_ENV || "local",
  publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL || "http://localhost:5173",
  ownerPortalUrl: import.meta.env.VITE_OWNER_PORTAL_URL || "http://localhost:5173/owner",
  clientPortalUrl: import.meta.env.VITE_CLIENT_PORTAL_URL || "http://localhost:5173/client",
};
