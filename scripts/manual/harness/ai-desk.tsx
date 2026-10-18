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
import { buildDeskRequest } from "../../../src/lib/aiDesk";
import type { AiDeskGateway, DeskStatus } from "../../../src/lib/aiDeskGateway";

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

// ?server=1 mounts the panel in server mode with an in-memory fake of the AI Desk functions. The test drives the "pipeline" through window.deskSim.
type Sim = { state: DeskStatus; saved: unknown[]; failSave: string; calls: string[]; prepare: () => Promise<void> };
const sim: Sim = {
  state: { status: "none", request: null, savedAt: null, usedAt: null, lastError: null },
  saved: [], failSave: "", calls: [],
  async prepare() {
    const built = await buildDeskRequest({ fields: full, businessName: clients[0].name, businessType: "Candles and soap" });
    if (built.ok) sim.state = { status: "waiting", request: built.request, savedAt: null, usedAt: null, lastError: sim.state.lastError };
  },
};
(window as unknown as { deskSim: Sim }).deskSim = sim;
const fakeGateway: AiDeskGateway = {
  async getStatus(clientId) { sim.calls.push(`status:${clientId}`); return { ...sim.state }; },
  async save(clientId, answer) {
    sim.calls.push(`save:${clientId}`);
    if (sim.failSave) throw new Error(sim.failSave);
    sim.saved.push(answer);
    sim.state = { status: "saved", request: null, savedAt: new Date().toISOString(), usedAt: null, lastError: null };
  },
};
const serverMode = new URLSearchParams(window.location.search).get("server") === "1";

// eslint-disable-next-line react-refresh/only-export-components -- harness file mounts itself and exports nothing
function Harness() {
  const [id, setId] = useState(new URLSearchParams(window.location.search).get("pick") || "");
  return <OwnerAiDesk clients={clients} selectedId={id} onSelect={setId} gateway={serverMode ? fakeGateway : null} />;
}
createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
