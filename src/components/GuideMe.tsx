import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { bubblePlace, findTour, parseProgress, serializeProgress, tours } from "../lib/portalTours";
import type { Box, TourProgress } from "../lib/portalTours";
import "../styles/guide-tour.css";

// "Guide me": a button on every Commerce portal page. Pick a task and each real button is highlighted in turn, with one short sentence.
// Nothing here talks to the server or changes any data; the page underneath stays fully usable while a tour runs.
const progressKey = "nxq-guide-progress-v1"; // this browser tab only
const welcomedKey = "nxq-guide-welcomed-v1"; // this browser, so the first-visit offer shows once

function readProgress(): TourProgress | null {
  try { return parseProgress(window.sessionStorage.getItem(progressKey)); } catch { return null; }
}
function writeProgress(progress: TourProgress | null) {
  try {
    if (progress) window.sessionStorage.setItem(progressKey, serializeProgress(progress));
    else window.sessionStorage.removeItem(progressKey);
  } catch { /* private browsing: the tour still works on this page */ }
}
function wasWelcomed(): boolean {
  try { return window.localStorage.getItem(welcomedKey) === "1"; } catch { return true; }
}
function markWelcomed() {
  try { window.localStorage.setItem(welcomedKey, "1"); } catch { /* nothing to remember */ }
}

export function GuideMe() {
  const path = window.location.pathname;
  const [progress, setProgress] = useState<TourProgress | null>(readProgress);
  const [menuOpen, setMenuOpen] = useState(false);
  const [offerWelcome, setOfferWelcome] = useState(() => !wasWelcomed() && !readProgress());
  const [box, setBox] = useState<Box | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const tour = progress ? findTour(progress.tourId) : null;
  const step = tour && progress ? tour.steps[progress.step] : null;
  const onRightPage = Boolean(step && step.path === path);

  const go = useCallback((next: TourProgress | null) => { writeProgress(next); setProgress(next); setBox(null); setPlace(null); }, []);
  const stop = useCallback(() => { go(null); buttonRef.current?.focus(); }, [go]);
  function start(tourId: string) { markWelcomed(); setOfferWelcome(false); setMenuOpen(false); go({ tourId, step: 0 }); }
  function declineWelcome() { markWelcomed(); setOfferWelcome(false); }

  // Find the element for this step and keep the highlight on it while the page scrolls, resizes or finishes loading.
  useEffect(() => {
    if (!step || !onRightPage) return;
    let scrolled = false;
    const measure = () => {
      const element = document.querySelector(`[data-tour="${step.target}"]`);
      if (!element) { setBox(null); return; }
      if (!scrolled) {
        scrolled = true;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        try { element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); } catch { /* older browsers */ }
      }
      const r = element.getBoundingClientRect();
      setBox((old) => (old && old.top === r.top && old.left === r.left && old.width === r.width && old.height === r.height ? old : { top: r.top, left: r.left, width: r.width, height: r.height }));
    };
    measure();
    const timer = window.setInterval(measure, 400); // content that loads late, and the end of a smooth scroll
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => { window.clearInterval(timer); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
  }, [step, onRightPage]);

  // Put the words next to the highlight (wide screens; on a phone the CSS docks them to the bottom).
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!step || !bubble) return;
    const size = { width: bubble.offsetWidth, height: bubble.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (box && onRightPage) { const p = bubblePlace(box, viewport, size); setPlace({ top: p.top, left: p.left }); }
    else setPlace({ top: Math.max(12, (viewport.height - size.height) / 2), left: Math.max(12, (viewport.width - size.width) / 2) });
  }, [box, step, onRightPage]);

  // Move keyboard and screen-reader focus to the words when a step opens; Escape stops the tour.
  // (The words are hidden until they have a position, and a hidden element cannot take focus, so this waits for the position.)
  const placed = Boolean(place);
  useEffect(() => { if (step && placed) bubbleRef.current?.focus(); }, [progress?.tourId, progress?.step, step, placed]);
  useEffect(() => {
    if (!step && !menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { if (step) stop(); else { setMenuOpen(false); buttonRef.current?.focus(); } } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, menuOpen, stop]);

  const last = Boolean(tour && progress && progress.step === tour.steps.length - 1);
  const pad = 6;

  return (
    <>
      <div className="guide-wrap">
        <button ref={buttonRef} aria-expanded={menuOpen} aria-haspopup="true" className="guide-btn" data-testid="guide-me-open" data-tour="guide-button" type="button" onClick={() => { setOfferWelcome(false); markWelcomed(); setMenuOpen((open) => !open); }}>
          <Compass size={18} aria-hidden="true" /> Guide me
        </button>
        {menuOpen ? <div className="guide-menu" data-testid="guide-me-menu">
          <p>What do you want to do? We will point at each button, one step at a time.</p>
          <ul>{tours.map((item) => <li key={item.id}><button type="button" onClick={() => start(item.id)}>{item.label}</button></li>)}</ul>
        </div> : null}
        {offerWelcome && !menuOpen && !step ? <div className="guide-hello" data-testid="guide-me-welcome" role="status">
          <strong>New here?</strong>
          <p>Take a 30-second look around. You can open it again any time with Guide me.</p>
          <div className="guide-actions">
            <button className="guide-main" type="button" onClick={() => start("welcome")}>Show me around</button>
            <button type="button" onClick={declineWelcome}>Not now</button>
          </div>
        </div> : null}
      </div>

      {step && tour && progress ? <>
        {box && onRightPage
          ? <div aria-hidden="true" className="guide-ring" style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
          : <div aria-hidden="true" className="guide-dim" />}
        <div ref={bubbleRef} aria-labelledby="guide-step-title" aria-describedby="guide-step-text" className="guide-bubble" data-testid="guide-me-step" role="dialog" tabIndex={-1} style={place ? { top: place.top, left: place.left } : { top: 12, left: 12, visibility: "hidden" }}>
          <p className="guide-count">{tour.label} · Step {progress.step + 1} of {tour.steps.length}</p>
          <h2 id="guide-step-title">{onRightPage ? step.title : `Next: the ${step.pageLabel} page`}</h2>
          <p id="guide-step-text">{onRightPage ? step.text : `This step is on the ${step.pageLabel} page. Press the button below and the tour carries on there.`}</p>
          {onRightPage && !box ? <p className="guide-note">{step.missing || "We could not find that button on this screen yet. It may still be loading."}</p> : null}
          <div className="guide-actions">
            {onRightPage
              ? (last
                ? <button className="guide-main" type="button" onClick={stop}>Done</button>
                : <button className="guide-main" type="button" onClick={() => go({ tourId: tour.id, step: progress.step + 1 })}>Next</button>)
              : <a className="guide-main" href={step.path}>Go to {step.pageLabel}</a>}
            <button disabled={progress.step === 0} type="button" onClick={() => go({ tourId: tour.id, step: progress.step - 1 })}>Back</button>
            <button type="button" onClick={stop}>Stop the tour</button>
          </div>
        </div>
      </> : null}
    </>
  );
}
