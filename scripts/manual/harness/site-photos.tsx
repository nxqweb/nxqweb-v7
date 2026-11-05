// Manual-testing harness (never part of the production build): mounts the website photos panel with an in-memory fake of the three photo functions and of
// the uploader, no login, no network. The test drives scan results and failures through window.photoSim.
import { createRoot } from "react-dom/client";
import "../../../src/styles/nxq.css";
import "../../../src/styles/portal-premium.css";
import "../../../src/styles/portal-polish.css";
import "../../../src/styles/final-frontend-polish.css";
import "../../../src/styles/plan-forms.css";
import "../../../src/styles/nxqx-neural-glass.css";
import "../../../src/styles/premium-v2.css";
import { ClientSitePhotos } from "../../../src/components/ClientSitePhotos";
import type { PhotoUploader, SitePhoto, SitePhotosGateway } from "../../../src/lib/sitePhotos";

type Sim = { photos: SitePhoto[]; uploads: { name: string; type: string; size: number }[]; saves: string[]; scan: (fileId: string, status: string, released: boolean) => void };
let counter = 0;
const sim: Sim = {
  photos: [], uploads: [], saves: [],
  scan(fileId, status, released) { sim.photos = sim.photos.map((photo) => (photo.fileId === fileId ? { ...photo, scanStatus: status, released } : photo)); },
};
(window as unknown as { photoSim: Sim }).photoSim = sim;

// Same rules as the database functions (12 in Our work, 24 in all, no < or > in text).
const gateway: SitePhotosGateway = {
  async list() { return sim.photos.map((photo) => ({ ...photo })); },
  async save(input) {
    sim.saves.push(`${input.fileId}:${input.role}:${input.sortOrder}`);
    if (/[<>]/.test(input.altText + input.caption)) throw new Error("Photo descriptions cannot contain the characters < or >.");
    const existing = sim.photos.find((photo) => photo.fileId === input.fileId);
    const others = sim.photos.filter((photo) => photo.fileId !== input.fileId);
    if (input.role === "work" && others.filter((photo) => photo.role === "work").length >= 12) throw new Error("You can show up to 12 photos in Our work.");
    if (others.length >= 24) throw new Error("You can keep up to 24 website photos.");
    const next: SitePhoto = { fileId: input.fileId, fileName: existing?.fileName ?? `file-${input.fileId}`, role: input.role, altText: input.altText, caption: input.caption, sortOrder: input.sortOrder, scanStatus: existing?.scanStatus ?? "pending", released: existing?.released ?? false };
    sim.photos = [...others, next];
  },
  async remove(fileId) { sim.photos = sim.photos.filter((photo) => photo.fileId !== fileId); },
};

const upload: PhotoUploader = async (file) => {
  sim.uploads.push({ name: file.name, type: file.type, size: file.size });
  if (file.name.includes("fail")) return { ok: false, message: "The photo could not be uploaded. Nothing was saved." };
  counter += 1;
  const fileId = `f${counter}`;
  // the real register function returns the file row; the fake just remembers the name so the list can show it
  sim.photos = [...sim.photos, { fileId, fileName: file.name, role: "work", altText: "", caption: "", sortOrder: 0, scanStatus: "pending", released: false }];
  return { ok: true, fileId };
};

if (new URLSearchParams(window.location.search).get("full") === "1") {
  for (let i = 1; i <= 12; i += 1) sim.photos.push({ fileId: `pre${i}`, fileName: `work-${i}.jpg`, role: "work", altText: `Photo ${i}`, caption: "", sortOrder: i, scanStatus: "clean", released: true });
}
createRoot(document.getElementById("root") as HTMLElement).render(<ClientSitePhotos gateway={gateway} upload={upload} />);
