import { siteConfig } from "./site.config.js";

const config = siteConfig.leads || {};
const endpoint = typeof config.endpoint === "string" ? config.endpoint.trim() : "";
const formKey = typeof config.formKey === "string" ? config.formKey.trim() : "";
const challengeRequired = config.challengeRequired === true;
const challengeProvider = typeof config.challengeProvider === "string" ? config.challengeProvider.trim().toLowerCase() : "";
const challengeSiteKey = typeof config.challengeSiteKey === "string" ? config.challengeSiteKey.trim() : "";
const turnstileEnabled = challengeRequired && ["cloudflare_turnstile", "turnstile"].includes(challengeProvider) && Boolean(challengeSiteKey);

let turnstileLoader;
const loadTurnstile = () => {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise((resolve, reject) => {
    const existing = document.getElementById("nxq-turnstile-script");
    const script = existing || document.createElement("script");
    script.id = "nxq-turnstile-script";
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => window.turnstile?.render ? resolve(window.turnstile) : reject(new Error("Verification failed to load.")), { once: true });
    script.addEventListener("error", () => reject(new Error("Verification failed to load.")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
  return turnstileLoader;
};

if (config.enabled === true && endpoint && formKey) {
  const contact = document.getElementById("contact");
  if (contact) {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "grid-column:1/-1;margin-top:1.5rem";
    wrapper.innerHTML = `
      <form id="nxq-lead-form" style="display:grid;gap:.8rem;max-width:720px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.8rem">
          <label>Name<input name="name" required maxlength="160" autocomplete="name" style="width:100%;box-sizing:border-box;margin-top:.35rem;padding:.8rem;border-radius:12px;border:1px solid #ffffff22;background:#ffffff08;color:inherit"></label>
          <label>Email<input name="email" type="email" maxlength="200" autocomplete="email" style="width:100%;box-sizing:border-box;margin-top:.35rem;padding:.8rem;border-radius:12px;border:1px solid #ffffff22;background:#ffffff08;color:inherit"></label>
          <label>Phone<input name="phone" maxlength="40" autocomplete="tel" style="width:100%;box-sizing:border-box;margin-top:.35rem;padding:.8rem;border-radius:12px;border:1px solid #ffffff22;background:#ffffff08;color:inherit"></label>
        </div>
        <label>What can we help with?<textarea name="message" required maxlength="4000" rows="5" style="width:100%;box-sizing:border-box;margin-top:.35rem;padding:.8rem;border-radius:12px;border:1px solid #ffffff22;background:#ffffff08;color:inherit"></textarea></label>
        <input name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
        <div id="nxq-turnstile" style="min-height:${turnstileEnabled ? "65px" : "0"}"></div>
        <button type="submit" class="primary-button" style="border:0;cursor:pointer;justify-self:start">Send request</button>
        <p id="nxq-lead-status" role="status" aria-live="polite" style="margin:0;opacity:.75"></p>
      </form>`;
    contact.appendChild(wrapper);
    const form = wrapper.querySelector("#nxq-lead-form");
    const status = wrapper.querySelector("#nxq-lead-status");
    const submit = form?.querySelector('button[type="submit"]');
    let challengeToken = "";
    let turnstileWidgetId = null;

    const resetChallenge = () => {
      challengeToken = "";
      if (turnstileWidgetId !== null && window.turnstile?.reset) window.turnstile.reset(turnstileWidgetId);
    };

    if (challengeRequired && !turnstileEnabled) {
      if (submit) submit.disabled = true;
      if (status) status.textContent = "Verification is temporarily unavailable. Please use the phone or email option instead.";
    } else if (turnstileEnabled) {
      loadTurnstile()
        .then((turnstile) => {
          const container = wrapper.querySelector("#nxq-turnstile");
          if (!container) throw new Error("Verification container is unavailable.");
          turnstileWidgetId = turnstile.render(container, {
            sitekey: challengeSiteKey,
            callback: (token) => { challengeToken = token; },
            "error-callback": () => { challengeToken = ""; if (status) status.textContent = "Verification failed. Please try again."; },
            "expired-callback": () => { challengeToken = ""; if (status) status.textContent = "Verification expired. Please verify again."; },
            "timeout-callback": () => { challengeToken = ""; if (status) status.textContent = "Verification timed out. Please try again."; },
          });
        })
        .catch(() => {
          if (submit) submit.disabled = true;
          if (status) status.textContent = "Verification failed to load. Please use the phone or email option instead.";
        });
    }

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (challengeRequired && !challengeToken) {
        status.textContent = "Please complete the verification check first.";
        return;
      }
      submit.disabled = true;
      status.textContent = "Sending…";
      const data = new FormData(form);
      const payload = {
        form_key: formKey,
        name: String(data.get("name") || ""),
        email: String(data.get("email") || ""),
        phone: String(data.get("phone") || ""),
        message: String(data.get("message") || ""),
        company_website: String(data.get("company_website") || ""),
        challenge_token: challengeToken,
        service_area: siteConfig.business?.serviceArea || "",
        utm: Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([key]) => key.startsWith("utm_"))),
      };
      try {
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const body = await res.json().catch(() => null);
        if (!res.ok || body?.accepted !== true) throw new Error(body?.error || "Request could not be sent.");
        form.reset();
        resetChallenge();
        status.textContent = "Thanks — your request was sent successfully.";
      } catch (error) {
        resetChallenge();
        status.textContent = error instanceof Error ? error.message : "Request could not be sent. Please use the phone or email option instead.";
      } finally {
        submit.disabled = false;
      }
    });
  }
}
