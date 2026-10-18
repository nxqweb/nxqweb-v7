import { useEffect, useMemo, useState } from "react";
import { buildDeskRequest, deskTaskText, fixRequestText, type DeskRequest, type SetupField } from "../lib/aiDesk";
import { parseDeskReply, validateDeskResult } from "../lib/aiDeskCheck";

export type DeskClient = { id: string; name: string; businessType: string | null; fields: SetupField[] };

type Props = { clients: DeskClient[]; selectedId: string; onSelect: (id: string) => void };

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function OwnerAiDesk({ clients, selectedId, onSelect }: Props) {
  const client = clients.find((item) => item.id === selectedId) ?? null;
  const [request, setRequest] = useState<DeskRequest | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRequest(null);
    setMissing([]);
    setReply("");
    setNote("");
    if (!client) return;
    buildDeskRequest({ fields: client.fields, businessName: client.name, businessType: client.businessType || undefined }).then((built) => {
      if (cancelled) return;
      if (built.ok) setRequest(built.request);
      else setMissing(built.missing);
    });
    return () => { cancelled = true; };
  }, [client]);

  const verdict = useMemo(() => {
    if (!request || !reply.trim()) return null;
    const parsed = parseDeskReply(reply);
    if (!parsed.ok) return { good: false, problems: [parsed.error], notes: [] as string[] };
    const problems = validateDeskResult(parsed.value, request);
    return { good: problems.length === 0, problems, notes: parsed.notes };
  }, [request, reply]);

  async function copyTask() {
    if (!request) return;
    setNote((await copyText(deskTaskText(request))) ? "AI task copied. Paste it into your NXQX AI Desk chat." : "Your browser blocked copying. Click the page once, then try again.");
  }

  async function copyFix() {
    if (!verdict || verdict.good) return;
    setNote((await copyText(fixRequestText(verdict.problems))) ? "Fix request copied. Paste it into the AI Desk chat." : "Your browser blocked copying. Click the page once, then try again.");
  }

  return (
    <section className="owner-ai-desk" aria-labelledby="owner-ai-desk-title">
      <h3 id="owner-ai-desk-title">AI Desk</h3>
      <p className="subtle">Step 1: copy the task. Step 2: paste it into your NXQX AI Desk chat. Step 3: paste its reply below to check it.</p>
      {clients.length === 0 ? (
        <p className="subtle">No client has a signed setup sheet yet.</p>
      ) : (
        <>
          <label className="auth-label" htmlFor="ai-desk-client">Client</label>
          <select className="auth-input" id="ai-desk-client" value={selectedId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">Choose a client</option>
            {clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </>
      )}
      {client && missing.length > 0 ? (
        <p className="auth-error" role="alert">The setup sheet is missing: {missing.join(", ")}. Ask the client for these first.</p>
      ) : null}
      {request ? (
        <div className="owner-ai-desk-actions">
          <button className="wide-btn" type="button" onClick={copyTask}>Copy AI task</button>
          <label className="auth-label" htmlFor="ai-desk-reply">Paste the AI Desk reply here</label>
          <textarea className="auth-input" id="ai-desk-reply" rows={8} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Paste the JSON the AI Desk chat replied with" />
          {verdict ? (
            verdict.good ? (
              <p className="auth-success" role="status">
                Good to go. This reply passes every check the live pipeline will run (shape, limits, only your approved services and pages, no links, no invented claims).
                {verdict.notes.map((item) => ` ${item}`).join("")} Saving it to the client's project is not connected yet, so keep the reply with the client's notes for now.
              </p>
            ) : (
              <div role="alert" className="auth-error">
                <strong>Not ready. Fix these first:</strong>
                <ul>{verdict.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                <button className="wide-btn" type="button" onClick={copyFix}>Copy fix request</button>
              </div>
            )
          ) : null}
        </div>
      ) : null}
      {note ? <p className="subtle" role="status">{note}</p> : null}
    </section>
  );
}
