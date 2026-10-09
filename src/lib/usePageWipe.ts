import { useEffect } from "react";

// Plays a short gold wipe before following an internal page link that opts in with data-px-wipe.
// Modified clicks (new tab, etc.), reduced motion, and any failure fall back to normal navigation.
export function usePageWipe() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-px-wipe]");
      const overlay = document.querySelector<HTMLElement>(".px-wipe");
      if (!link || !overlay || link.target === "_blank") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      overlay.classList.remove("px-go");
      void overlay.offsetWidth;
      overlay.classList.add("px-go");
      window.setTimeout(() => window.location.assign(url.href), 380);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}
