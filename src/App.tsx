import "./styles/nxq.css";
import { ClientPortal } from "./pages/ClientPortal";
import { OwnerPortal } from "./pages/OwnerPortal";
import { PublicHome } from "./pages/PublicHome";

function App() {
  const path = window.location.pathname;

  if (path.startsWith("/owner")) {
    return <OwnerPortal />;
  }

  if (path.startsWith("/client")) {
    return <ClientPortal />;
  }

  return <PublicHome />;
}

export default App;
