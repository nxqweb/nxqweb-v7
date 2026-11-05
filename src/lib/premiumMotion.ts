import { useEffect, useLayoutEffect } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Marks the document so reveal styles only hide content when scripting is running.
// The class is added before paint and removed on unmount, so other pages are unaffected.
export function usePremiumRoot() {
  useLayoutEffect(() => {
    document.documentElement.classList.add("px-js");
    return () => document.documentElement.classList.remove("px-js");
  }, []);
}

// Fades sections in as they scroll into view. Without IntersectionObserver or with reduced
// motion everything is simply shown.
export function useScrollReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-px-reveal]"));
    nodes.forEach((node) => {
      const index = node.parentElement ? Array.prototype.indexOf.call(node.parentElement.children, node) : 0;
      node.style.setProperty("--px-i", String(Math.min(index, 5)));
    });
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      nodes.forEach((node) => node.classList.add("px-in"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("px-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

// Draws the process line as the steps scroll into view and lights each step in turn.
export function useProcessLine() {
  useEffect(() => {
    const track = document.querySelector<HTMLElement>("[data-px-steps]");
    if (!track) return;
    const steps = Array.from(track.querySelectorAll<HTMLElement>("[data-px-step]"));
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      steps.forEach((step) => step.classList.add("px-in"));
      track.style.setProperty("--px-draw", "1");
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = track.getBoundingClientRect();
      const amount = Math.min(1, Math.max(0, (window.innerHeight * 0.85 - rect.top) / (window.innerHeight * 0.5)));
      track.style.setProperty("--px-draw", amount.toFixed(3));
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add("px-in"); }),
      { threshold: 0.6 }
    );
    steps.forEach((step) => observer.observe(step));
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
}

// Counts numbers up the first time they are visible.
export function useCountUp() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-px-count]"));
    const finish = (node: HTMLElement) => { node.textContent = node.dataset.pxCount || ""; };
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      nodes.forEach(finish);
      return;
    }
    const run = (node: HTMLElement) => {
      const target = Number(node.dataset.pxCount);
      if (!Number.isFinite(target)) { finish(node); return; }
      let start = 0;
      const step = (time: number) => {
        if (!start) start = time;
        const progress = Math.min(1, (time - start) / 1200);
        node.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) { run(entry.target as HTMLElement); observer.unobserve(entry.target); }
      }),
      { threshold: 0.6 }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

// Highlights the matching lifecycle stage while its text scrolls past the middle of the screen.
export function useStoryStage(onStage: (index: number) => void) {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-px-story]"));
    if (!items.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) onStage(items.indexOf(entry.target as HTMLElement));
      }),
      { rootMargin: "-40% 0px -45% 0px" }
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [onStage]);
}

// Spotlight that follows the pointer over cards and plans (fine pointers only).
export function usePointerSpotlight() {
  useEffect(() => {
    if (prefersReducedMotion() || !window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-px-spot]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--px-mx", `${event.clientX - rect.left}px`);
      target.style.setProperty("--px-my", `${event.clientY - rect.top}px`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
}
