import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Compass, X } from "lucide-react";

const tutorialKey = "nxq-client-portal-tutorial-v2-complete";

const steps = [
  {
    title: "Welcome to your NXQX-Web workspace",
    body: "This portal is the home for your website, messages, files, billing, domain setup, and ongoing website health.",
  },
  {
    title: "Follow website progress here",
    body: "Your Website Journey shows a truthful setup-to-launch timeline. It separates the exact actions we need from you from work NXQX is already handling.",
  },
  {
    title: "Every page is one tap away",
    body: "Scroll to the bottom of your portal home: each page is a card with a short description, so you never have to remember an address. If you have an online store, its pages have the same cards at the bottom.",
  },
  {
    title: "Messages and files stay with the client record",
    body: "Use the portal for website requests, questions, approvals that genuinely require you, and files related to your business website.",
  },
  {
    title: "Domain and account settings",
    body: "Settings keeps your login, appearance, plan, and domain information together. Domain automation will show a clear action-required message only when your registrar needs something NXQX cannot do yet.",
  },
  {
    title: "Your NXQX ID goes beyond NXQX-Web",
    body: "Your NXQX ID is your shared identity across future NXQX products. Products that need stronger identity proof can ask you to add verification without creating a separate NXQX account.",
  },
];

// Browsers can block storage (private mode, blocked site data). That must never take the whole portal down: the tour simply shows again next time.
function readTutorialDone(): boolean { try { return window.localStorage.getItem(tutorialKey) === "true"; } catch { return false; } }
function markTutorialDone() { try { window.localStorage.setItem(tutorialKey, "true"); } catch { /* the tour will show again next time */ } }

export function ClientPortalTutorialOverlay() {
  const [open, setOpen] = useState(() => readTutorialDone() !== true);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const step = useMemo(() => steps[index], [index]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLElement>("button")?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        markTutorialDone();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!open) return null;

  function finish() {
    markTutorialDone();
    setOpen(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nxq-client-tutorial-title"
      aria-describedby="nxq-client-tutorial-description"
      ref={dialogRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "grid",
        placeItems: "center",
        padding: "1rem",
        background: "rgba(0,0,0,.72)",
        backdropFilter: "blur(12px)",
      }}
    >
      <section className="panel" style={{ width: "min(620px, 100%)", padding: "1.4rem" }}>
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Compass size={24} />
            <div>
              <span className="subtle">Quick tour · {index + 1}/{steps.length}</span>
              <h2 id="nxq-client-tutorial-title">{step.title}</h2>
            </div>
          </div>
          <button className="icon-btn" type="button" onClick={finish} aria-label="Close tutorial">
            <X size={16} />
          </button>
        </div>

        <p id="nxq-client-tutorial-description" style={{ fontSize: "1.05rem", lineHeight: 1.65 }}>{step.body}</p>

        <div style={{ display: "flex", gap: ".65rem", justifyContent: "space-between", flexWrap: "wrap", marginTop: "1.2rem" }}>
          <button className="icon-btn" type="button" disabled={index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))}>
            <ArrowLeft size={16} /> Back
          </button>

          {index === steps.length - 1 ? (
            <button className="wide-btn" type="button" onClick={finish} style={{ width: "auto" }}>
              <CheckCircle2 size={16} /> Finish tour
            </button>
          ) : (
            <button className="wide-btn" type="button" onClick={() => setIndex((current) => Math.min(steps.length - 1, current + 1))} style={{ width: "auto" }}>
              Next <ArrowRight size={16} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
