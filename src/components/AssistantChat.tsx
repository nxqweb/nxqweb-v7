import { useRef, useState } from "react";
import { Bot, Send, UserRound } from "lucide-react";
import { answerQuestion, suggestedQuestions, teamMessage, type AssistantLink } from "../lib/assistantAnswers";

type Turn = { id: number; from: "you" | "assistant"; text: string; link?: AssistantLink; offerTeam?: string };

// Ask-the-assistant chat for the client portal. Instant answers come from a prepared list (see assistantAnswers.ts). Only when the client presses
// "Send to the NXQX team" does anything leave the screen, and it goes through the normal portal message, so the team reply shows in Message history.
export function AssistantChat({ canSend, sendToTeam }: { canSend: boolean; sendToTeam: (text: string) => Promise<boolean> }) {
  const [turns, setTurns] = useState<Turn[]>([{ id: 0, from: "assistant", text: "Hi! Ask me about your website or store. I answer common questions instantly. If I cannot help, I can send it to the NXQX team." }]);
  const [draft, setDraft] = useState("");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [sentIds, setSentIds] = useState<number[]>([]);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement | null>(null);

  function ask(question: string) {
    const clean = question.trim();
    if (!clean) return;
    const reply = answerQuestion(clean);
    const youId = nextId.current++;
    const botId = nextId.current++;
    setTurns((current) => [...current, { id: youId, from: "you", text: clean }, { id: botId, from: "assistant", text: reply.text, link: reply.link, offerTeam: reply.offerTeam ? clean : undefined }]);
    setDraft("");
    window.setTimeout(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, 0);
  }

  async function send(turn: Turn) {
    if (!turn.offerTeam || sendingId !== null) return;
    setSendingId(turn.id);
    const ok = await sendToTeam(teamMessage(turn.offerTeam));
    setSendingId(null);
    const id = nextId.current++;
    if (ok) setSentIds((current) => [...current, turn.id]);
    setTurns((current) => [...current, { id, from: "assistant", text: ok ? "Done. I sent that to the NXQX team. Their reply will show up in your message history below." : "I could not send that just now. Nothing was sent. Please try again in a moment." }]);
  }

  return (
    <section className="panel panel-wide assistant-chat" data-testid="assistant-chat" aria-label="Ask the NXQX assistant">
      <div className="panel-title"><Bot size={20} /><div><h2>Ask the NXQX assistant</h2><p className="subtle">Instant answers to common questions. Not a person: for anything it cannot answer, one button sends it to the team.</p></div></div>
      <div className="assistant-log" ref={logRef} role="log" aria-live="polite" tabIndex={0} aria-label="Conversation">
        {turns.map((turn) => (
          <div key={turn.id} className={`assistant-turn assistant-${turn.from}`}>
            <span className="assistant-who">{turn.from === "you" ? <><UserRound size={14} /> You</> : <><Bot size={14} /> Assistant</>}</span>
            <p>{turn.text}</p>
            {turn.link ? <a className="icon-btn" href={turn.link.href}>{turn.link.label}</a> : null}
            {turn.offerTeam ? <button className="wide-btn" type="button" disabled={!canSend || sendingId !== null || sentIds.includes(turn.id)} onClick={() => void send(turn)}>{sentIds.includes(turn.id) ? "Sent to the team" : sendingId === turn.id ? "Sending..." : "Send this to the NXQX team"}</button> : null}
          </div>
        ))}
      </div>
      <div className="assistant-suggestions" role="group" aria-label="Suggested questions">
        {suggestedQuestions.map((question) => <button key={question} className="icon-btn" type="button" onClick={() => ask(question)}>{question}</button>)}
      </div>
      <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
        <label className="auth-label" htmlFor="assistant-question"><span>Your question</span></label>
        <textarea id="assistant-question" className="auth-input" rows={2} maxLength={500} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Example: What is SEO?" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(draft); } }} />
        <button className="wide-btn" type="submit" disabled={!draft.trim()}><Send size={16} /> Ask</button>
      </form>
    </section>
  );
}
