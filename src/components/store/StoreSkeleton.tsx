// What a store looks like while it loads: grey shapes in the same places the real content will appear, so the page does not jump.
export function StoreSkeleton() {
  return (
    <main className="nxq-page store-theme" aria-busy="true">
      <section className="portal-shell">
        <p className="sr-only" role="status">Loading the store</p>
        <div className="store-skeleton-title" aria-hidden="true" />
        <div className="store-skeleton-line" aria-hidden="true" />
        <div className="store-product-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div className="store-skeleton-card" key={i}><div className="store-skeleton-photo" /><div className="store-skeleton-line" /><div className="store-skeleton-line store-skeleton-short" /></div>
          ))}
        </div>
      </section>
    </main>
  );
}
