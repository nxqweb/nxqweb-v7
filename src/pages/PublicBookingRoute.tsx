import { PublicBooking } from "./PublicBooking";
import { publicBookingGateway } from "../lib/bookingConfig";

// The public "request an appointment" page at /book/<name>. No sign-in. The name comes from the address. While the one switch (src/lib/bookingConfig.ts) is null the page says the
// feature is not open yet. An address with no usable name shows a calm message instead of asking the database about nothing.
function slugFromPath(pathname: string) {
  const part = pathname.split("/")[2] || "";
  try { return decodeURIComponent(part); } catch { return ""; }
}

export function PublicBookingRoute() {
  const slug = slugFromPath(window.location.pathname);
  if (!slug.trim()) return <main className="nxq-page"><section className="portal-shell"><h1>Appointment requests</h1><div className="empty-state" role="status">This booking link is not complete. If someone sent you this link, please contact them another way.</div></section></main>;
  return <PublicBooking slug={slug} gateway={publicBookingGateway} />;
}
