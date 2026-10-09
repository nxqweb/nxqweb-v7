import { ArrowRight, Gift, Sparkles } from "lucide-react";
import { appConfig } from "../lib/appConfig";
import { foundingProgram } from "../lib/foundingProgram";

// Honest, text-only offer. No spots-left counter and no automatic discount: applications are read and
// approved by the owner, and the written terms are sent before anything starts.
export function FoundingClientProgram() {
  if (!foundingProgram.enabled) return null;
  const apply = `mailto:${appConfig.supportEmail}?subject=${encodeURIComponent(foundingProgram.applySubject)}&body=${encodeURIComponent(
    "Business name:\nWhat you do:\nCity / service area:\nCurrent website (if any):\nWhy you would like to be a founding client:\n"
  )}`;

  return (
    <section className="px-sec-glass" id="founding" aria-labelledby="px-founding-title">
      <div className="px-wrap">
        <span className="px-kicker" data-px-reveal>Founding client program</span>
        <h2 data-px-reveal id="px-founding-title">Help us shape NXQX-Web, and get a better deal for it.</h2>
        <p className="px-sub" data-px-reveal>
          We are choosing a small group of businesses to help us shape NXQX-Web. Every spot is approved by hand, and you see the written terms before anything starts.
        </p>
        <div className="px-grid3">
          <article className="px-card" data-px-reveal data-px-spot>
            <Sparkles size={24} />
            <h3>{foundingProgram.testerSpots} testing spots</h3>
            <p>
              {foundingProgram.testerDiscountPercent}% off for {foundingProgram.testerMonths} months. In return we ask for honest feedback and, only if you agree in writing, permission to share your results.
            </p>
          </article>
          <article className="px-card" data-px-reveal data-px-spot>
            <Gift size={24} />
            <h3>{foundingProgram.freeSpots} founding spots</h3>
            <p>
              Free service under written terms. Terms apply, including that service can end if NXQX-Web stops operating. You will see the full terms before you accept.
            </p>
          </article>
          <article className="px-card" data-px-reveal data-px-spot>
            <h3>How it works</h3>
            <p>
              Send a short application. We review it and reply personally. The program closes when the spots are filled, or when NXQX-Web reaches {foundingProgram.closesAtClients.toLocaleString("en-US")} clients, whichever comes first.
            </p>
            <a className="px-btn px-gold" href={apply}>
              Apply <ArrowRight size={16} />
            </a>
          </article>
        </div>
      </div>
    </section>
  );
}
