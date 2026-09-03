import { lazy, Suspense } from "react";
import "./styles/nxq.css";
import "./styles/public-premium.css";
import "./styles/public-premium-wave.css";
import "./styles/portal-premium.css";
import "./styles/deployments.css";
import "./styles/plan-forms.css";
import { ClientPortalTopCards } from "./components/ClientPortalTopCards";
import { ClientPortalTutorialOverlay } from "./components/ClientPortalTutorialOverlay";
import { OwnerProtectedRoute } from "./components/OwnerProtectedRoute";

const named = <T extends Record<string, unknown>, K extends keyof T>(loader: () => Promise<T>, key: K) =>
  lazy(async () => ({ default: (await loader())[key] as React.ComponentType }));

const CheckEmail = named(() => import("./pages/CheckEmail"), "CheckEmail");
const ForgotPassword = named(() => import("./pages/ForgotPassword"), "ForgotPassword");
const ClientBillingStatus = named(() => import("./pages/ClientBillingStatus"), "ClientBillingStatus");
const ClientBusinessAnalytics = named(() => import("./pages/ClientBusinessAnalytics"), "ClientBusinessAnalytics");
const ClientBusinessChanges = named(() => import("./pages/ClientBusinessChanges"), "ClientBusinessChanges");
const ClientBusinessDashboard = named(() => import("./pages/ClientBusinessDashboard"), "ClientBusinessDashboard");
const ClientBusinessLeads = named(() => import("./pages/ClientBusinessLeads"), "ClientBusinessLeads");
const ClientBusinessLocations = named(() => import("./pages/ClientBusinessLocations"), "ClientBusinessLocations");
const ClientBusinessReports = named(() => import("./pages/ClientBusinessReports"), "ClientBusinessReports");
const ClientBusinessSeo = named(() => import("./pages/ClientBusinessSeo"), "ClientBusinessSeo");
const ClientCommerceCatalog = named(() => import("./pages/ClientCommerceCatalog"), "ClientCommerceCatalog");
const ClientCommerceCategories = named(() => import("./pages/ClientCommerceCategories"), "ClientCommerceCategories");
const ClientCommerceDashboard = named(() => import("./pages/ClientCommerceDashboard"), "ClientCommerceDashboard");
const ClientCommerceInventory = named(() => import("./pages/ClientCommerceInventory"), "ClientCommerceInventory");
const ClientCommerceLiveStore = named(() => import("./pages/ClientCommerceLiveStore"), "ClientCommerceLiveStore");
const ClientCommerceOrders = named(() => import("./pages/ClientCommerceOrders"), "ClientCommerceOrders");
const ClientCommercePreview = named(() => import("./pages/ClientCommercePreview"), "ClientCommercePreview");
const ClientCommerceProductImages = named(() => import("./pages/ClientCommerceProductImages"), "ClientCommerceProductImages");
const ClientCommerceProducts = named(() => import("./pages/ClientCommerceProducts"), "ClientCommerceProducts");
const ClientCommerceReadiness = named(() => import("./pages/ClientCommerceReadiness"), "ClientCommerceReadiness");
const ClientCommerceRequests = named(() => import("./pages/ClientCommerceRequests"), "ClientCommerceRequests");
const ClientCommerceSetup = named(() => import("./pages/ClientCommerceSetup"), "ClientCommerceSetup");
const ClientCommerceTutorial = named(() => import("./pages/ClientCommerceTutorial"), "ClientCommerceTutorial");
const ClientCommerceUsage = named(() => import("./pages/ClientCommerceUsage"), "ClientCommerceUsage");
const ClientCommerceWebsiteContent = named(() => import("./pages/ClientCommerceWebsiteContent"), "ClientCommerceWebsiteContent");
const ClientDomainStatus = named(() => import("./pages/ClientDomainStatus"), "ClientDomainStatus");
const ClientLaunchJourneyPage = named(() => import("./pages/ClientLaunchJourney"), "ClientLaunchJourneyPage");
const ClientFiles = named(() => import("./pages/ClientFiles"), "ClientFiles");
const ClientNotificationPreferences = named(() => import("./pages/ClientNotificationPreferences"), "ClientNotificationPreferences");
const ClientPortal = named(() => import("./pages/ClientPortal"), "ClientPortal");
const ClientRewards = named(() => import("./pages/ClientRewards"), "ClientRewards");
const ClientSecurityPrivacy = named(() => import("./pages/ClientSecurityPrivacy"), "ClientSecurityPrivacy");
const ClientSettings = named(() => import("./pages/ClientSettings"), "ClientSettings");
const ClientWebsiteHealth = named(() => import("./pages/ClientWebsiteHealth"), "ClientWebsiteHealth");
const ClientValueHistory = named(() => import("./pages/ClientValueHistory"), "ClientValueHistory");
const OwnerAutomationHealth = named(() => import("./pages/OwnerAutomationHealth"), "OwnerAutomationHealth");
const OwnerBillingLifecycle = named(() => import("./pages/OwnerBillingLifecycle"), "OwnerBillingLifecycle");
const OwnerCommerceBuildQueue = named(() => import("./pages/OwnerCommerceBuildQueue"), "OwnerCommerceBuildQueue");
const OwnerCommerceHub = named(() => import("./pages/OwnerCommerceHub"), "OwnerCommerceHub");
const OwnerCommerceReviews = named(() => import("./pages/OwnerCommerceReviews"), "OwnerCommerceReviews");
const OwnerCommerceUsage = named(() => import("./pages/OwnerCommerceUsage"), "OwnerCommerceUsage");
const OwnerDeployments = named(() => import("./pages/OwnerDeployments"), "OwnerDeployments");
const OwnerExceptionCenter = named(() => import("./pages/OwnerExceptionCenter"), "OwnerExceptionCenter");
const OwnerFiles = named(() => import("./pages/OwnerFiles"), "OwnerFiles");
const OwnerGrowthCenter = named(() => import("./pages/OwnerGrowthCenter"), "OwnerGrowthCenter");
const OwnerLaunchReadiness = named(() => import("./pages/OwnerLaunchReadiness"), "OwnerLaunchReadiness");
const OwnerPlanChanges = named(() => import("./pages/OwnerPlanChanges"), "OwnerPlanChanges");
const OwnerPortal = named(() => import("./pages/OwnerPortal"), "OwnerPortal");
const OwnerPreviewRequests = named(() => import("./pages/OwnerPreviewRequests"), "OwnerPreviewRequests");
const OwnerProductFamilies = named(() => import("./pages/OwnerProductFamilies"), "OwnerProductFamilies");
const OwnerProductionLaunches = named(() => import("./pages/OwnerProductionLaunches"), "OwnerProductionLaunches");
const OwnerProductionStatus = named(() => import("./pages/OwnerProductionStatus"), "OwnerProductionStatus");
const OwnerProviderHealth = named(() => import("./pages/OwnerProviderHealth"), "OwnerProviderHealth");
const OwnerSalesPipeline = named(() => import("./pages/OwnerSalesPipeline"), "OwnerSalesPipeline");
const OwnerStorefrontProvisioning = named(() => import("./pages/OwnerStorefrontProvisioning"), "OwnerStorefrontProvisioning");
const PortalLanding = named(() => import("./pages/PortalLanding"), "PortalLanding");
const PortalLogin = named(() => import("./pages/PortalLogin"), "PortalLogin");
const PortalSignup = named(() => import("./pages/PortalSignup"), "PortalSignup");
const PublicCommerceCheckout = named(() => import("./pages/PublicCommerceCheckout"), "PublicCommerceCheckout");
const PublicCommerceRequest = named(() => import("./pages/PublicCommerceRequest"), "PublicCommerceRequest");
const PublicCommerceStorefront = named(() => import("./pages/PublicCommerceStorefront"), "PublicCommerceStorefront");
const PublicHome = named(() => import("./pages/PublicHome"), "PublicHome");
const PublicPlans = named(() => import("./pages/PublicPlans"), "PublicPlans");
const ResetPassword = named(() => import("./pages/ResetPassword"), "ResetPassword");

