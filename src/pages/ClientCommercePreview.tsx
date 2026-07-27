import { useEffect, useMemo, useState } from "react";
import { Eye, ImageOff, ShoppingBag } from "lucide-react";
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

export function ClientCommercePreview() {
  const [storeName, setStoreName] = useState("Commerce storefront");
  const [products, setProducts] = useState<PreviewProduct[]>([]);
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

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title">
          <Eye size={22} />
          <div>
            <h1>Storefront preview</h1>
            <p className="subtle">See how saved products will look before a real client website is created.</p>
          </div>
        </div>

        <CommerceNav />

        <div className="notice-card" style={{ marginBottom: "1rem" }}>
          <strong>Protected preview — not live</strong>
          <p>This page proves the product data, image, category, price, and stock can render together. Customers cannot access or buy from it.</p>
        </div>

        {error ? <div className="auth-error">{error}</div> : null}
        {loading ? <div className="empty-state">Loading storefront preview...</div> : null}

        {!loading && !error ? (
          <section className="panel panel-wide">
            <div className="panel-title">
              <ShoppingBag size={20} />
              <div>
                <h2>{storeName}</h2>
                <p className="subtle">Draft catalog preview</p>
              </div>
            </div>

            {products.length === 0 ? (
              <div className="empty-state">No product drafts are available yet.</div>
            ) : (
              <div className="owner-detail-grid">
                {products.map((product) => (
                  <article className="settings-card" key={product.id} style={{ overflow: "hidden" }}>
                    {product.signed_url ? (
                      <img
                        alt={product.primary_image_alt || product.name}
                        src={product.signed_url}
                        style={{ aspectRatio: "4 / 3", borderRadius: "16px", objectFit: "cover", width: "100%" }}
                      />
                    ) : (
                      <div className="empty-state" style={{ minHeight: "220px" }}>
                        <ImageOff size={30} />
                        No product image
                      </div>
                    )}
                    <div style={{ display: "grid", gap: "0.55rem", paddingTop: "0.75rem" }}>
                      <span className="subtle">{product.category_name || "Uncategorized"}</span>
                      <h3 style={{ margin: 0 }}>{product.name}</h3>
                      {product.short_description ? <p style={{ margin: 0 }}>{product.short_description}</p> : null}
                      <div style={{ alignItems: "center", display: "flex", gap: "0.65rem", justifyContent: "space-between", flexWrap: "wrap" }}>
                        <strong>${Number(product.base_price || 0).toFixed(2)}</strong>
                        {product.compare_at_price ? <span className="subtle"><s>${Number(product.compare_at_price).toFixed(2)}</s></span> : null}
                        <span className="subtle">{product.available_quantity > 0 ? `${product.available_quantity} available` : "Out of stock"}</span>
                      </div>
                      {product.featured ? <div className="notice-card">Featured product</div> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
