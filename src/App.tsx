import "./styles/nxq.css";
import "./styles/deployments.css";
import "./styles/plan-forms.css";
import { ClientCommercePortalTab } from "./components/ClientCommercePortalTab";
import { OwnerProtectedRoute } from "./components/OwnerProtectedRoute";
import { CheckEmail } from "./pages/CheckEmail";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ClientCommerceCatalog } from "./pages/ClientCommerceCatalog";
import { ClientCommerceCategories } from "./pages/ClientCommerceCategories";
import { ClientCommerceDashboard } from "./pages/ClientCommerceDashboard";
import { ClientCommerceInventory } from "./pages/ClientCommerceInventory";
import { ClientCommerceOrders } from "./pages/ClientCommerceOrders";
import { ClientCommercePreview } from "./pages/ClientCommercePreview";
import { ClientCommerceProducts } from "./pages/ClientCommerceProducts";
import { ClientCommerceRequests } from "./pages/ClientCommerceRequests";
import { ClientCommerceSetup } from "./pages/ClientCommerceSetup";
import { ClientCommerceTutorial } from "./pages/ClientCommerceTutorial";
import { ClientCommerceUsage } from "./pages/ClientCommerceUsage";
import { ClientPortal } from "./pages/ClientPortal";
import { ClientSettings } from "./pages/ClientSettings";
import { OwnerCommerceBuildQueue } from "./pages/OwnerCommerceBuildQueue";
import { OwnerCommerceHub } from "./pages/OwnerCommerceHub";
import { OwnerCommerceReviews } from "./pages/OwnerCommerceReviews";
import { OwnerCommerceUsage } from "./pages/OwnerCommerceUsage";
import { OwnerDeployments } from "./pages/OwnerDeployments";
import { OwnerFiles } from "./pages/OwnerFiles";
import { OwnerPlanChanges } from "./pages/OwnerPlanChanges";
import { OwnerPortal } from "./pages/OwnerPortal";
import { OwnerPreviewRequests } from "./pages/OwnerPreviewRequests";
import { OwnerProductFamilies } from "./pages/OwnerProductFamilies";
import { OwnerProductionLaunches } from "./pages/OwnerProductionLaunches";
import { OwnerProductionStatus } from "./pages/OwnerProductionStatus";
import { PortalLanding } from "./pages/PortalLanding";
import { PortalLogin } from "./pages/PortalLogin";
import { PortalSignup } from "./pages/PortalSignup";
import { PublicCommerceCheckout } from "./pages/PublicCommerceCheckout";
import { PublicCommerceRequest } from "./pages/PublicCommerceRequest";
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
  if (path === "/owner/commerce") return <OwnerProtectedRoute><OwnerCommerceHub /></OwnerProtectedRoute>;
  if (path === "/owner/commerce-usage") return <OwnerProtectedRoute><OwnerCommerceUsage /></OwnerProtectedRoute>;
  if (path === "/owner/commerce-builds") return <OwnerProtectedRoute><OwnerCommerceBuildQueue /></OwnerProtectedRoute>;
  if (path === "/owner/commerce-reviews") return <OwnerProtectedRoute><OwnerCommerceReviews /></OwnerProtectedRoute>;
  if (path === "/owner/production-status") return <OwnerProtectedRoute><OwnerProductionStatus /></OwnerProtectedRoute>;
  if (path === "/owner/production-launches") return <OwnerProtectedRoute><OwnerProductionLaunches /></OwnerProtectedRoute>;
  if (path === "/owner/preview-requests") return <OwnerProtectedRoute><OwnerPreviewRequests /></OwnerProtectedRoute>;
  if (path === "/owner/deployments") return <OwnerProtectedRoute><OwnerDeployments /></OwnerProtectedRoute>;
  if (path === "/owner/files") return <OwnerProtectedRoute><OwnerFiles /></OwnerProtectedRoute>;
  if (path === "/owner/plan-changes") return <OwnerProtectedRoute><OwnerPlanChanges /></OwnerProtectedRoute>;

  if (path === "/owner") {
    return (
      <OwnerProtectedRoute>
        <>
          <OwnerPortal />
          <a className="owner-plan-change-shortcut" href="/owner/plan-changes">Review plan changes</a>
          <a className="owner-plan-change-shortcut" href="/owner/product-families" style={{ bottom: "5.25rem" }}>Product families</a>
        </>
      </OwnerProtectedRoute>
    );
  }

  if (path.startsWith("/owner/")) {
    window.location.replace("/owner");
    return null;
  }

  if (path === "/client/commerce/tutorial") return <ClientCommerceTutorial />;
  if (path === "/client/commerce/preview") return <ClientCommercePreview />;
  if (path === "/client/commerce/catalog") return <ClientCommerceCatalog />;
  if (path === "/client/commerce/categories") return <ClientCommerceCategories />;
  if (path === "/client/commerce/inventory") return <ClientCommerceInventory />;
  if (path === "/client/commerce/orders") return <ClientCommerceOrders />;
  if (path === "/client/commerce/requests") return <ClientCommerceRequests />;
  if (path === "/client/commerce/products") return <ClientCommerceProducts />;
  if (path === "/client/commerce/usage") return <ClientCommerceUsage />;
  if (path === "/client/commerce/setup") return <ClientCommerceSetup />;
  if (path === "/client/commerce") return <ClientCommerceDashboard />;
  if (path === "/client/settings") return <ClientSettings />;

  if (path === "/client") {
    return <><ClientCommercePortalTab /><ClientPortal /></>;
  }

  if (path.startsWith("/client/")) {
    window.location.replace("/client");
    return null;
  }

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
