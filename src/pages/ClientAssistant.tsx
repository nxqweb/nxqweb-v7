import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ASSISTANT_LIMITS, DEFAULT_FALLBACK, DEFAULT_GREETING, STARTER_QUESTIONS, UNANSWERED_LIMIT, checkEntryInput, emptyAssistantState, friendlyAssistantError, previewAnswer, splitAlternatives,
  type AssistantEntry, type AssistantState, type PreviewResult, type SiteAssistantGateway,
} from "../lib/siteAssistant";

// "My assistant": the business writes the questions customers ask and the answers; a small button on its website shows the matching answer to visitors.
// It is NOT AI. It only ever says what the business wrote here, and when it is not sure it points visitors to the contact form.
type Draft = { id: string | null; question: string; alts: string; answer: string; enabled: boolean };
const blankDraft = (question = ""): Draft => ({ id: null, question, alts: "", answer: "", enabled: true });
const draftKey = (draft: Draft) => JSON.stringify([draft.question, draft.alts, draft.answer, draft.enabled]);

export function ClientAssistant({ gateway }: { gateway: SiteAssistantGateway | null }) {
  const [state, setState] = useState<AssistantState>(emptyAssistantState);
  const [loaded, setLoaded] = useState(false); // true once the first load has worked: from then on the page never disappears because a refresh failed
  const [loadFinished, setLoadFinished] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftStart, setDraftStart] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [greeting, setGreeting] = useState("");
  const [fallback, setFallback] = useState("");
  const [tryText, setTryText] = useState("");
  const [tryResult, setTryResult] = useState<PreviewResult | null>(null);
  const questionRef = useRef<HTMLInputElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const answersHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const messagesDirtyRef = useRef(false);
  // Typing in either message box marks them as edited (the ref is read by reload; it is only written in event handlers).
  const markMessagesEdited = () => { messagesDirtyRef.current = true; };

  // Returns whether it worked. The typed greeting and not-sure message are only replaced by the saved ones while the owner has not started editing them.
  const reload = useCallback(async () => {
    if (!gateway) { setLoadFinished(true); return true; }
    try {
      const next = await gateway.load();
      setState(next);
      if (!messagesDirtyRef.current) { setGreeting(next.settings.greeting); setFallback(next.settings.fallbackText); }
      setLoaded(true); setRefreshWarning(false); setLoadFinished(true);
      return true;
    } catch {
      setRefreshWarning(true); setLoadFinished(true);
      return false;
    }
  }, [gateway]);
  useEffect(() => { void reload(); }, [reload]);
  // What "Try it" showed is about the saved answers; once they change, the old reply would be stale.
  useEffect(() => { setTryResult(null); }, [state]);
  useEffect(() => { if (draft && questionRef.current) questionRef.current.focus(); }, [draft?.id, draft === null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<void>, done: string) {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (failure) { setError(friendlyAssistantError(failure)); setBusy(false); return false; }
    const refreshed = await reload();
    setNotice(refreshed ? done : `${done} (The list could not be refreshed. Press "Try again" below.)`);
    setBusy(false);
    return true;
  }

  const enabledCount = state.entries.filter((entry) => entry.enabled).length;
  const draftDirty = draft !== null && draftKey(draft) !== draftStart;
  const discardOk = () => !draftDirty || window.confirm("Throw away what you have typed for this answer?");

  // The switch saves ONLY on/off, using the messages that are already saved: text typed in the two boxes is not saved by accident.
  async function setEnabled(enabled: boolean) {
    if (!gateway) return;
    await run(() => gateway.saveSettings({ enabled, greeting: state.settings.greeting, fallbackText: state.settings.fallbackText }), enabled ? "Saved. The assistant is on." : "Saved. The assistant is off.");
  }
  async function saveMessages() {
    if (!gateway) return;
    const trimmedGreeting = greeting.trim(); const trimmedFallback = fallback.trim();
    if (trimmedGreeting.length > 200) { setError("The greeting must be 200 characters or fewer."); return; }
    if (trimmedFallback.length > 300) { setError('The "not sure" message must be 300 characters or fewer.'); return; }
    const saved = await run(() => gateway.saveSettings({ enabled: state.settings.enabled, greeting: trimmedGreeting, fallbackText: trimmedFallback }), "Saved. Your two messages are updated.");
    if (saved) { messagesDirtyRef.current = false; setGreeting(trimmedGreeting); setFallback(trimmedFallback); }
  }

  async function saveDraft() {
    if (!gateway || !draft) return;
    const input = { question: draft.question.trim(), altPhrasings: splitAlternatives(draft.alts), answer: draft.answer.trim() };
    const found = checkEntryInput(input);
    setProblems(found);
    if (found.length > 0) return;
    const saved = await run(() => gateway.saveEntry({ id: draft.id, ...input, enabled: draft.enabled }), draft.id ? "Answer saved." : "Answer added.");
    if (saved) { setDraft(null); setDraftStart(""); window.setTimeout(() => addRef.current?.focus(), 0); }
  }

  function openDraft(next: Draft) {
    if (!discardOk()) return;
    setProblems([]); setError(""); setNotice("");
    setDraft(next); setDraftStart(draftKey(next));
  }
  const edit = (entry: AssistantEntry) => openDraft({ id: entry.id, question: entry.question, alts: entry.altPhrasings.join("\n"), answer: entry.answer, enabled: entry.enabled });
  const startNew = (question = "") => openDraft(blankDraft(question));
  function cancelDraft() {
    if (!discardOk()) return;
    setDraft(null); setDraftStart(""); setProblems([]);
    window.setTimeout(() => addRef.current?.focus(), 0);
  }
  // After something is removed from a list, focus would fall to the page; put it somewhere sensible instead.
  const afterRemoval = () => window.setTimeout(() => answersHeadingRef.current?.focus(), 0);

  if (!gateway) {
    return (
      <main className="nxq-page"><section className="portal-shell">
        <div className="panel-title panel-title-row"><div className="panel-title"><MessageCircle size={22} /><h1>My assistant</h1></div><a className="icon-btn" href="/client"><ArrowLeft size={16} /> Client portal</a></div>
        <div className="empty-state" role="status">The website assistant is not switched on for your account yet.</div>
      </section></main>
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell assistant-page">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <MessageCircle size={22} />
            <div><h1>My assistant</h1><p className="subtle">Answers to the questions your customers ask, shown on your website.</p></div>
          </div>
          <a className="icon-btn" href="/client"><ArrowLeft size={16} /> Client portal</a>
        </div>

        <div className="notice-card" data-testid="assistant-explainer">
          <strong>How it works</strong>
          <p>You write the questions customers ask and the answers. A small "Ask a question" button on your website shows visitors the matching answer. It is <strong>not AI</strong>:
            it only ever says what you wrote here. If it is not sure, it says so and points visitors to your contact form. Your website team adds the button to your site, and until then nothing shows to visitors.</p>
        </div>

        {!loadFinished ? <div className="empty-state" role="status">Loading...</div> : null}
        {loadFinished && !loaded ? (
          <div className="auth-error" role="alert" data-testid="assistant-load-error">
            Your assistant could not be loaded right now. Please try again shortly.
            <div><button className="icon-btn" onClick={() => { setLoadFinished(false); void reload(); }} type="button">Try again</button></div>
          </div>
        ) : null}
        {loaded && refreshWarning ? (
          <div className="notice-card warning" role="alert" data-testid="assistant-refresh-warning">
            The latest changes could not be loaded, so what you see may be out of date. <button className="icon-btn" onClick={() => void reload()} type="button">Try again</button>
          </div>
        ) : null}
        <div aria-live="polite">{notice ? <div className="auth-success" role="status" data-testid="assistant-notice">{notice}</div> : null}</div>
        {error ? <div className="auth-error" role="alert" data-testid="assistant-error">{error}</div> : null}

        {loaded ? (
          <>
            <section className="panel panel-wide" aria-labelledby="assistant-settings-title">
              <h2 id="assistant-settings-title">Show it on my website</h2>
              <label className="settings-card assistant-switch">
                <span>Turn the assistant on</span>
                <input checked={state.settings.enabled} disabled={busy || (!state.settings.enabled && enabledCount === 0)} onChange={(event) => void setEnabled(event.target.checked)} type="checkbox" />
              </label>
              <p className="subtle">{state.settings.enabled ? "On: the assistant answers questions once your website team has added the button to your site." : enabledCount === 0 ? "Add at least one answer below, then you can turn it on." : "Off: nothing is shown to visitors. Turning it on means it will answer questions once your website team has added the button to your site."}</p>
              <label className="auth-label" htmlFor="assistant-greeting">What the assistant says first <small>(optional, up to 200 characters)</small></label>
              <input className="auth-input" id="assistant-greeting" maxLength={200} onChange={(event) => { setGreeting(event.target.value); markMessagesEdited(); }} placeholder={DEFAULT_GREETING} value={greeting} />
              <label className="auth-label" htmlFor="assistant-fallback">What it says when it is not sure <small>(optional, up to 300 characters)</small></label>
              <input className="auth-input" id="assistant-fallback" maxLength={300} onChange={(event) => { setFallback(event.target.value); markMessagesEdited(); }} placeholder={DEFAULT_FALLBACK} value={fallback} />
              <p className="subtle">No web links in these messages. Visitors are also shown a link to your contact form.</p>
              <button className="wide-btn" disabled={busy} onClick={() => void saveMessages()} type="button">Save these two messages</button>
            </section>

            <section className="panel panel-wide" aria-labelledby="assistant-answers-title">
              <div className="panel-title panel-title-row">
                <h2 id="assistant-answers-title" ref={answersHeadingRef} tabIndex={-1}>My answers <small>({state.entries.length} of {ASSISTANT_LIMITS.entries})</small></h2>
                <button className="icon-btn" data-testid="assistant-add" disabled={busy || state.entries.length >= ASSISTANT_LIMITS.entries} onClick={() => startNew()} ref={addRef} type="button"><Plus size={16} /> Add an answer</button>
              </div>
              {state.entries.length === 0 && !draft ? (
                <div className="empty-state">
                  <p>No answers yet. Start with a question customers often ask:</p>
                  <div className="assistant-starters">{STARTER_QUESTIONS.map((question) => <button className="icon-btn" key={question} onClick={() => startNew(question)} type="button">{question}</button>)}</div>
                </div>
              ) : null}

              {draft ? (
                <form className="assistant-form" data-testid="assistant-form" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
                  <fieldset className="assistant-fieldset" disabled={busy}>
                    <h3>{draft.id ? "Edit this answer" : "New answer"}</h3>
                    <label className="auth-label" htmlFor="assistant-question">The question a customer might ask <em className="required-mark">(required)</em></label>
                    <input className="auth-input" id="assistant-question" maxLength={ASSISTANT_LIMITS.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} ref={questionRef} value={draft.question} />
                    <label className="auth-label" htmlFor="assistant-alts">Other ways they might ask it <small>(optional, one per line, up to {ASSISTANT_LIMITS.altPhrasings})</small></label>
                    <textarea className="auth-input" id="assistant-alts" onChange={(event) => setDraft({ ...draft, alts: event.target.value })} placeholder={"When are you open\nWhat time do you close"} rows={3} value={draft.alts} />
                    <label className="auth-label" htmlFor="assistant-answer">Your answer <em className="required-mark">(required, plain text, no web links)</em></label>
                    <textarea className="auth-input" id="assistant-answer" maxLength={ASSISTANT_LIMITS.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} rows={4} value={draft.answer} />
                    <label className="settings-card assistant-switch"><span>Show this answer</span><input checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} type="checkbox" /></label>
                    {problems.length > 0 ? <div className="auth-error" role="alert" data-testid="assistant-problems"><ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div> : null}
                    <div className="settings-grid">
                      <button className="wide-btn" type="submit">{busy ? "Saving..." : "Save answer"}</button>
                      <button className="icon-btn" onClick={cancelDraft} type="button">Cancel</button>
                    </div>
                  </fieldset>
                </form>
              ) : null}

              <ul className="assistant-list">
                {state.entries.map((entry) => (
                  <li className="settings-card" data-testid="assistant-entry" key={entry.id}>
                    <strong>{entry.question}</strong>
                    {!entry.enabled ? <span className="scan-pill"> Hidden</span> : null}
                    <p>{entry.answer}</p>
                    {entry.altPhrasings.length > 0 ? <p className="subtle">Also matches: {entry.altPhrasings.join(" · ")}</p> : null}
                    <div className="settings-grid">
                      <button aria-label={`Edit answer: ${entry.question}`} className="icon-btn" disabled={busy} onClick={() => edit(entry)} type="button"><Pencil size={15} /> Edit</button>
                      <button aria-label={`${entry.enabled ? "Hide" : "Show"} answer: ${entry.question}`} className="icon-btn" disabled={busy} onClick={() => void run(() => gateway.saveEntry({ id: entry.id, question: entry.question, altPhrasings: entry.altPhrasings, answer: entry.answer, enabled: !entry.enabled }), entry.enabled ? "Answer hidden." : "Answer shown.")} type="button">{entry.enabled ? "Hide" : "Show"}</button>
                      <button aria-label={`Delete answer: ${entry.question}`} className="icon-btn" disabled={busy} onClick={() => { if (window.confirm(`Delete the answer to "${entry.question}"?`)) void run(() => gateway.deleteEntry(entry.id), "Answer deleted.").then(afterRemoval); }} type="button"><Trash2 size={15} /> Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel panel-wide" aria-labelledby="assistant-try-title">
              <h2 id="assistant-try-title">Try it</h2>
              <p className="subtle">Type a question the way a customer would. This shows what a visitor would see, using your saved answers and your saved "not sure" message.</p>
              <form className="assistant-try" onSubmit={(event) => { event.preventDefault(); setTryResult(previewAnswer(tryText, state.entries, state.settings.fallbackText)); }}>
                <label className="auth-label" htmlFor="assistant-try-input">A test question</label>
                <input className="auth-input" id="assistant-try-input" maxLength={ASSISTANT_LIMITS.visitorQuestion} onChange={(event) => setTryText(event.target.value)} value={tryText} />
                <button className="wide-btn" type="submit">Show me the reply</button>
              </form>
              <div aria-live="polite">
                {tryResult ? (
                  <div className={tryResult.kind === "answer" ? "auth-success" : "notice-card"} data-testid="assistant-try-result">
                    <p><strong>A visitor would see:</strong> {tryResult.text}</p>
                    {tryResult.kind === "unsure" ? <p className="subtle">{tryResult.why}</p> : null}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="panel panel-wide" aria-labelledby="assistant-unanswered-title">
              <h2 id="assistant-unanswered-title">Questions visitors asked that had no answer</h2>
              <p className="subtle">Add an answer to the ones that come up. We try not to keep phone numbers, email addresses or web links that visitors type, and we keep at most {UNANSWERED_LIMIT} questions (the ones asked least often go first).</p>
              {state.unanswered.length === 0 ? <div className="empty-state">Nothing yet.</div> : (
                <ul className="assistant-list">
                  {state.unanswered.map((item) => (
                    <li className="settings-card" data-testid="assistant-unanswered" key={item.id}>
                      <strong>{item.question}</strong> <span className="subtle">asked {item.timesAsked} {item.timesAsked === 1 ? "time" : "times"}</span>
                      <div className="settings-grid">
                        <button aria-label={`Add an answer for: ${item.question}`} className="icon-btn" disabled={busy || state.entries.length >= ASSISTANT_LIMITS.entries} onClick={() => startNew(item.question)} type="button">Add an answer</button>
                        <button aria-label={`Dismiss: ${item.question}`} className="icon-btn" disabled={busy} onClick={() => void run(() => gateway.dismissQuestion(item.id), "Dismissed.").then(afterRemoval)} type="button">Dismiss</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
