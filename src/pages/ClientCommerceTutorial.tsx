import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, CircleHelp, ExternalLink, RotateCcw, TriangleAlert } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import {
  guideProgress, launchGuideSteps, nextStepIndex, readAutoOff, readDoneSteps, toggleStepDone, writeAutoOff, writeDoneSteps,
} from "../lib/commerceLaunchGuide";

export function ClientCommerceTutorial() {
  const [done, setDone] = useState<string[]>(() => readDoneSteps());
  const [autoOff, setAutoOff] = useState(() => readAutoOff());
  const [stepIndex, setStepIndex] = useState(() => nextStepIndex(readDoneSteps()));
  const step = launchGuideSteps[stepIndex];
  const progress = guideProgress(done);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    void supabase.auth.getSession().then((sessionResult) => {
      if (!sessionResult.data.session) window.location.replace("/portal/login");
    });
  }, []);

  function updateDone(next: string[]) { setDone(next); writeDoneSteps(next); }
  function toggleDone() { updateDone(toggleStepDone(done, step.id)); }
  function replay() { updateDone([]); setStepIndex(0); }
  function changeAutoOff(off: boolean) { setAutoOff(off); writeAutoOff(off); }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <CommerceNav />
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <CircleHelp size={24} />
            <div>
              <h1>Launch your store, step by step</h1>
              <p className="subtle">Six short steps from an empty store to your first order. Replay it any time.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/commerce"><ArrowLeft size={16} /> Back to Commerce</a>
        </div>

        <section className="panel panel-wide">
          <div className="panel-title panel-title-row">
            <div><span className="subtle">{progress.complete ? "All steps done" : `${progress.count} of ${progress.total} steps done`}</span></div>
            <strong>{progress.percent}%</strong>
          </div>
          <div className="usage-progress" aria-label={`Guide ${progress.percent}% complete`}><span style={{ width: `${progress.percent}%` }} /></div>
          <ol className="guide-step-list" style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0", display: "grid", gap: "0.4rem" }}>
            {launchGuideSteps.map((item, index) => (
              <li key={item.id}>
                <button
                  className={index === stepIndex ? "wide-btn" : "icon-btn"}
                  type="button"
                  aria-current={index === stepIndex ? "step" : undefined}
                  onClick={() => setStepIndex(index)}
                  style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                >
                  {done.includes(item.id) ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                  <span>{index + 1}. {item.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel panel-wide">
          <span className="subtle">Step {stepIndex + 1} of {launchGuideSteps.length}</span>
          <h2>{step.title}</h2>
          <p>{step.summary}</p>
          <ol style={{ paddingLeft: "1.25rem", display: "grid", gap: "0.4rem" }}>
            {step.doThis.map((line) => <li key={line}>{line}</li>)}
          </ol>
          <div className="notice-card"><strong><TriangleAlert size={16} /> Watch out</strong><p>{step.watchOut}</p></div>
          <a className="wide-btn" href={step.href}><ExternalLink size={17} /> {step.action}</a>
          <button className="icon-btn" type="button" onClick={toggleDone} aria-pressed={done.includes(step.id)}>
            {done.includes(step.id) ? <><CheckCircle2 size={17} /> Done (tap to undo)</> : <><Circle size={17} /> Mark this step done</>}
          </button>
        </section>

        <section className="panel panel-wide">
          <div className="setup-form-grid">
            <button className="icon-btn" type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={17} /> Previous</button>
            <button className="wide-btn" type="button" disabled={stepIndex === launchGuideSteps.length - 1} onClick={() => setStepIndex((current) => Math.min(launchGuideSteps.length - 1, current + 1))}>Next <ArrowRight size={17} /></button>
          </div>
        </section>

        <section className="panel panel-wide">
          <label style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <input type="checkbox" checked={!autoOff} onChange={(event) => changeAutoOff(!event.target.checked)} />
            <span>Remind me about this guide on my Commerce dashboard until I finish it</span>
          </label>
          <p className="subtle">This is saved in this browser only. The guide never changes your store.</p>
          <button className="icon-btn" type="button" onClick={replay}><RotateCcw size={17} /> Start over from step 1</button>
        </section>
      </section>
    </main>
  );
}
