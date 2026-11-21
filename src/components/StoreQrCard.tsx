import { useMemo, useState } from "react";
import { Download, QrCode } from "lucide-react";
import { makeQr, qrPathData } from "../lib/qrCode";
import { qrFileName, qrPixelPlan } from "../lib/storeQr";

// A scannable code for the store's own address, for a market table, a flyer or a product label. Made in the browser from the address the
// owner already sees; nothing is sent anywhere. Dark squares on white with the standard quiet border so phone cameras can read it.
export function StoreQrCard({ url, storeName }: { url: string; storeName: string }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState("");
  const grid = useMemo(() => { try { return makeQr(url); } catch { return null; } }, [url]);
  if (!grid) return null; // an address too long for a code: the Copy button still works

  const drawing = qrPathData(grid);

  function download() {
    if (!grid) return;
    try {
      const plan = qrPixelPlan(grid.size);
      const canvas = document.createElement("canvas");
      canvas.width = plan.side; canvas.height = plan.side;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, plan.side, plan.side);
      ctx.fillStyle = "#000000";
      grid.modules.forEach((row, y) => row.forEach((on, x) => { if (on) ctx.fillRect((x + plan.border) * plan.scale, (y + plan.border) * plan.scale, plan.scale, plan.scale); }));
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = qrFileName(storeName);
      document.body.appendChild(link); link.click(); link.remove();
      setProblem("");
    } catch { setProblem("The picture could not be saved here. Take a screenshot of the code instead."); }
  }

  return (
    <div data-testid="store-qr-card" style={{ marginTop: ".75rem" }}>
      <button className="icon-btn" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}><QrCode size={16} /> {open ? "Hide QR code" : "Show QR code"}</button>
      {open ? <div className="notice-card" style={{ marginTop: ".75rem", textAlign: "center" }}>
        <strong>Scan to open your store</strong>
        <svg viewBox={`0 0 ${drawing.viewSize} ${drawing.viewSize}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${storeName || "your store"}`} data-testid="store-qr" style={{ display: "block", width: 220, maxWidth: "100%", height: "auto", margin: ".75rem auto" }}>
          <rect width={drawing.viewSize} height={drawing.viewSize} fill="#ffffff" />
          <path d={drawing.path} fill="#000000" />
        </svg>
        <p className="subtle">Print it for your table, flyers or labels. Customers point their phone camera at it and your store opens.</p>
        <button className="wide-btn" type="button" onClick={download}><Download size={16} /> Save QR code picture</button>
        {problem ? <p className="subtle" role="alert">{problem}</p> : null}
      </div> : null}
    </div>
  );
}
