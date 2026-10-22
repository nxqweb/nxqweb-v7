// Plain-rules monthly insights for the client's report. No AI, no network: it turns counts the database already holds (visits, clicks, scroll depth, leads,
// site-check results) into a short summary and a few suggestions. Counts only: no visitor or lead details ever go in. Pure, so the Edge function and the
// Node tests run the same code.

const num = (value, max = 10_000_000) => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.floor(value) : 0);

// rollups: [{ page_views, clicks, max_scroll_depth, heatpoint_count }] for the month; prevRollups the month before.
// leads: { total, urgent, stillNew } for the month; prevLeads: { total }.
/** @param {{ rollups?: any[], prevRollups?: any[], leads?: any, prevLeads?: any }} [input] */
export function buildPerformanceSummary(input) {
  const { rollups = [], prevRollups = [], leads = {}, prevLeads = {} } = input && typeof input === "object" ? input : {};
  const sum = (list, key) => list.reduce((total, row) => total + num(row?.[key]), 0);
  const rows = Array.isArray(rollups) ? rollups : [];
  const prevRows = Array.isArray(prevRollups) ? prevRollups : [];
  const scrolls = rows.map((row) => row?.max_scroll_depth).filter((value) => typeof value === "number" && value >= 0 && value <= 100);
  return {
    tracking: rows.length > 0,
    page_views: sum(rows, "page_views"),
    clicks: sum(rows, "clicks"),
    heatpoints: sum(rows, "heatpoint_count"),
    avg_scroll_depth: scrolls.length ? Math.round(scrolls.reduce((a, b) => a + b, 0) / scrolls.length) : null,
    prev_page_views: prevRows.length ? sum(prevRows, "page_views") : null,
    leads: num(leads?.total),
    urgent_leads: num(leads?.urgent),
    still_new_leads: num(leads?.stillNew),
    prev_leads: typeof prevLeads?.total === "number" ? num(prevLeads.total) : null,
    generated_from_real_data: true,
  };
}

const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

// Up to 5 short, plain suggestions. Each rule fires only on real numbers; a month with nothing to say gets one calm line.
/** @param {any} summary @param {any} [health] @returns {string[]} */
export function buildRecommendations(summary, health = {}) {
  const out = [];
  const unresolved = num(health.unresolved_checks);
  if (unresolved > 0) out.push(`${unresolved} website ${unresolved === 1 ? "check needs" : "checks need"} attention. The NXQX team is looking into ${unresolved === 1 ? "it" : "them"}.`);
  if (summary?.still_new_leads > 0) out.push(`${summary.still_new_leads} ${summary.still_new_leads === 1 ? "inquiry is" : "inquiries are"} still marked New. Open your Leads page and reply, then mark ${summary.still_new_leads === 1 ? "it" : "them"} as contacted.`);
  if (summary?.tracking) {
    if (summary.leads === 0 && summary.page_views >= 30) out.push("People visited your website but nobody sent an inquiry. Make sure your phone number and Contact button are easy to see at the top of the home page.");
    else if (summary.page_views < 30) out.push("Your website had few visits this month. Put your website link on your Google profile, social pages, invoices and business cards.");
    const change = pct(summary.page_views, summary.prev_page_views ?? 0);
    if (change !== null && change >= 20) out.push(`Visits are up ${change}% from last month. Keep sharing your link.`);
    if (change !== null && change <= -20) out.push(`Visits are down ${Math.abs(change)}% from last month. Fresh photos or an updated services section can help. Send us a change request and we will take care of it.`);
    if (summary.avg_scroll_depth !== null && summary.avg_scroll_depth < 40 && summary.page_views >= 30) out.push("Most visitors do not scroll far. Keep your most important information near the top of the page.");
  }
  if (out.length === 0) out.push("Everything looks healthy this month. Ask happy customers for a review: your Get reviews page has a link and a printable QR card.");
  return out.slice(0, 5);
}
