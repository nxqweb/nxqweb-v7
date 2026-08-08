import { siteConfig } from "./site.config.js";

const config = siteConfig.analytics || {};
const endpoint = typeof config.endpoint === "string" ? config.endpoint.trim() : "";
const enabled = Boolean(config.enabled && endpoint);
const consentRequired = config.consentRequired !== false;
const consentKey = `nxq-analytics-consent:${siteConfig.schemaVersion || "business"}`;

if (enabled) {
  let consent = window.localStorage.getItem(consentKey);

  if (consentRequired && consent !== "granted") {
    const banner = document.createElement("aside");
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Website analytics preference");
    banner.style.cssText = [
      "position:fixed",
      "left:1rem",
      "right:1rem",
      "bottom:1rem",
      "z-index:9999",
      "max-width:680px",
      "margin:auto",
      "padding:1rem",
      "border:1px solid rgba(255,255,255,.16)",
      "border-radius:18px",
      "background:rgba(7,11,18,.96)",
      "backdrop-filter:blur(16px)",
      "box-shadow:0 24px 80px rgba(0,0,0,.45)",
      "color:white",
      "font:14px/1.5 system-ui,sans-serif",
    ].join(";");

    banner.innerHTML = `
      <strong>Help improve this website</strong>
      <p style="margin:.45rem 0 .8rem;color:rgba(255,255,255,.72)">
        Optional anonymous analytics can measure page views, clicks, scrolling, and—only on supported plans—coarse heatmap positions. We do not collect form text, passwords, or keystrokes.
      </p>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap">
        <button data-nxq-consent="grant" style="padding:.65rem .9rem;border:0;border-radius:999px;cursor:pointer">Allow analytics</button>
        <button data-nxq-consent="deny" style="padding:.65rem .9rem;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:transparent;color:white;cursor:pointer">No thanks</button>
      </div>`;

    document.body.appendChild(banner);
    banner.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-nxq-consent]");
      if (!button) return;
      consent = button.dataset.nxqConsent === "grant" ? "granted" : "denied";
      window.localStorage.setItem(consentKey, consent);
      banner.remove();
      if (consent === "granted") startAnalytics();
    });
  } else if (!consentRequired || consent === "granted") {
    startAnalytics();
  }
}

function startAnalytics() {
  const sessionKey = getSessionKey();
  const path = `${window.location.pathname}${window.location.search}`.slice(0, 500);
  const queue = [];
  let flushTimer = null;

  function enqueue(eventType, payload = {}) {
    queue.push({
      event_type: eventType,
      page_path: path,
      anonymous_session_key: sessionKey,
      consent_version: config.consentVersion || "v1",
      occurred_at: new Date().toISOString(),
      ...payload,
    });
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = window.setTimeout(flush, 1200);
  }

  async function flush() {
    flushTimer = null;
    if (!queue.length) return;
    const events = queue.splice(0, 20);
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          schema_version: "nxq-analytics-v1",
          events,
        }),
      });
    } catch {
      // Analytics must never break the website experience.
    }
  }

  enqueue("page_view");

  if (config.clicks !== false) {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("a,button");
      if (!target) return;
      enqueue("click", {
        metadata: {
          element: target.tagName.toLowerCase(),
          destination_kind: target.tagName === "A" ? "link" : "action",
        },
      });
    }, { passive: true });
  }

  if (config.scrollDepth !== false) {
    let deepest = 0;
    window.addEventListener("scroll", () => {
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const depth = Math.min(100, Math.round((window.scrollY / max) * 100));
      if (depth >= deepest + 25) {
        deepest = Math.floor(depth / 25) * 25;
        enqueue("scroll_depth", { scroll_depth: deepest });
      }
    }, { passive: true });
  }

  if (config.mouseTracking === true) {
    let lastHeatpointAt = 0;
    window.addEventListener("pointermove", (event) => {
      const now = Date.now();
      if (now - lastHeatpointAt < 750) return;
      lastHeatpointAt = now;
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      enqueue("mouse_heatpoint", {
        normalized_x: Number((event.clientX / width).toFixed(4)),
        normalized_y: Number((event.clientY / height).toFixed(4)),
      });
    }, { passive: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}

function getSessionKey() {
  const key = "nxq-anonymous-session-v1";
  let value = window.sessionStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    window.sessionStorage.setItem(key, value);
  }
  return value;
}