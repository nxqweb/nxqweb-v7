import { useEffect, useMemo, useState } from "react";
import { ImagePlus, PackageSearch, Save, Star, Trash2 } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Category = {
  id: string;
  name: string;
  parent_category_id?: string | null;
};

type MediaItem = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  alt_text?: string | null;
  sort_order: number;
  is_primary: boolean;
  signed_url?: string;
};

type Product = {
  id: string;
  name: string;
  status: string;
  category_id?: string | null;
  category_name?: string | null;
  media: MediaItem[];
};

type CatalogManagerResult = {
  client_id?: string;
  categories?: Category[];
  products?: Product[];
};

export function ClientCommerceCatalog() {
  const [clientId, setClientId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  useEffect(() => {
    void loadCatalog();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial authenticated catalog load only

  useEffect(() => {
    setSelectedCategoryId(selectedProduct?.category_id || "");
  }, [selectedProductId, selectedProduct?.category_id]);

  async function loadCatalog(preferredProductId?: string) {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce catalog is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const client = supabase;
    const sessionResult = await client.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await client.rpc("get_my_commerce_catalog_manager");
    if (result.error) {
      setError(`Catalog failed to load: ${result.error.message}`);
      setLoading(false);
      return;
    }

    const data = (result.data as CatalogManagerResult) || {};
    const loadedProducts = data.products || [];
    const withSignedUrls = await Promise.all(
      loadedProducts.map(async (product) => ({
        ...product,
        media: await Promise.all(
          (product.media || []).map(async (item) => {
            const signed = await client.storage
              .from("commerce-product-media")
              .createSignedUrl(item.storage_path, 3600);
            return { ...item, signed_url: signed.data?.signedUrl || "" };
          })
        ),
      }))
    );

    setClientId(data.client_id || "");
    setCategories(data.categories || []);
    setProducts(withSignedUrls);

    const nextSelected = preferredProductId || selectedProductId || withSignedUrls[0]?.id || "";
    setSelectedProductId(nextSelected);
    setLoading(false);
  }

  async function saveCategoryAssignment() {
    if (!supabase || !selectedProduct) return;
    setSaving(true);
    setMessage("");
    setError("");

    const result = await supabase.rpc("assign_my_commerce_product_category", {
      product_uuid: selectedProduct.id,
      category_uuid: selectedCategoryId || null,
    });

    setSaving(false);
    if (result.error) {
      setError(`Category could not be updated: ${result.error.message}`);
      return;
    }

    setMessage("Product category updated.");
    await loadCatalog(selectedProduct.id);
  }

  async function uploadImage() {
    if (!supabase || !selectedProduct || !file || !clientId) return;
    setSaving(true);
    setMessage("");
    setError("");

    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeName = `${crypto.randomUUID()}.${extension}`;
    const storagePath = `${clientId}/${selectedProduct.id}/${safeName}`;

    const upload = await supabase.storage
      .from("commerce-product-media")
      .upload(storagePath, file, { cacheControl: "3600", upsert: false });

    if (upload.error) {
      setSaving(false);
      setError(`Image upload failed: ${upload.error.message}`);
      return;
    }

    const register = await supabase.rpc("register_my_commerce_product_media", {
      media_payload: {
        product_id: selectedProduct.id,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        alt_text: altText.trim() || null,
        sort_order: selectedProduct.media.length,
        is_primary: selectedProduct.media.length === 0,
      },
    });

    if (register.error) {
      await supabase.storage.from("commerce-product-media").remove([storagePath]);
      setSaving(false);
      setError(`Image could not be registered: ${register.error.message}`);
      return;
    }

    setFile(null);
    setAltText("");
    setSaving(false);
    setMessage("Product image uploaded.");
    await loadCatalog(selectedProduct.id);
  }

  async function updateMedia(item: MediaItem, makePrimary: boolean) {
    if (!supabase || !selectedProduct) return;
    setSaving(true);
    setMessage("");
    setError("");

    const result = await supabase.rpc("update_my_commerce_product_media", {
      media_uuid: item.id,
      new_alt_text: item.alt_text || null,
      new_sort_order: item.sort_order,
      make_primary: makePrimary,
    });

    setSaving(false);
    if (result.error) {
      setError(`Image could not be updated: ${result.error.message}`);
      return;
    }

    setMessage(makePrimary ? "Primary image updated." : "Image details saved.");
    await loadCatalog(selectedProduct.id);
  }

  async function deleteMedia(item: MediaItem) {
    if (!supabase || !selectedProduct) return;
    const confirmed = window.confirm(`Remove ${item.file_name} from this product?`);
    if (!confirmed) return;

    setSaving(true);
    setMessage("");
    setError("");

    const result = await supabase.rpc("delete_my_commerce_product_media", {
      media_uuid: item.id,
    });

    if (result.error) {
      setSaving(false);
      setError(`Image could not be removed: ${result.error.message}`);
      return;
    }

    const remove = await supabase.storage.from("commerce-product-media").remove([item.storage_path]);
    setSaving(false);

    if (remove.error) {
      setError(`Image record was removed, but storage cleanup failed: ${remove.error.message}`);
    } else {
      setMessage("Product image removed.");
    }

    await loadCatalog(selectedProduct.id);
  }

  function updateLocalMedia(id: string, patch: Partial<MediaItem>) {
    setProducts((current) =>
      current.map((product) =>
        product.id === selectedProductId
          ? { ...product, media: product.media.map((item) => (item.id === id ? { ...item, ...patch } : item)) }
          : product
      )
    );
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title">
          <PackageSearch size={22} />
          <div>
            <h1>Commerce catalog</h1>
            <p className="subtle">Organize saved products, assign categories, and manage protected product images.</p>
          </div>
        </div>

        <CommerceNav />

        {error ? <div className="auth-error">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}
        {loading ? <div className="empty-state">Loading catalog...</div> : null}

        {!loading && products.length === 0 ? (
          <div className="empty-state">
            Save a product draft first, then return here to assign its category and upload images.
          </div>
        ) : null}

        {!loading && products.length > 0 ? (
          <>
            <section className="panel panel-wide">
              <div className="setup-form-grid">
                <label>
                  <span>Product</span>
                  <select className="auth-input" value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Category</span>
                  <select className="auth-input" value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}>
                    <option value="">Uncategorized</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="wide-btn" disabled={saving || !selectedProduct} onClick={saveCategoryAssignment} type="button">
                <Save size={16} /> Save category
              </button>
              {!selectedCategoryId ? <div className="notice-card">This product is missing a category.</div> : null}
            </section>

            <section className="panel panel-wide">
              <div className="panel-title">
                <ImagePlus size={20} />
                <div>
                  <h2>Product images</h2>
                  <p className="subtle">Private until a future storefront publish is approved.</p>
                </div>
              </div>

              <div className="setup-form-grid">
                <label>
                  <span>Image file</span>
                  <input className="auth-input" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => setFile(event.target.files?.[0] || null)} type="file" />
                </label>
                <label>
                  <span>Alt text</span>
                  <input className="auth-input" value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Describe the product image" />
                </label>
              </div>
              <button className="wide-btn" disabled={saving || !file || !selectedProduct} onClick={uploadImage} type="button">
                <ImagePlus size={16} /> Upload product image
              </button>

              {selectedProduct && selectedProduct.media.length === 0 ? (
                <div className="notice-card">This product is missing a product image.</div>
              ) : null}

              <div className="owner-detail-grid" style={{ marginTop: "1rem" }}>
                {selectedProduct?.media.map((item) => (
                  <article className="settings-card" key={item.id}>
                    {item.signed_url ? (
                      <img alt={item.alt_text || item.file_name} src={item.signed_url} style={{ borderRadius: "16px", maxHeight: "240px", objectFit: "cover", width: "100%" }} />
                    ) : null}
                    <strong>{item.file_name}</strong>
                    <p>{item.is_primary ? "Primary image" : "Gallery image"}</p>
                    <label>
                      <span>Alt text</span>
                      <input className="auth-input" value={item.alt_text || ""} onChange={(event) => updateLocalMedia(item.id, { alt_text: event.target.value })} />
                    </label>
                    <label>
                      <span>Sort order</span>
                      <input className="auth-input" min="0" type="number" value={item.sort_order} onChange={(event) => updateLocalMedia(item.id, { sort_order: Number(event.target.value) || 0 })} />
                    </label>
                    <button className="icon-btn" disabled={saving} onClick={() => updateMedia(item, false)} type="button"><Save size={15} /> Save details</button>
                    {!item.is_primary ? <button className="icon-btn" disabled={saving} onClick={() => updateMedia(item, true)} type="button"><Star size={15} /> Make primary</button> : null}
                    <button className="icon-btn" disabled={saving} onClick={() => deleteMedia(item)} type="button"><Trash2 size={15} /> Remove image</button>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
