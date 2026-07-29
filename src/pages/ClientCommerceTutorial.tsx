import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, ExternalLink, RotateCcw } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";

const tutorialSteps = [
  {
    title: "Welcome to NXQ Commerce",
    text: "Your Commerce workspace keeps products, images, categories, inventory, orders, customer requests, usage limits, and launch setup in one place.",
    href: "/client/commerce",
    action: "Open dashboard",
  },
  {
    title: "Finish store setup",
    text: "Confirm what you sell, fulfillment methods, shipping regions, pickup details, taxes, policies, design direction, and migration needs. Saving setup never publishes the store or activates payments.",
    href: "/client/commerce/setup",
    action: "Review setup",
  },
  {
    title: "Create products and variants",
    text: "Add product names, descriptions, prices, SKUs, options, custom facts, and inventory rules. Products remain drafts until the storefront is approved for launch.",
    href: "/client/commerce/products",
    action: "Open products",
  },
  {
    title: "Organize the catalog",
    text: "Upload product images, write alt text, choose primary images, assign categories, and control product order before customers see the catalog.",
    href: "/client/commerce/catalog",
    action: "Open catalog",
  },
  {
    title: "Manage inventory safely",
    text: "On hand is physical stock. Reserved stock is held for open orders. Available stock is on hand minus reserved. Guarded adjustments require a reason so changes stay traceable.",
    href: "/client/commerce/inventory",
    action: "Open inventory",
  },
  {
    title: "Process orders",
    text: "New orders move through approved fulfillment stages. Cancelling releases reserved units, while delivery converts reserved units into completed inventory deductions.",
    href: "/client/commerce/orders",
    action: "Open orders",
  },
  {
    title: "Handle customer requests",
    text: "Customers can request custom products, restocks, bulk orders, or new options without creating an order. You control the request status and internal notes.",
    href: "/client/commerce/requests",
    action: "Open requests",
  },
  {
    title: "Preview and prepare for launch",
    text: "Preview shows saved Commerce data without making the store live. NXQ checks policies, shipping, taxes, inventory, storefront content, security, and payment readiness separately before publication.",
    href: "/client/commerce/preview",
    action: "Open preview",
  },
];

const storageKey = "nxq-commerce-tutorial-complete";

export function ClientCommerceTutorial() {
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState(() => window.localStorage.getItem(storageKey) === "true");
  const step = tutorialSteps[stepIndex];
  const progress = useMemo(() => Math.round(((stepIndex + 1) / tutorialSteps.length) * 100), [stepIndex]);

  function finishTutorial() {
    window.localStorage.setItem(storageKey, "true");
    setCompleted(true);
  }

  function restartTutorial() {
    window.localStorage.removeItem(storageKey);
    setCompleted(false);
    setStepIndex(0);
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <CommerceNav />
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <CircleHelp size={24} />
            <div>
              <h1>Commerce tutorial</h1>
              <p className="subtle">A replayable walkthrough for every part of the client Commerce workspace.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/commerce"><ArrowLeft size={16} /> Back to Commerce</a>
        </div>

        {completed ? (
          <section className="panel panel-wide">
            <div className="panel-title"><CheckCircle2 size={22} /><div><h2>Tutorial completed</h2><p className="subtle">You can replay it any time from the Commerce navigation.</p></div></div>
            <button className="wide-btn" type="button" onClick={restartTutorial}><RotateCcw size={17} /> Replay tutorial</button>
          </section>
        ) : (
          <>
            <section className="panel panel-wide">
              <div className="panel-title panel-title-row">
                <div><span className="subtle">Step {stepIndex + 1} of {tutorialSteps.length}</span><h2>{step.title}</h2></div>
                <strong>{progress}%</strong>
              </div>
              <div className="usage-progress" aria-label={`Tutorial ${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
              <p>{step.text}</p>
              <a className="wide-btn" href={step.href}><ExternalLink size={17} /> {step.action}</a>
            </section>

            <section className="panel panel-wide">
              <div className="setup-form-grid">
                <button className="icon-btn" type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={17} /> Previous</button>
                {stepIndex < tutorialSteps.length - 1 ? (
                  <button className="wide-btn" type="button" onClick={() => setStepIndex((current) => Math.min(tutorialSteps.length - 1, current + 1))}>Next <ArrowRight size={17} /></button>
                ) : (
                  <button className="wide-btn" type="button" onClick={finishTutorial}><CheckCircle2 size={17} /> Finish tutorial</button>
                )}
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
