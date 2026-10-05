import { useEffect } from "react";
import emblem from "../assets/nxqx-emblem.webp";

type Props = { variant: "home" | "app" };

// Fixed NXQX emblem background: a quiet heartbeat pulse, a glow that breathes with it, and a gentle
// parallax. It never intercepts clicks (pointer-events: none) and is hidden from assistive tech.
// "home" is the brighter marketing variant; "app" is dimmer so dense portal screens stay readable.
export function PremiumBackdrop({ variant }: Props) {
  useEffect(() => {
    const root = document.documentElement;
    // The page body paints its own background over a negative-z layer, so let it through while mounted.
    root.classList.add("px-has-bg");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const scroll = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const amount = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      root.style.setProperty("--px-p", amount.toFixed(4));
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(scroll); };
    const onPointer = (event: PointerEvent) => {
      root.style.setProperty("--px-px", ((event.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
      root.style.setProperty("--px-py", ((event.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
    };
    const spotlight = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".panel, .stat-card, .approval-card, .settings-card, .auth-card"
      );
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--px-mx", `${event.clientX - rect.left}px`);
      target.style.setProperty("--px-my", `${event.clientY - rect.top}px`);
    };
    const finePointer = !reduced && window.matchMedia("(pointer: fine)").matches;
    scroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    if (finePointer) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      if (variant === "app") document.addEventListener("pointermove", spotlight, { passive: true });
    }
    return () => {
      root.classList.remove("px-has-bg");
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointermove", spotlight);
      if (frame) window.cancelAnimationFrame(frame);
      ["--px-p", "--px-px", "--px-py"].forEach((name) => root.style.removeProperty(name));
    };
  }, [variant]);

  return (
    <>
      <div className={`px-bg px-bg-${variant}`} aria-hidden="true">
        <div className="px-logo" style={{ backgroundImage: `url(${emblem})` }}><i /></div>
        <div className="px-glow" />
        <div className="px-ripple" />
        <div className="px-shine" />
        <div className="px-scrim" />
        <div className="px-grain" />
      </div>
      <div className="px-progress" aria-hidden="true" />
      <div className="px-wipe" aria-hidden="true" />
    </>
  );
}
