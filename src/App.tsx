import "./styles/nxq.css";
import "./styles/deployments.css";
import "./styles/plan-forms.css";
import { ClientPortalTopCards } from "./components/ClientPortalTopCards";
import { ClientPortalTutorialOverlay } from "./components/ClientPortalTutorialOverlay";
import { OwnerProtectedRoute } from "./components/OwnerProtectedRoute";
import { CheckEmail } from "./pages/CheckEmail";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ClientBillingStatus } from "./pages/ClientBillingStatus";
import { ClientBusinessAnalytics } from "./pages/ClientBusinessAnalytics";
import { ClientBusinessChanges } from "./pages/ClientBusinessChanges";
import { ClientBusinessDashboard } from "./pages/ClientBusinessDashboard";
import { ClientBusinessLeads } from "./pages/ClientBusinessLeads";
import { ClientBusinessLocations } from "./pages/ClientBusinessLocations";
import { ClientBusinessReports } from "./pages/ClientBusinessReports";
import { ClientCommerceCatalog } from "./pages/ClientCommerceCatalog";
import { ClientCommerceCategories } from "./pages/ClientCommerceCategories";
import { ClientCommerceDashboard } from "./pages/ClientCommerceDashboard";
import { ClientCommerceInventory } from "./pages/ClientCommerceInventory";
import { ClientCommerceLiveStore } from "./pages/ClientCommerceLiveStore";
import { ClientCommerceOrders } from "./pages/ClientCommerceOrders";
import { ClientCommercePreview } from "./pages/ClientCommercePreview";
import { ClientCommerceProductImages } from "./pages/ClientCommerceProductImages";
import { ClientCommerceProducts } from "./pages/ClientCommerceProducts";
import { ClientCommerceReadiness } from "./pages/ClientCommerceReadiness";
import { ClientCommerceRequests } from "./pages/ClientCommerceRequests";
import { ClientCommerceSetup } from "./pages/ClientCommerceSetup";
import { ClientCommerceTutorial } from "./pages/ClientCommerceTutorial";
import { ClientCommerceUsage } from "./pages/ClientCommerceUsage";
import { ClientCommerceWebsiteContent } from "./pages/ClientCommerceWebsiteContent";
import { ClientPortal } from "./pages/ClientPortal";
import { ClientSecurityPrivacy } from "./pages/ClientSecurityPrivacy";
import { ClientSettings } from "./pages/ClientSettings";
import { ClientWebsiteHealth } from "./pages/ClientWebsiteHealth";
import { OwnerAutomationHealth } from "./pages/OwnerAutomationHealth";
import { OwnerBillingLifecycle } from "./pages/OwnerBillingLifecycle";
import { OwnerCommerceBuildQueue } from "./pages/OwnerCommerceBuildQueue";
import { OwnerCommerceHub } from "./pages/OwnerCommerceHub";
import { OwnerCommerceReviews } from "./pages/OwnerCommerceReviews";
import { OwnerCommerceUsage } from "./pages/OwnerCommerceUsage";
import { OwnerDeployments } from "./pages/OwnerDeployments";
import { OwnerExceptionCenter } from "./pages/OwnerExceptionCenter";
import { OwnerFiles } from "./pages/OwnerFiles";
import { OwnerLaunchReadiness } from "./pages/OwnerLaunchReadiness";
import { OwnerPlanChanges } from "./pages/OwnerPlanChanges";
import { OwnerPortal } from "./pages/OwnerPortal";
import { OwnerPreviewRequests } from "./pages/OwnerPreviewRequests";
import { OwnerProductFamilies } from "./pages/OwnerProductFamilies";
import { OwnerProductionLaunches } from "./pages/OwnerProductionLaunches";
import { OwnerProductionStatus } from "./pages/OwnerProductionStatus";
import { OwnerProviderHealth } from "./pages/OwnerProviderHealth";
import { OwnerStorefrontProvisioning } from "./pages/OwnerStorefrontProvisioning";
import { PortalLanding } from "./pages/PortalLanding";
import { PortalLogin } from "./pages/PortalLogin";
import { PortalSignup } from "./pages/PortalSignup";
import { PublicCommerceCheckout } from "./pages/PublicCommerceCheckout";
import { PublicCommerceRequest } from "./pages/PublicCommerceRequest";
import { PublicCommerceStorefront } from "./pages/PublicCommerceStorefront";
import { PublicHome } from "./pages/PublicHome";
import { PublicPlans } from "./pages/PublicPlans";
import { ResetPassword } from "./pages/ResetPassword";

function App() {
  const path = window.location.pathname;

  if (path === "/owner/login") {
    window.location.replace("/portal/login");
    return null;
  }

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
  if (path === "/owner/files") return <OwnerProtectedRoute><OwnerFiles /></OwnerProtectedRoute>;
  if (path === "/owner/plan-changes") return <OwnerProtectedRoute><OwnerPlanChanges /></OwnerProtectedRoute>;

  if (path === "/owner") {
    return (
      <OwnerProtectedRoute>
        <>
          <OwnerPortal />
          <a className="owner-plan-change-shortcut" href="/owner/plan-changes">Review plan changes</a>
          <a className="owner-plan-change-shortcut" href="/owner/product-families" style={{ bottom: "5.25rem" }}>Product families</a>
          <a className="owner-plan-change-shortcut" href="/owner/billing" style={{ bottom: "8.75rem" }}>Billing lifecycle</a>
          <a className="owner-plan-change-shortcut" href="/owner/exceptions" style={{ bottom: "12.25rem" }}>Exception center</a>
          <a className="owner-plan-change-shortcut" href="/owner/automation-health" style={{ bottom: "15.75rem" }}>Automation health</a>
          <a className="owner-plan-change-shortcut" href="/owner/providers" style={{ bottom: "19.25rem" }}>Provider health</a>
          <a className="owner-plan-change-shortcut" href="/owner/launch-readiness" style={{ bottom: "22.75rem" }}>Launch readiness</a>
        </>
      </OwnerProtectedRoute>
    );
  }

  if (path.startsWith("/owner/")) {
    window.location.replace("/owner");
    return null;
  }

  if (path === "/client/billing") return <ClientBillingStatus />;
  if (path === "/client/health") return <ClientWebsiteHealth />;
  if (path === "/client/security-privacy") return <ClientSecurityPrivacy />;
  if (path === "/client/business/leads") return <ClientBusinessLeads />;
  if (path === "/client/business/changes") return <ClientBusinessChanges />;
  if (path === "/client/business/locations") return <ClientBusinessLocations />;
  if (path === "/client/business/analytics") return <ClientBusinessAnalytics />;
  if (path === "/client/business/reports") return <ClientBusinessReports />;
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

  if (path === "/client") {
    return <><ClientPortalTopCards /><ClientPortal /><ClientPortalTutorialOverlay /></>;
  }

  if (path.startsWith("/client/")) {
    window.location.replace("/client");
    return null;
  }

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

  if (path.startsWith("/portal/")) {
    window.location.replace("/portal");
    return null;
  }

  return <PublicHome />;
}

export default App;
