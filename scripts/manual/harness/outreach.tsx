// Manual-testing harness (never part of the production build): mounts the owner's outreach card page without the owner login so it can be driven in a real browser.
import { createRoot } from "react-dom/client";
import "../../../src/styles/nxq.css";
import "../../../src/styles/portal-premium.css";
import "../../../src/styles/portal-polish.css";
import "../../../src/styles/final-frontend-polish.css";
import "../../../src/styles/plan-forms.css";
import "../../../src/styles/nxqx-neural-glass.css";
import "../../../src/styles/premium-v2.css";
import { OwnerOutreachCard } from "../../../src/pages/OwnerOutreachCard";

if (new URLSearchParams(window.location.search).get("reset")) { try { localStorage.removeItem("nxq-owner-outreach-card-v1"); } catch { /* ignore */ } }
createRoot(document.getElementById("root") as HTMLElement).render(<OwnerOutreachCard />);