function AppRoutes() {
  const path = window.location.pathname;
  if (path === "/owner/login") { window.location.replace("/portal/login"); return null; }
  if (path === "/owner/product-families") return <OwnerProtectedRoute><OwnerProductFamilies /></OwnerProtectedRoute>;
  if (path === "/owner/billing") return <OwnerProtectedRoute><OwnerBillingLifecycle /></OwnerProtectedRoute>;
  if (path === "/owner/commerce") return <OwnerProtectedRoute><OwnerCommerceHub /></OwnerProtectedRoute>;
  if (path === "/owner/commerce-usage") return <OwnerProtectedRoute><OwnerCommerceUsage /></OwnerProtectedRoute>;
  if (path === "/owner/commerce-builds") return <OwnerProtectedRoute><OwnerCommerceBuildQueue /></OwnerProtectedRoute>;
  if (path === "/owner/commerce-reviews") return <OwnerProtectedRoute><OwnerCommerceReviews /></OwnerProtectedRoute>;
  if (path === "/owner/storefront-provisioning") return <OwnerProtectedRoute><OwnerStorefrontProvisioning /></OwnerProtectedRoute>;
  if (path === "/owner/production-status") return <OwnerProtectedRoute><OwnerProductionStatus /></OwnerProtectedRoute>;
  if (path === "/owner/production-launches") return <OwnerProtectedRoute><OwnerProductionLaunches /></OwnerProtectedRoute>;
  if (path === "/owner/preview-requests") return <OwnerProtectedRoute><OwnerPreviewRequests /></OwnerProtectedRoute>;
  if (path === "/owner/deployments") return <OwnerProtectedRoute><OwnerDeployments /></OwnerProtectedRoute>;
  if (path === "/owner/exceptions") return <OwnerProtectedRoute><OwnerExceptionCenter /></OwnerProtectedRoute>;
  if (path === "/owner/providers") return <OwnerProtectedRoute><OwnerProviderHealth /></OwnerProtectedRoute>;
  if (path === "/owner/automation-health") return <OwnerProtectedRoute><OwnerAutomationHealth /></OwnerProtectedRoute>;
  if (path === "/owner/launch-readiness") return <OwnerProtectedRoute><OwnerLaunchReadiness /></OwnerProtectedRoute>;
  if (path === "/owner/growth") return <OwnerProtectedRoute><OwnerGrowthCenter /></OwnerProtectedRoute>;
  if (path === "/owner/sales") return <OwnerProtectedRoute><OwnerSalesPipeline /></OwnerProtectedRoute>;
  if (path === "/owner/files") return <OwnerProtectedRoute><OwnerFiles /></OwnerProtectedRoute>;
  if (path === "/owner/plan-changes") return <OwnerProtectedRoute><OwnerPlanChanges /></OwnerProtectedRoute>;
  if (path === "/owner") return <OwnerProtectedRoute><OwnerPortal /></OwnerProtectedRoute>;
  if (path.startsWith("/owner/")) { window.location.replace("/owner"); return null; }

  if (path === "/client/billing") return <ClientBillingStatus />;
  if (path === "/client/health") return <ClientWebsiteHealth />;
  if (path === "/client/history") return <ClientValueHistory />;
  if (path === "/client/domain") return <ClientDomainStatus />;
  if (path === "/client/journey") return <ClientLaunchJourneyPage />;
  if (path === "/client/files") return <ClientFiles />;
  if (path === "/client/notifications") return <ClientNotificationPreferences />;
  if (path === "/client/security-privacy") return <ClientSecurityPrivacy />;
  if (path === "/client/rewards") return <ClientRewards />;
  if (path === "/client/business/leads") return <ClientBusinessLeads />;
  if (path === "/client/business/changes") return <ClientBusinessChanges />;
  if (path === "/client/business/locations") return <ClientBusinessLocations />;
  if (path === "/client/business/analytics") return <ClientBusinessAnalytics />;
  if (path === "/client/business/reports") return <ClientBusinessReports />;
  if (path === "/client/business/seo") return <ClientBusinessSeo />;
  if (path === "/client/business") return <ClientBusinessDashboard />;
  if (path === "/client/commerce/readiness") return <ClientCommerceReadiness />;
  if (path === "/client/commerce/tutorial") return <ClientCommerceTutorial />;
  if (path === "/client/commerce/preview") return <ClientCommercePreview />;
  if (path === "/client/commerce/catalog") return <ClientCommerceCatalog />;
  if (path === "/client/commerce/categories") return <ClientCommerceCategories />;
  if (path === "/client/commerce/inventory") return <ClientCommerceInventory />;
  if (path === "/client/commerce/live") return <ClientCommerceLiveStore />;
  if (path === "/client/commerce/orders") return <ClientCommerceOrders />;
  if (path === "/client/commerce/requests") return <ClientCommerceRequests />;
  if (path === "/client/commerce/images") return <ClientCommerceProductImages />;
  if (path === "/client/commerce/content") return <ClientCommerceWebsiteContent />;
  if (path === "/client/commerce/products") return <ClientCommerceProducts />;
  if (path === "/client/commerce/usage") return <ClientCommerceUsage />;
  if (path === "/client/commerce/setup") return <ClientCommerceSetup />;
  if (path === "/client/commerce") return <ClientCommerceDashboard />;
  if (path === "/client/settings") return <ClientSettings />;
  if (path === "/client") return <><ClientPortalTopCards /><ClientPortal /><ClientPortalTutorialOverlay /></>;
  if (path.startsWith("/client/")) { window.location.replace("/client"); return null; }

  if (/^\/store\/[^/]+\/?$/.test(path)) return <PublicCommerceStorefront />;
  if (path === "/store/checkout") return <PublicCommerceCheckout />;
  if (path === "/store/request") return <PublicCommerceRequest />;
  if (path === "/plans") return <PublicPlans />;
  if (path === "/portal/login") return <PortalLogin />;
  if (path === "/portal/signup") return <PortalSignup />;
  if (path === "/portal/check-email") return <CheckEmail />;
  if (path === "/portal/forgot-password") return <ForgotPassword />;
  if (path === "/portal/reset-password") return <ResetPassword />;
  if (path === "/portal") return <PortalLanding />;
  if (path.startsWith("/portal/")) { window.location.replace("/portal"); return null; }
  return <PublicHome />;
}

function App() {
  return <div id="main-content" tabIndex={-1}><Suspense fallback={<main className="nxq-page"><div className="empty-state" role="status">Loading NXQ…</div></main>}><AppRoutes /></Suspense></div>;
}

export default App;
