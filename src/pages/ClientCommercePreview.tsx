import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, ImageOff, PackageOpen, ShoppingBag, X } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type PreviewProduct = {
  id: string;
  name: string;
  short_description?: string | null;
  base_price: number;
  compare_at_price?: number | null;
  featured: boolean;
  category_name?: string | null;
  available_quantity: number;
  primary_image_path?: string | null;
  primary_image_alt?: string | null;
  signed_url?: string;
};

type PreviewResult = {
  storefront?: { id: string; store_name: string; status: string };
  products?: PreviewProduct[];
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

export function ClientCommercePreview() {
  const [storeName, setStoreName] = useState("Commerce storefront");
  const [products, setProducts] = useState<PreviewProduct[]>([]);
  const [category, setCategory] = useState("All");
  const [selectedProduct, setSelectedProduct] = useState<PreviewProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const configuredClient = useMemo(() => (isSupabaseConfigured && supabase ? supabase : null), []);

  useEffect(() => {
    void loadPreview();
  }, []);

  async function loadPreview() {
    setLoading(true);
    setError("");

    if (!configuredClient) {
      setError("Storefront preview is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await configuredClient.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await configuredClient.rpc("get_my_commerce_storefront_preview");
    if (result.error) {
      setError(`Preview failed to load: ${result.error.message}`);
      setLoading(false);
      return;
    }

    const data = (result.data as PreviewResult) || {};
    const loadedProducts = data.products || [];
    const withImages = await Promise.all(
      loadedProducts.map(async (product) => {
        if (!product.primary_image_path) return product;
        const signed = await configuredClient.storage
          .from("commerce-product-media")
          .createSignedUrl(product.primary_image_path, 3600);
        return { ...product, signed_url: signed.data?.signedUrl || "" };
      })
    );

    setStoreName(data.storefront?.store_name || "Commerce storefront");
    setProducts(withImages);
    setLoading(false);
  }

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category_name || "Uncategorized"))).sort()],
    [products]
  );

  const visibleProducts = useMemo(
    () => products.filter((product) => category === "All" || (product.category_name || "Uncategorized") === category),
    [category, products]
  );

  const featuredProducts = visibleProducts.filter((product) => product.featured);
  const regularProducts = visibleProducts.filter((product) => !product.featured);

  function ProductCard({ product }: { product: PreviewProduct }) {
    const validCompareAt = Number(product.compare_at_price || 0) > Number(product.base_price || 0);
    const inStock = product.available_quantity > 0;

    return (
      <article
        className="settings-card"
        style={{
          display: "grid",
          gap: "0.85rem",
          overflow: "hidden",
          padding: "0.85rem",
          transition: "transform 180ms ease, box-shadow 180ms ease",
        }}
      >
        <button
          aria-label={`Preview ${product.name}`}
          onClick={() => setSelectedProduct(product)}
          style={{ background: "transparent", border: 0, cursor: "pointer", padding: 0, textAlign: "left" }}
          type="button"
        >
          {product.signed_url ? (
            <img
              alt={product.primary_image_alt || product.name}
              src={product.signed_url}
              style={{ aspectRatio: "1 / 1", borderRadius: "16px", objectFit: "cover", width: "100%" }}
            />
          ) : (
            <div className="empty-state" style={{ aspectRatio: "1 / 1", minHeight: 0 }}>
              <ImageOff size={30} />
              No product image
            </div>
          )}
        </button>

        <div style={{ display: "grid", gap: "0.55rem" }}>
          <span className="subtle" style={{ fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {product.category_name || "Uncategorized"}
          </span>
          <h3 style={{ margin: 0 }}>{product.name}</h3>
          {product.short_description ? <p className="subtle" style={{ margin: 0 }}>{product.short_description}</p> : null}

          <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
            <strong style={{ fontSize: "1.1rem" }}>{money(product.base_price)}</strong>
            {validCompareAt ? <span className="subtle"><s>{money(product.compare_at_price)}</s></span> : null}
          </div>

          {!validCompareAt && Number(product.compare_at_price || 0) > 0 ? (
            <small className="subtle">Compare-at price hidden because it must be higher than the selling price.</small>
          ) : null}

          <button className="wide-btn" disabled={!inStock} onClick={() => setSelectedProduct(product)} type="button">
            {inStock ? "View product" : "Out of stock"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title">
          <Eye size={22} />
          <div>
            <h1>Storefront preview</h1>
            <p className="subtle">Preview the catalog as a customer would see it before a separate client website is created.</p>
          </div>
        </div>

        <CommerceNav />

        <div className="notice-card" style={{ marginBottom: "1rem" }}>
          <strong>Protected preview — not live</strong>
          <p>Products, images, prices, categories, and stock are rendered from saved Commerce data. Checkout remains disabled.</p>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading storefront preview...</div> : null}

        {!loading && !error ? (
          <section className="panel panel-wide" style={{ display: "grid", gap: "1.25rem" }}>
            <div className="panel-title panel-title-row">
              <div style={{ alignItems: "center", display: "flex", gap: "0.75rem" }}>
                <ShoppingBag size={20} />
                <div>
                  <h2>{storeName}</h2>
                  <p className="subtle">Draft storefront catalog</p>
                </div>
              </div>
              <span className="notice-card" style={{ margin: 0 }}>Not live</span>
            </div>

            {products.length === 0 ? (
              <div className="empty-state"><PackageOpen size={28} /> No product drafts are available yet.</div>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.65rem" }}>
                  {categories.map((item) => (
                    <button
                      className={category === item ? "wide-btn" : "icon-btn"}
                      key={item}
                      onClick={() => setCategory(item)}
                      style={{ flex: "0 1 auto" }}
                      type="button"
                    >
                      {item}
                    </button>
                  ))}
                </div>

                {featuredProducts.length > 0 ? (
                  <section style={{ display: "grid", gap: "0.9rem" }}>
                    <div>
                      <h3 style={{ marginBottom: "0.25rem" }}>Featured products</h3>
                      <p className="subtle" style={{ margin: 0 }}>Highlighted products selected by the client.</p>
                    </div>
                    <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
                      {featuredProducts.map((product) => <ProductCard key={product.id} product={product} />)}
                    </div>
                  </section>
                ) : null}

                {regularProducts.length > 0 ? (
                  <section style={{ display: "grid", gap: "0.9rem" }}>
                    <div>
                      <h3 style={{ marginBottom: "0.25rem" }}>All products</h3>
                      <p className="subtle" style={{ margin: 0 }}>{visibleProducts.length} product{visibleProducts.length === 1 ? "" : "s"} in this view.</p>
                    </div>
                    <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
                      {regularProducts.map((product) => <ProductCard key={product.id} product={product} />)}
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </section>

      {selectedProduct ? (
        <div
          aria-modal="true"
          role="dialog"
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.78)",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            padding: "1rem",
            position: "fixed",
            zIndex: 1000,
          }}
        >
          <article className="panel" style={{ maxHeight: "92vh", maxWidth: "900px", overflowY: "auto", width: "100%" }}>
            <div className="panel-title panel-title-row">
              <button className="icon-btn" onClick={() => setSelectedProduct(null)} type="button"><ArrowLeft size={16} /> Back to products</button>
              <button aria-label="Close product preview" className="icon-btn" onClick={() => setSelectedProduct(null)} type="button"><X size={18} /></button>
            </div>

            <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
              {selectedProduct.signed_url ? (
                <img
                  alt={selectedProduct.primary_image_alt || selectedProduct.name}
                  src={selectedProduct.signed_url}
                  style={{ aspectRatio: "1 / 1", borderRadius: "18px", objectFit: "cover", width: "100%" }}
                />
              ) : (
                <div className="empty-state" style={{ aspectRatio: "1 / 1" }}><ImageOff size={34} /> No product image</div>
              )}

              <div style={{ alignContent: "start", display: "grid", gap: "0.85rem" }}>
                <span className="subtle">{selectedProduct.category_name || "Uncategorized"}</span>
                <h2 style={{ margin: 0 }}>{selectedProduct.name}</h2>
                {selectedProduct.short_description ? <p>{selectedProduct.short_description}</p> : null}
                <strong style={{ fontSize: "1.35rem" }}>{money(selectedProduct.base_price)}</strong>
                <p className="subtle">
                  {selectedProduct.available_quantity > 0
                    ? `${selectedProduct.available_quantity} currently available`
                    : "This product is currently out of stock."}
                </p>
                <button className="wide-btn" disabled type="button">Checkout disabled in protected preview</button>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </main>
  );
}
