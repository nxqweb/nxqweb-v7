import "./styles/nxq.css";
import { OwnerProtectedRoute } from "./components/OwnerProtectedRoute";
import { CheckEmail } from "./pages/CheckEmail";
import { ClientPortal } from "./pages/ClientPortal";
import { OwnerLogin } from "./pages/OwnerLogin";
import { OwnerPortal } from "./pages/OwnerPortal";
import { PortalLanding } from "./pages/PortalLanding";
import { PortalLogin } from "./pages/PortalLogin";
import { PortalSignup } from "./pages/PortalSignup";
import { PublicHome } from "./pages/PublicHome";

function App() {
  const path = window.location.pathname;

  if (path === "/owner/login") {
    return <OwnerLogin />;
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
