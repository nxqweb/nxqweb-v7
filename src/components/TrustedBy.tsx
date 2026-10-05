import { clientResults } from "../lib/socialProof";

// Renders nothing until real, permissioned results exist in src/lib/socialProof.ts.
export function TrustedBy() {
  if (clientResults.length === 0) return null;
  return (
    <section className="px-section" aria-labelledby="px-trusted-title">
      <div className="px-wrap">
        <span className="px-kicker" data-px-reveal>Trusted by</span>
        <h2 data-px-reveal id="px-trusted-title">Results from businesses we manage.</h2>
        <div className="px-grid3">
          {clientResults.map((result) => (
            <article className="px-card" data-px-reveal data-px-spot key={result.business}>
              <span className="px-num">{result.business}</span>
              {result.metric ? <h3>{result.metric}</h3> : null}
              <p>{result.headline}{result.period ? ` (${result.period})` : ""}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
