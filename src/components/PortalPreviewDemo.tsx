import { useEffect, useMemo, useRef, useState } from "react";

// ILLUSTRATIVE sample data only: a self-contained design preview of the client workspace on the
// public home page. It reads no account data and calls no backend. Real client numbers appear only
// inside the signed-in portal from the client's own records.

type SeriesKey = "visitors" | "leads" | "health";

const SERIES: Record<SeriesKey, { label: string; base: number; amp: number; tab: string }> = {
  visitors: { label: "visitors today", base: 180, amp: 38, tab: "Visitors" },
  leads: { label: "leads this month", base: 6, amp: 2.2, tab: "Leads" },
  health: { label: "health score", base: 97, amp: 1.2, tab: "Health score" },
};
const POINTS = 48;
const WIDTH = 800;
const HEIGHT = 230;
const EVENTS = [
  "New lead from contact form",
  "Update request approved",
  "Page speed check passed",
  "Search ranking up for a service page",
  "Monthly improvement scheduled",
  "Backup completed",
];

function seed(key: SeriesKey) {
  const { base, amp } = SERIES[key];
  const values: number[] = [];
  let value = base;
  for (let index = 0; index < POINTS; index += 1) {
    value = Math.max(base * 0.5, value + (Math.random() - 0.4) * amp * 0.7 + (base * (0.9 + (0.2 * index) / POINTS) - value) * 0.08);
    values.push(value);
  }
  return values;
}

function buildPath(values: number[], low: number, high: number) {
  const points = values.map((value, index) => [
    (index * WIDTH) / (POINTS - 1),
    HEIGHT - 12 - ((value - low) / (high - low || 1)) * (HEIGHT - 34),
  ]);
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let index = 1; index < points.length; index += 1) {
    const [px, py] = points[index - 1];
    const [cx, cy] = points[index];
    const mid = (px + cx) / 2;
    path += ` C${mid},${py} ${mid},${cy} ${cx},${cy}`;
  }
  return { path, first: points[0], last: points[points.length - 1] };
}

export function PortalPreviewDemo() {
  const [active, setActive] = useState<SeriesKey>("visitors");
  const [data, setData] = useState<Record<SeriesKey, number[]>>(() => ({ visitors: seed("visitors"), leads: seed("leads"), health: seed("health") }));
  const [feed, setFeed] = useState<Array<{ id: number; text: string; time: string }>>([]);
  const counter = useRef(0);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const pushEvent = () => {
      counter.current += 1;
      const text = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setFeed((current) => [{ id: counter.current, text, time }, ...current].slice(0, 3));
    };
    pushEvent();
    pushEvent();
    pushEvent();
    if (reduced) return;
    const dataTimer = window.setInterval(() => {
      setData((current) => {
        const next = { ...current };
        (Object.keys(SERIES) as SeriesKey[]).forEach((key) => {
          const { base, amp } = SERIES[key];
          const series = current[key];
          const last = series[series.length - 1];
          const value = last + (Math.random() - 0.45) * amp + (base * 1.08 - last) * 0.06;
          next[key] = [...series.slice(1), Math.max(base * 0.5, value)];
        });
        return next;
      });
    }, 1100);
    const feedTimer = window.setInterval(pushEvent, 3800);
    return () => {
      window.clearInterval(dataTimer);
      window.clearInterval(feedTimer);
    };
  }, [reduced]);

  const chart = useMemo(() => {
    const values = data[active];
    const baseline = values.map((_, index) => SERIES[active].base * (0.82 + 0.04 * Math.sin(index / 6)));
    const everything = [...values, ...baseline];
    const spread = (Math.max(...everything) - Math.min(...everything)) * 0.15;
    const low = Math.min(...everything) - spread;
    const high = Math.max(...everything) + spread;
    const line = buildPath(values, low, high);
    const reference = buildPath(baseline, low, high);
    const latest = values[values.length - 1];
    const change = ((latest - values[0]) / values[0]) * 100;
    const headline = active === "visitors" ? Math.round(1200 + latest * 6) : active === "leads" ? Math.round(24 + (latest - SERIES.leads.base)) : Math.round(latest);
    return { line, reference, change, headline };
  }, [active, data]);

  return (
    <div className="px-portal px-card-shell" data-px-reveal>
      <aside className="px-side" aria-hidden="true">
        <div className="px-who"><span className="px-mark">N</span><div><b>Example Dental Co.</b>NXQ-Business · Growth</div></div>
        <span className="px-on">Dashboard</span>
        <span>Website health <small>98</small></span>
        <span>Leads <small>24</small></span>
        <span>Analytics</span>
        <span>SEO</span>
        <span>Update requests <small>3</small></span>
        <span>Reports</span>
        <span>Files</span>
        <span>Billing</span>
      </aside>
      <div className="px-main">
        <div className="px-top">
          <h3>Dashboard</h3>
          <span className="px-live"><i />Live</span>
        </div>
        <div className="px-tabs" role="tablist" aria-label="Example chart series">
          {(Object.keys(SERIES) as SeriesKey[]).map((key) => (
            <button
              aria-selected={active === key}
              className={`px-tab ${active === key ? "px-on" : ""}`}
              key={key}
              onClick={() => setActive(key)}
              role="tab"
              type="button"
            >
              {SERIES[key].tab}
            </button>
          ))}
        </div>
        <div className="px-big">
          <b>{chart.headline}</b>
          <span style={{ color: chart.change >= 0 ? "var(--px-green)" : "#e8a08f" }}>
            {chart.change >= 0 ? "+" : ""}{chart.change.toFixed(1)}% {SERIES[active].label}
          </span>
        </div>
        <div className="px-chart">
          <svg aria-label="Live example chart" preserveAspectRatio="none" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
            <defs>
              <linearGradient id="px-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#f0dca0" stopOpacity=".32" />
                <stop offset="1" stopColor="#f0dca0" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[1, 2, 3, 4].map((row) => (
              <line className="px-gl" key={row} x1={0} x2={WIDTH} y1={(row * HEIGHT) / 5} y2={(row * HEIGHT) / 5} />
            ))}
            <path d={`${chart.line.path} L${chart.line.last[0]},${HEIGHT} L${chart.line.first[0]},${HEIGHT} Z`} fill="url(#px-area)" />
            <path className="px-ln2" d={chart.reference.path} />
            <path className="px-ln" d={chart.line.path} />
            <circle className="px-head" cx={chart.line.last[0]} cy={chart.line.last[1]} r={5} />
          </svg>
        </div>
        <div className="px-kpis">
          <div className="px-kpi"><small>Health</small><b data-px-count="98">0</b><span>Managed</span></div>
          <div className="px-kpi"><small>Leads this month</small><b data-px-count="24">0</b><span>+6 vs last</span></div>
          <div className="px-kpi"><small>Updates</small><b data-px-count="3">0</b><span>in review</span></div>
          <div className="px-kpi"><small>Next cycle</small><b>Fri</b><span>Scheduled</span></div>
        </div>
        <div className="px-feed" aria-live="off">
          {feed.map((item) => (
            <div key={item.id}>{item.text}<span>{item.time}</span></div>
          ))}
        </div>
        <p className="px-note">Illustrative sample data for this design preview. Real figures come from your own site once connected.</p>
      </div>
    </div>
  );
}
