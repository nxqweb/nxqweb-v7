import "./styles/nxq.css";
import { CheckEmail } from "./pages/CheckEmail";
import { ClientPortal } from "./pages/ClientPortal";
import { OwnerPortal } from "./pages/OwnerPortal";
import { PortalLanding } from "./pages/PortalLanding";
import { PortalLogin } from "./pages/PortalLogin";
import { PortalSignup } from "./pages/PortalSignup";
import { PublicHome } from "./pages/PublicHome";

function App() {
  const path = window.location.pathname;

  if (path.startsWith("/owner")) {
    return <OwnerPortal />;
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

