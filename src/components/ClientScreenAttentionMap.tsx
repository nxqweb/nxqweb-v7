import { useEffect, useState } from "react";
import { attentionCopy, attentionDayChoices, attentionErrorMessage, attentionGrid, attentionLevel, attentionOffMessage, attentionPlace, attentionSentence, type AttentionMap, type ScreenAttentionGateway } from "../lib/screenAttentionMap";

// Client page body for the screen attention map. Nothing is drawn unless the database returned real, privacy-checked cells; every other case says in plain words why.
export function ClientScreenAttentionMap({ gateway }: { gateway: ScreenAttentionGateway | null }) {
  const [page, setPage] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [map, setMap] = useState<AttentionMap | null>(null);
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(Boolean(gateway));

  useEffect(() => {
    if (!gateway) return;
    let alive = true;
    setLoading(true);
    void gateway.load(page, days).then((next) => { if (alive) { setMap(next); setProblem(""); setLoading(false); } })
      .catch((failure) => { if (alive) { setProblem(attentionErrorMessage(failure)); setLoading(false); } });
    return () => { alive = false; };
  }, [gateway, page, days]);

  const shell = (body: React.ReactNode) => (
    <main className="nxq-page"><section className="portal-shell" aria-labelledby="attention-title">
      <p><a href="/client">Back to my portal</a></p>
      <h1 id="attention-title">{attentionCopy.title}</h1>
      {body}
    </section></main>
  );

  if (!gateway) return shell(<p role="status" data-testid="attention-not-on">{attentionCopy.notOn}</p>);
  if (loading && !map) return shell(<p role="status">Loading...</p>);
  if (problem && !map) return shell(<p role="alert" data-testid="attention-problem">{problem}</p>);
  if (!map) return shell(null);
  if (!map.enabled) return shell(<p role="status" data-testid="attention-off">{attentionOffMessage(map.reason)}</p>);

  const grid = attentionGrid(map.cells, map.cols, map.rows);
  const max = Math.max(0, ...grid.flat());
  return shell(
    <>
      <p>{attentionCopy.how}</p>
      <p>{attentionCopy.privacy}</p>
      {problem ? <p role="alert">{problem}</p> : null}
      <div className="form-row">
        <label>Page{" "}
          <select value={map.page ?? ""} onChange={(event) => setPage(event.target.value || null)} disabled={!map.pages.length}>
            {map.pages.map((item) => <option key={item.path} value={item.path}>{item.path} ({item.sessions} visits)</option>)}
          </select>
        </label>
        {" "}
        <label>Time{" "}
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {attentionDayChoices.map((choice) => <option key={choice} value={choice}>Last {choice} days</option>)}
          </select>
        </label>
      </div>
      {!map.pages.length || !map.cells.length ? <p role="status" data-testid="attention-empty">{attentionCopy.empty}</p> : (
        <>
          <p data-testid="attention-sentence">{attentionSentence(map)}</p>
          <div role="img" aria-label={`Screen attention map. ${attentionSentence(map)}`} data-testid="attention-grid"
            style={{ display: "grid", gridTemplateColumns: `repeat(${map.cols}, 1fr)`, gap: 2, maxWidth: 640, aspectRatio: `${map.cols} / ${map.rows}`, border: "1px solid currentColor", padding: 2 }}>
            {grid.flatMap((row, y) => row.map((points, x) => {
              const level = attentionLevel(points, max);
              return <div key={`${x}-${y}`} data-level={level} title={points ? `${attentionPlace(x, y, map.cols, map.rows)}: ${points} readings` : undefined}
                style={{ background: level ? `color-mix(in srgb, currentColor ${level * 18}%, transparent)` : "transparent", outline: "1px solid color-mix(in srgb, currentColor 10%, transparent)" }} />;
            }))}
          </div>
          <p><small>Top of the grid is the top of the visitor's screen. Left is left.</small></p>
        </>
      )}
    </>
  );
}
