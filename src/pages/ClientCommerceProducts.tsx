import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, PackagePlus, Plus, Save, Trash2 } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type ProductAttribute = {
  key?: string;
  label: string;
  value: string;
};

type ProductVariant = {
  id?: string;
  title: string;
  sku: string;
  price: number;
  inventory_quantity: number;
  reserved_quantity: number;
  incoming_quantity: number;
  low_stock_threshold: number;
  reorder_point: number;
  inventory_location: string;
  inventory_policy: "deny" | "continue";
};

type ProductRow = {
  id: string;
  name: string;
  status: string;
  product_type: string;
  short_description?: string | null;
  description?: string | null;
  base_price: number;
  compare_at_price?: number | string | null;
  sku: string | null;
  track_inventory?: boolean | null;
  requires_shipping?: boolean | null;
  taxable?: boolean | null;
  featured: boolean;
  seo_title?: string | null;
  seo_description?: string | null;
  attributes: ProductAttribute[];
  variants: ProductVariant[];
};

type CatalogResult = {
  products?: ProductRow[];
};

type ProductDraft = {
  id?: string;
  name: string;
  short_description: string;
  description: string;
  product_type: "physical" | "digital" | "service";
  base_price: number;
  compare_at_price: string;
  sku: string;
  track_inventory: boolean;
  requires_shipping: boolean;
  taxable: boolean;
  featured: boolean;
  seo_title: string;
  seo_description: string;
  attributes: ProductAttribute[];
  variants: ProductVariant[];
};

const emptyVariant: ProductVariant = {
  title: "Default",
  sku: "",
  price: 0,
  inventory_quantity: 0,
  reserved_quantity: 0,
  incoming_quantity: 0,
  low_stock_threshold: 5,
  reorder_point: 5,
  inventory_location: "",
  inventory_policy: "deny",
};

const emptyDraft: ProductDraft = {
  name: "",
  short_description: "",
  description: "",
  product_type: "physical",
  base_price: 0,
  compare_at_price: "",
  sku: "",
  track_inventory: true,
  requires_shipping: true,
  taxable: true,
  featured: false,
  seo_title: "",
  seo_description: "",
  attributes: [],
  variants: [{ ...emptyVariant }],
};

function toNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function ClientCommerceProducts() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadProducts();
  }, []);

  const editing = Boolean(draft.id);
  const availableInventory = useMemo(
    () => draft.variants.reduce((total, variant) => total + Math.max(variant.inventory_quantity - variant.reserved_quantity, 0), 0),
    [draft.variants]
  );

  async function loadProducts() {
    setLoading(true);
    setVerified(false);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce products are temporarily unavailable.");
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
      setError("Product drafts could not be verified right now. Unverified product data is not shown.");
    } else {
      const catalog = (result.data as CatalogResult) || {};
      setProducts(catalog.products || []);
      setVerified(true);
    }

    setLoading(false);
  }

  function resetDraft() {
    setDraft({ ...emptyDraft, variants: [{ ...emptyVariant }] });
    setMessage("");
    setError("");
  }

  function editProduct(product: ProductRow) {
    const compareAtPrice = product.compare_at_price;

    setDraft({
      id: product.id,
      name: product.name,
      short_description: product.short_description || "",
      description: product.description || "",
      product_type: (product.product_type as ProductDraft["product_type"]) || "physical",
      base_price: Number(product.base_price || 0),
      compare_at_price: compareAtPrice === null || compareAtPrice === undefined ? "" : String(compareAtPrice),
      sku: product.sku || "",
      track_inventory: product.track_inventory ?? true,
      requires_shipping: product.requires_shipping ?? product.product_type !== "digital",
      taxable: product.taxable ?? true,
      featured: Boolean(product.featured),
      seo_title: product.seo_title || "",
      seo_description: product.seo_description || "",
      attributes: (product.attributes || []).map((attribute) => ({
        key: attribute.key,
        label: attribute.label,
        value: attribute.value,
      })),
      variants: product.variants?.length
        ? product.variants.map((variant) => ({
            ...emptyVariant,
            ...variant,
            price: Number(variant.price || 0),
            inventory_quantity: Number(variant.inventory_quantity || 0),
            reserved_quantity: Number(variant.reserved_quantity || 0),
            incoming_quantity: Number(variant.incoming_quantity || 0),
            low_stock_threshold: Number(variant.low_stock_threshold || 0),
            reorder_point: Number(variant.reorder_point || 0),
          }))
        : [{ ...emptyVariant, price: Number(product.base_price || 0), sku: product.sku || "" }],
    });
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateAttribute(index: number, key: "label" | "value", value: string) {
    setDraft((current) => ({
      ...current,
      attributes: current.attributes.map((attribute, attributeIndex) =>
        attributeIndex === index ? { ...attribute, [key]: value } : attribute
      ),
    }));
  }

  function updateVariant<K extends keyof ProductVariant>(index: number, key: K, value: ProductVariant[K]) {
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [key]: value } : variant
      ),
    }));
  }

  async function saveProduct() {
    if (!supabase || saving || !verified) return;
    if (!draft.name.trim()) {
      setError("Enter a product name before saving.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    const result = await supabase.rpc("save_my_commerce_product", {
      product_payload: {
        ...draft,
        attributes: draft.attributes
          .filter((attribute) => attribute.label.trim() && attribute.value.trim())
          .map((attribute, index) => ({
            key: attribute.key || `detail_${index + 1}`,
            label: attribute.label.trim(),
            value: attribute.value.trim(),
          })),
        variants: draft.variants.map((variant) => ({ ...variant, option_values: {} })),
      },
    });

    setSaving(false);

    if (result.error) {
      setError("Product draft could not be saved. The previously saved catalog remains unchanged, and nothing was published.");
      return;
    }

    setMessage("Product draft saved. Nothing was published to a live storefront.");
    setDraft({ ...emptyDraft, variants: [{ ...emptyVariant }] });
    await loadProducts();
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <PackagePlus size={22} />
            <div>
              <h1>Commerce products</h1>
              <p className="subtle">Create product drafts, custom facts, variants, and advanced inventory rules.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/commerce">
            <ArrowLeft size={16} /> Commerce dashboard
          </a>
        </div>

        <div className="notice-card">
          Products saved here remain drafts. Saving does not publish a storefront, activate payments, or bypass review and production safety gates.
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}

        {loading ? <div className="empty-state">Loading product drafts...</div> : null}
        {!loading && verified ? <>
        <section className="panel panel-wide">
          <div className="panel-title">
            <Save size={20} />
            <div>
              <h2>{editing ? "Edit product draft" : "Add product"}</h2>
              <p className="subtle">Available inventory across this draft's variants: {availableInventory}</p>
            </div>
          </div>

          <div className="setup-form-grid">
            <label><span>Product name</span><input className="auth-input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span>Product type</span><select className="auth-input" value={draft.product_type} onChange={(event) => setDraft((current) => ({ ...current, product_type: event.target.value as ProductDraft["product_type"] }))}><option value="physical">Physical</option><option value="digital">Digital</option><option value="service">Service</option></select></label>
            <label><span>Base price</span><input className="auth-input" min="0" step="0.01" type="number" value={draft.base_price} onChange={(event) => setDraft((current) => ({ ...current, base_price: toNumber(event.target.value) }))} /></label>
            <label><span>Compare-at price</span><input className="auth-input" min="0" step="0.01" type="number" value={draft.compare_at_price} onChange={(event) => setDraft((current) => ({ ...current, compare_at_price: event.target.value }))} /></label>
            <label><span>Main SKU</span><input className="auth-input" value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} /></label>
            <label className="settings-card"><span>Featured product</span><input type="checkbox" checked={draft.featured} onChange={(event) => setDraft((current) => ({ ...current, featured: event.target.checked }))} /></label>
          </div>

          <label className="auth-label"><span>Short description</span><textarea className="auth-input" rows={2} value={draft.short_description} onChange={(event) => setDraft((current) => ({ ...current, short_description: event.target.value }))} /></label>
          <label className="auth-label"><span>Full description</span><textarea className="auth-input" rows={5} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>

          <div className="setup-section-divider"><span>Custom product facts</span><p>Add only facts supplied or verified by the client, such as materials, dimensions, care instructions, compatibility, or warranty terms.</p></div>
          {draft.attributes.map((attribute, index) => (
            <div className="setup-form-grid" key={`attribute-${index}`}>
              <input className="auth-input" placeholder="Fact name" value={attribute.label} onChange={(event) => updateAttribute(index, "label", event.target.value)} />
              <input className="auth-input" placeholder="Verified value" value={attribute.value} onChange={(event) => updateAttribute(index, "value", event.target.value)} />
              <button className="icon-btn" type="button" disabled={saving} onClick={() => setDraft((current) => ({ ...current, attributes: current.attributes.filter((_, attributeIndex) => attributeIndex !== index) }))}><Trash2 size={15} /> Remove</button>
            </div>
          ))}
          <button className="icon-btn" type="button" disabled={saving} onClick={() => setDraft((current) => ({ ...current, attributes: [...current.attributes, { label: "", value: "" }] }))}><Plus size={15} /> Add product fact</button>

          <div className="setup-section-divider"><span>Variants and advanced inventory</span><p>Each size, color, style, or other variant can have separate price, SKU, stock, reserved stock, incoming stock, threshold, reorder point, and location.</p></div>
          {draft.variants.map((variant, index) => (
            <article className="settings-card" key={`variant-${index}`}>
              <div className="panel-title panel-title-row">
                <div className="panel-title"><Boxes size={18} /><strong>Variant {index + 1}</strong></div>
                {draft.variants.length > 1 ? <button className="icon-btn" type="button" disabled={saving} onClick={() => setDraft((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }))}><Trash2 size={15} /> Remove</button> : null}
              </div>
              <div className="setup-form-grid">
                <label><span>Variant title</span><input className="auth-input" value={variant.title} onChange={(event) => updateVariant(index, "title", event.target.value)} /></label>
                <label><span>SKU</span><input className="auth-input" value={variant.sku} onChange={(event) => updateVariant(index, "sku", event.target.value)} /></label>
                <label><span>Price</span><input className="auth-input" min="0" step="0.01" type="number" value={variant.price} onChange={(event) => updateVariant(index, "price", toNumber(event.target.value))} /></label>
                <label><span>On hand</span><input className="auth-input" min="0" type="number" value={variant.inventory_quantity} onChange={(event) => updateVariant(index, "inventory_quantity", toNumber(event.target.value))} /></label>
                <label><span>Reserved</span><input className="auth-input" min="0" type="number" value={variant.reserved_quantity} onChange={(event) => updateVariant(index, "reserved_quantity", toNumber(event.target.value))} /></label>
                <label><span>Incoming</span><input className="auth-input" min="0" type="number" value={variant.incoming_quantity} onChange={(event) => updateVariant(index, "incoming_quantity", toNumber(event.target.value))} /></label>
                <label><span>Low-stock threshold</span><input className="auth-input" min="0" type="number" value={variant.low_stock_threshold} onChange={(event) => updateVariant(index, "low_stock_threshold", toNumber(event.target.value))} /></label>
                <label><span>Reorder point</span><input className="auth-input" min="0" type="number" value={variant.reorder_point} onChange={(event) => updateVariant(index, "reorder_point", toNumber(event.target.value))} /></label>
                <label><span>Inventory location</span><input className="auth-input" value={variant.inventory_location} onChange={(event) => updateVariant(index, "inventory_location", event.target.value)} /></label>
                <label><span>When sold out</span><select className="auth-input" value={variant.inventory_policy} onChange={(event) => updateVariant(index, "inventory_policy", event.target.value as ProductVariant["inventory_policy"])}><option value="deny">Stop selling</option><option value="continue">Allow backorders</option></select></label>
              </div>
            </article>
          ))}
          <button className="icon-btn" type="button" disabled={saving} onClick={() => setDraft((current) => ({ ...current, variants: [...current.variants, { ...emptyVariant, price: current.base_price, title: `Variant ${current.variants.length + 1}` }] }))}><Plus size={15} /> Add variant</button>

          <div className="setup-section-divider"><span>SEO and product behavior</span></div>
          <div className="setup-form-grid">
            <label><span>SEO title</span><input className="auth-input" value={draft.seo_title} onChange={(event) => setDraft((current) => ({ ...current, seo_title: event.target.value }))} /></label>
            <label><span>SEO description</span><input className="auth-input" value={draft.seo_description} onChange={(event) => setDraft((current) => ({ ...current, seo_description: event.target.value }))} /></label>
            <label className="settings-card"><span>Track inventory</span><input type="checkbox" checked={draft.track_inventory} onChange={(event) => setDraft((current) => ({ ...current, track_inventory: event.target.checked }))} /></label>
            <label className="settings-card"><span>Requires shipping</span><input type="checkbox" checked={draft.requires_shipping} onChange={(event) => setDraft((current) => ({ ...current, requires_shipping: event.target.checked }))} /></label>
            <label className="settings-card"><span>Taxable</span><input type="checkbox" checked={draft.taxable} onChange={(event) => setDraft((current) => ({ ...current, taxable: event.target.checked }))} /></label>
          </div>

          <div className="panel-actions">
            <button className="wide-btn" type="button" disabled={saving} onClick={saveProduct}><Save size={16} /> {saving ? "Saving..." : "Save product draft"}</button>
            {editing ? <button className="icon-btn" type="button" disabled={saving} onClick={resetDraft}>Cancel edit</button> : null}
          </div>
        </section>

        <section className="panel panel-wide">
          <div className="panel-title"><PackagePlus size={20} /><div><h2>Product drafts</h2><p className="subtle">{products.length} verified product{products.length === 1 ? "" : "s"}</p></div></div>
          {products.length === 0 ? <div className="empty-state">No verified product drafts yet.</div> : (
            <div className="settings-grid">
              {products.map((product) => {
                const variants = product.variants || [];
                const onHand = variants.reduce((total, variant) => total + Number(variant.inventory_quantity || 0), 0);
                const available = variants.reduce((total, variant) => total + Math.max(Number(variant.inventory_quantity || 0) - Number(variant.reserved_quantity || 0), 0), 0);
                return (
                  <article className="settings-card" key={product.id}>
                    <span>{product.status.replaceAll("_", " ")}</span>
                    <strong>{product.name}</strong>
                    <p>${Number(product.base_price || 0).toFixed(2)} · {variants.length} variant{variants.length === 1 ? "" : "s"}</p>
                    <p>On hand: {onHand} · Available: {available}</p>
                    <button className="icon-btn" type="button" disabled={saving} onClick={() => editProduct(product)}>Edit product</button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        </> : null}
      </section>
    </main>
  );
}
