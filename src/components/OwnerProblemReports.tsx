import { countProblemReports, parseProblemReport } from "../lib/problemReport";
import type { ParsedProblemReport } from "../lib/problemReport";

// The owner's view of what clients sent with "Report a problem": a short list with counts by kind, so a bug report or an idea is not lost among
// ordinary messages. It only reads the unread client messages the Owner Portal already loaded (no new query, no new table); a report leaves this
// list when the owner opens the client's chat and the messages are marked seen. Message text is shown as plain text, never as HTML.
type Row = { id: string; client_id: string | null; message: string; created_at: string };
type Props = { messages: Row[]; clientName: (clientId: string | null) => string; formatWhen: (value: string) => string; onOpen: (clientId: string | null) => void };

export function OwnerProblemReports({ messages, clientName, formatWhen, onOpen }: Props) {
  const reports = messages.map((row) => ({ row, report: parseProblemReport(row.message) })).filter((item): item is { row: Row; report: ParsedProblemReport } => item.report !== null);
  const counts = countProblemReports(reports.map((item) => item.report));
  return (
    <div className="owner-message-ping-panel" data-testid="owner-problem-reports">
      <div className="owner-message-ping-header">
        <strong>Problem reports and ideas</strong>
        <span>{reports.length} new</span>
      </div>
      {reports.length === 0 ? (
        <p className="subtle">No new problem reports or ideas from clients right now.</p>
      ) : (
        <>
          <p className="subtle">Broken: {counts.broken} · Confusing: {counts.confusing} · Ideas: {counts.idea} · Other: {counts.other}. Open one to reply in the client's chat.</p>
          <div className="owner-message-ping-list">
            {reports.slice(0, 8).map(({ row, report }) => (
              <button className="owner-message-ping" key={row.id} type="button" onClick={() => onOpen(row.client_id)}>
                <span>
                  <strong>{report.categoryLabel} · {clientName(row.client_id)}</strong>
                  <small>{formatWhen(row.created_at)} · page {report.page} · screen {report.screen}</small>
                </span>
                <p>{report.text || "(no details typed)"}</p>
              </button>
            ))}
          </div>
          {reports.length > 8 ? <p className="subtle">Showing the newest 8 of {reports.length}.</p> : null}
        </>
      )}
    </div>
  );
}
