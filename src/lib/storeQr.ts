// Small pure helpers for the store's QR code picture (src/components/StoreQrCard.tsx).

// Whole pixels per square (so the picture is sharp), with the standard 4-square quiet border, aiming at about 1024 pixels a side.
export function qrPixelPlan(gridSize: number, target = 1024, border = 4): { scale: number; border: number; side: number } {
  const squares = (Number.isFinite(gridSize) ? Math.max(1, Math.floor(gridSize)) : 21) + border * 2;
  const scale = Math.max(4, Math.floor(target / squares));
  return { scale, border, side: squares * scale };
}

// A safe, readable file name from the store's name: letters, digits and hyphens only.
export function qrFileName(storeName: string): string {
  const slug = (storeName || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60);
  return `${slug || "my-store"}-qr-code.png`;
}
