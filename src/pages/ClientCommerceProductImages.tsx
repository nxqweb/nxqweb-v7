import { useEffect, useState } from "react";
import { ArrowLeft, Images } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { ProductImageManager } from "../components/ProductImageManager";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ProductRow = {
  id: string;
  name: string;
  status: string;
  base_price: number;
};

type CatalogResult = {
  products?: ProductRow[];
};

export function ClientCommerceProductImages() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  async function loadProducts() {
    setLoading(true);
    setLoaded(false);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Product photos are temporarily unavailable. No product-image changes were made.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("get_my_commerce_catalog");
    if (result.error) {
      setProducts([]);
      setSelectedProductId("");
      setError("Products could not be loaded right now. Please refresh and try again.");
      setLoading(false);
      return;
    }

    const catalog = (result.data as CatalogResult) || {};
    const loadedProducts = catalog.products || [];
    setProducts(loadedProducts);
    setSelectedProductId((current) =>
      loadedProducts.some((product) => product.id === current) ? current : loadedProducts[0]?.id || ""
    );
    setLoaded(true);
    setLoading(false);
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  const selectedProduct = products.find((product) => product.id === selectedProductId);

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <CommerceNav />

        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <Images size={22} />
            <div>
              <h1>Product photos</h1>
              <p className="subtle">Upload, remove, and reorder real storefront images from your phone or computer.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/commerce">
            <ArrowLeft size={16} /> Commerce dashboard
          </a>
        </div>

        <div className="notice-card">
          Upload up to 8 JPG, PNG, WEBP, or GIF images per product. Images remain in the protected Commerce workflow and do not publish a storefront by themselves.
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {loading ? <div className="empty-state">Loading products...</div> : null}

        {!loading && loaded && products.length === 0 ? (
          <div className="empty-state">
            No saved products were found. Create and save a product first, then return here to upload its photos.
          </div>
        ) : null}

        {!loading && loaded && products.length > 0 ? (
          <section className="panel panel-wide">
            <label className="auth-label">
              <span>Choose product</span>
              <select className="auth-input" value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · ${Number(product.base_price || 0).toFixed(2)} · {product.status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>

            {selectedProduct ? (
              <div className="setup-section-divider">
                <span>{selectedProduct.name}</span>
                <p>Image changes stay inside the protected product workflow. A live storefront still requires the existing publish and approval gates.</p>
              </div>
            ) : null}

            {selectedProductId ? <ProductImageManager productId={selectedProductId} /> : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
