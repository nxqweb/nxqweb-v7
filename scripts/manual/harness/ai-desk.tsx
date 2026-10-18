// Manual-testing harness (never part of the production build): mounts the owner's AI Desk panel with two fake clients, no login, no network.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles/nxq.css";
import "../../../src/styles/portal-premium.css";
import "../../../src/styles/portal-polish.css";
import "../../../src/styles/final-frontend-polish.css";
import "../../../src/styles/plan-forms.css";
import "../../../src/styles/nxqx-neural-glass.css";
import "../../../src/styles/premium-v2.css";
import { OwnerAiDesk, type DeskClient } from "../../../src/components/OwnerAiDesk";

const full = [
  { label: "Business phone", value: "555-0100" },
  { label: "Industry", value: "Candles and soap" },
  { label: "Services / products", value: "Soy candles, Handmade soap, Gift sets" },
  { label: "Brand difference / positioning", value: "Small-batch candles and soap made by hand in Chico." },
  { label: "Style direction", value: "Warm, simple, cream and gold" },
  { label: "Locations", value: "Chico, California" },
];
const clients: DeskClient[] = [
  { id: "c1", name: "Light of the world candles and soap", businessType: "Candles and soap", fields: full },
  { id: "c2", name: "Half Filled Sheet Co", businessType: null, fields: [{ label: "Industry", value: "Plumbing" }] },
];

// eslint-disable-next-line react-refresh/only-export-components -- harness file mounts itself and exports nothing
function Harness() {
  const [id, setId] = useState(new URLSearchParams(window.location.search).get("pick") || "");
  return <OwnerAiDesk clients={clients} selectedId={id} onSelect={setId} />;
}
createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
