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


  if (path.startsWith("/owner")) {
    return (
      <OwnerProtectedRoute>
        <OwnerPortal />
      </OwnerProtectedRoute>
    );
  }

  if (path.startsWith("/client")) {
    return <ClientPortal />;
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

  if (path.startsWith("/portal")) {
    return <PortalLanding />;
  }

  return <PublicHome />;
}

export default App;



