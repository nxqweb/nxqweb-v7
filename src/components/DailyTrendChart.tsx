import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import "../styles/trend-chart.css";

export type TrendPoint = { date: string; value: number };

const W = 640;
const H = 200;
const PAD = { l: 44, r: 16, t: 12, b: 26 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

// Integer-friendly axis: four equal steps of 1, 2, 5 or 10 x 10^n, so ticks are never fractions of a visit.
function niceStep(maxValue: number) {
  const raw = Math.max(1, maxValue) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.max(1, mult * pow);
}

function parseDay(date: string) {
  return new Date(`${date}T00:00:00`);
}

function shortDay(date: string) {
  return parseDay(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DailyTrendChart({ title, points, valueLabel }: { title: string; points: TrendPoint[]; valueLabel: string }) {
  const [active, setActive] = useState<number | null>(null);
  const count = points.length;
  const maxValue = points.reduce((max, point) => Math.max(max, point.value), 0);
  const step = niceStep(maxValue);
  const axisMax = step * 4;
  const total = points.reduce((sum, point) => sum + point.value, 0);

  const xAt = (index: number) => PAD.l + (count <= 1 ? PLOT_W / 2 : (index / (count - 1)) * PLOT_W);
  const yAt = (value: number) => PAD.t + PLOT_H - (value / axisMax) * PLOT_H;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)} ${yAt(point.value).toFixed(1)}`).join(" ");
  const baseline = PAD.t + PLOT_H;
  const area = count > 0 ? `${line} L${xAt(count - 1).toFixed(1)} ${baseline} L${xAt(0).toFixed(1)} ${baseline} Z` : "";

  function nearestIndex(event: PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || count === 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * W;
    const ratio = (x - PAD.l) / PLOT_W;
    return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (count === 0) return;
    const current = active ?? count - 1;
    if (event.key === "ArrowLeft") setActive(Math.max(0, current - 1));
    else if (event.key === "ArrowRight") setActive(Math.min(count - 1, current + 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(count - 1);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  }

  const ticks = [0, 1, 2, 3, 4].map((tick) => tick * step);
  const labelIndexes = count > 2 ? [0, Math.floor((count - 1) / 2), count - 1] : count === 2 ? [0, 1] : count === 1 ? [0] : [];
  const marked = active ?? (count > 0 ? count - 1 : null);
  const hovered = active !== null ? points[active] : null;

  return (
    <figure className="nxq-trend">
      <figcaption>
        <strong>{title}</strong>
        <span>{total.toLocaleString()} total</span>
      </figcaption>
      <div className="nxq-trend-frame">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}: ${total.toLocaleString()} ${valueLabel} over ${count} days. Use the left and right arrow keys to read individual days.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((current) => current ?? (count > 0 ? count - 1 : null))}
          onBlur={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="nxq-trend-grid" x1={PAD.l} x2={W - PAD.r} y1={yAt(tick)} y2={yAt(tick)} />
              <text className="nxq-trend-tick" x={PAD.l - 8} y={yAt(tick)} textAnchor="end" dominantBaseline="middle">{tick.toLocaleString()}</text>
            </g>
          ))}
          {labelIndexes.map((index) => (
            <text key={index} className="nxq-trend-tick" x={xAt(index)} y={H - 6} textAnchor={index === 0 && count > 1 ? "start" : index === count - 1 && count > 1 ? "end" : "middle"}>{shortDay(points[index].date)}</text>
          ))}
          {area ? <path className="nxq-trend-area" d={area} /> : null}
          {line ? <path className="nxq-trend-line" d={line} /> : null}
          {active !== null ? <line className="nxq-trend-cross" x1={xAt(active)} x2={xAt(active)} y1={PAD.t} y2={baseline} /> : null}
          {marked !== null ? (
            <g>
              <circle className="nxq-trend-ring" cx={xAt(marked)} cy={yAt(points[marked].value)} r={6} />
              <circle className="nxq-trend-dot" cx={xAt(marked)} cy={yAt(points[marked].value)} r={4} />
            </g>
          ) : null}
          <rect
            className="nxq-trend-hit"
            x={PAD.l}
            y={PAD.t}
            width={PLOT_W}
            height={PLOT_H}
            onPointerMove={(event) => setActive(nearestIndex(event))}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {hovered && active !== null ? (
          <div className="nxq-trend-tip" style={{ left: `clamp(56px, ${(xAt(active) / W) * 100}%, calc(100% - 56px))` }} role="status">
            <b>{hovered.value.toLocaleString()}</b>
            <span>{valueLabel} · {shortDay(hovered.date)}</span>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
