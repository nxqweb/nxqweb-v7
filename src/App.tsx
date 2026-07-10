import "./styles/nxq.css";
import { OwnerProtectedRoute } from "./components/OwnerProtectedRoute";
import { CheckEmail } from "./pages/CheckEmail";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ClientPortal } from "./pages/ClientPortal";
import { OwnerPortal } from "./pages/OwnerPortal";
import { PortalLanding } from "./pages/PortalLanding";
import { PortalLogin } from "./pages/PortalLogin";
import { PortalSignup } from "./pages/PortalSignup";
import { PublicHome } from "./pages/PublicHome";
import { ResetPassword } from "./pages/ResetPassword";

function App() {
  const path = window.location.pathname;

  if (path === "/owner/login") {
    window.location.replace("/portal/login");
    return null;
  }

  if (path === "/owner") {
    return (
      <OwnerProtectedRoute>
        <OwnerPortal />
      </OwnerProtectedRoute>
    );
  }

  if (path.startsWith("/owner/")) {
    window.location.replace("/owner");
    return null;
  }

  if (path === "/client") {
    return <ClientPortal />;
  }

  if (path.startsWith("/client/")) {
    window.location.replace("/client");
    return null;
  }

  if (path === "/portal/login") {
    return <PortalLogin />;
  }

  if (path === "/portal/signup") {
    return <PortalSignup />;
  }

  if (path === "/portal/check-email") {
    return <CheckEmail />;
  }

  if (path === "/portal/forgot-password") {
    return <ForgotPassword />;
  }

  if (path === "/portal/reset-password") {
    return <ResetPassword />;
  }

  if (path === "/portal") {
    return <PortalLanding />;
  }

  if (path.startsWith("/portal/")) {
    window.location.replace("/portal");
    return null;
  }

  return <PublicHome />;
}

export default App;
