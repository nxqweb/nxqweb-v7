import { useMemo } from "react";
import { makeQr, qrPathData } from "../lib/qrCode";

// A scannable code for a link, drawn with ordinary SVG elements (nothing is injected as raw HTML). Dark squares on white with the standard quiet border,
// whatever the page theme, so phone cameras can read it.
export function ReviewQr({ value, label }: { value: string; label: string }) {
  const drawing = useMemo(() => { try { return qrPathData(makeQr(value)); } catch { return null; } }, [value]);
  if (!drawing) return <p className="subtle" role="status">This link is too long for a printed code. Use the short link from your review page.</p>;
  return (
    <svg className="review-qr" viewBox={`0 0 ${drawing.viewSize} ${drawing.viewSize}`} shapeRendering="crispEdges" role="img" aria-label={label} data-testid="review-qr">
      <rect width={drawing.viewSize} height={drawing.viewSize} fill="#ffffff" />
      <path d={drawing.path} fill="#000000" />
    </svg>
  );
}
