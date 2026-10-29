import { useEffect, useMemo, useRef, useState } from "react";
import { buildDeskRequest, deskTaskText, fixRequestText, type DeskRequest, type SetupField } from "../lib/aiDesk";
import { parseDeskReply, validateDeskResult } from "../lib/aiDeskCheck";
import type { AiDeskGateway, DeskStatus } from "../lib/aiDeskGateway";

export type DeskClient = { id: string; name: string; businessType: string | null; fields: SetupField[] };

// With a gateway (after the AI Desk migration is live) the SERVER hands out the exact task and saves the answer.
// Without one, the task is built here from the setup sheet and the reply is only checked, never saved.
type Props = { clients: DeskClient[]; selectedId: string; onSelect: (id: string) => void; gateway?: AiDeskGateway | null };

const POLL_MS = 10000;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function friendly(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Try again in a moment.";
}

export function OwnerAiDesk({ clients, selectedId, onSelect, gateway = null }: Props) {
  const client = clients.find((item) => item.id === selectedId) ?? null;
  const [localRequest, setLocalRequest] = useState<DeskRequest | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // The reply box and notes must survive the page reloading its data; they only reset when the owner picks another client or the setup sheet really changed.
  const clientId = client?.id ?? "";
  const contentKey = client ? JSON.stringify([client.name, client.businessType, client.fields]) : "";
  const clientRef = useRef(client);
  const currentId = useRef(clientId);
  useEffect(() => {
    clientRef.current = client;
    currentId.current = clientId;
  });

  async function refresh() {
    if (!gateway || !clientId) return;
    try {
      const next = await gateway.getStatus(clientId);
      if (currentId.current !== clientId) return;
      setStatus(next);
      setStatusError("");
    } catch (error) {
      if (currentId.current === clientId) setStatusError(friendly(error));
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLocalRequest(null);
    setMissing([]);
    setStatus(null);
    setStatusError("");
    setReply("");
    setNote("");
    const current = clientRef.current;
    if (!current) return;
    if (gateway) {
      gateway.getStatus(current.id).then((next) => { if (!cancelled) setStatus(next); }).catch((error) => { if (!cancelled) setStatusError(friendly(error)); });
    } else {
      buildDeskRequest({ fields: current.fields, businessName: current.name, businessType: current.businessType || undefined }).then((built) => {
        if (cancelled) return;
        if (built.ok) setLocalRequest(built.request);
        else setMissing(built.missing);
      });
    }
    return () => { cancelled = true; };
  }, [clientId, contentKey, gateway]);

  // While the pipeline is still preparing the task (or still using a saved answer), look again every few seconds.
  useEffect(() => {
    if (!gateway || !clientId || !status || (status.status !== "none" && status.status !== "saved")) return;
    const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, clientId, status]);

  const request = gateway ? status?.request ?? null : localRequest;

  const verdict = useMemo(() => {
    if (!request || !reply.trim()) return null;
    const parsed = parseDeskReply(reply);
    if (!parsed.ok) return { good: false, problems: [parsed.error], notes: [] as string[], value: null as unknown };
    const problems = validateDeskResult(parsed.value, request);
    return { good: problems.length === 0, problems, notes: parsed.notes, value: parsed.value as unknown };
  }, [request, reply]);

  async function copyTask() {
    if (!request) return;
    setNote((await copyText(deskTaskText(request))) ? "AI task copied. Paste it into your NXQX AI Desk chat." : "Your browser blocked copying. Click the page once, then try again.");
  }

  async function pasteReply() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setNote("Your clipboard is empty. Copy the AI Desk reply first, then press this again."); return; }
      setReply(text);
      setNote("");
    } catch {
      setNote("Your browser would not let me read the clipboard. Paste the reply into the box below instead.");
    }
  }

  async function copyFix() {
    if (!verdict || verdict.good) return;
    setNote((await copyText(fixRequestText(verdict.problems))) ? "Fix request copied. Paste it into the AI Desk chat." : "Your browser blocked copying. Click the page once, then try again.");
  }

  async function save() {
    if (!gateway || !client || !verdict?.good || saving) return;
    const savingFor = client.id;
    setSaving(true);
    try {
      await gateway.save(savingFor, verdict.value);
      if (currentId.current === savingFor) {
        setReply("");
        setNote("Saved. The pipeline will use it on its next run, usually within a minute.");
        await refresh();
      }
    } catch (error) {
      setNote(`Could not save: ${friendly(error)}`);
    } finally {
      setSaving(false);
    }
  }

  const serverWaiting = gateway ? status?.status === "waiting" : false;
  const showWorkArea = gateway ? serverWaiting && Boolean(request) : Boolean(request);

  return (
    <section className="owner-ai-desk" aria-labelledby="owner-ai-desk-title">
      <h3 id="owner-ai-desk-title">AI Desk</h3>
      <p className="subtle">Step 1: copy the task. Step 2: paste it into your NXQX AI Desk chat. Step 3: copy the chat's reply, then press Paste and check{gateway ? ", then Save." : "."}</p>
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
      {client && !gateway && missing.length > 0 ? (
        <p className="auth-error" role="alert">The setup sheet is missing: {missing.join(", ")}. Ask the client for these first.</p>
      ) : null}
      {client && gateway && statusError ? <p className="auth-error" role="alert">{statusError}</p> : null}
      {client && gateway && status ? (
        <div className="owner-ai-desk-status" role="status">
          {status.status === "none" ? <p>No task yet. After you approve this client, the pipeline prepares it, usually within a minute. This page checks again by itself.</p> : null}
          {status.status === "saved" ? <p>Your answer is saved. The pipeline will use it on its next run, usually within a minute.</p> : null}
          {status.status === "used" ? <p>Done: your answer was used{status.usedAt ? ` on ${new Date(status.usedAt).toLocaleString()}` : ""}. The plan is in the client's project.</p> : null}
          {status.lastError ? <p className="auth-error">The last answer was refused by the pipeline: {status.lastError} Copy the task again and ask the AI Desk for a fresh answer.</p> : null}
          <button className="wide-btn" type="button" onClick={() => void refresh()}>Check again</button>
        </div>
      ) : null}
      {showWorkArea ? (
        <div className="owner-ai-desk-actions">
          <button className="wide-btn" type="button" onClick={copyTask}>Copy AI task</button>
          <button className="wide-btn" type="button" onClick={pasteReply}>Paste and check the AI Desk reply</button>
          <label className="auth-label" htmlFor="ai-desk-reply">Or paste the reply into this box</label>
          <textarea className="auth-input" id="ai-desk-reply" rows={8} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Paste the JSON the AI Desk chat replied with" />
          {verdict ? (
            verdict.good ? (
              <div className="auth-success" role="status">
                <p>
                  Good to go. This reply passes every check the live pipeline will run (shape, limits, only your approved services and pages, no links, no invented claims).
                  {verdict.notes.map((item) => ` ${item}`).join("")}
                </p>
                {gateway ? (
                  <button className="wide-btn" type="button" disabled={saving} onClick={save}>{saving ? "Saving..." : "Save to project"}</button>
                ) : (
                  <p>Saving it to the client's project is not connected yet, so keep the reply with the client's notes for now.</p>
                )}
              </div>
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
