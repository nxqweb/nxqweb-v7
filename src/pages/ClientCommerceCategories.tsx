import { useEffect, useState } from "react";
import { Save, Tags, Trash2 } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Category = {
  id: string;
  parent_category_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  is_visible: boolean;
  product_count: number;
};

const emptyDraft = { id: "", parent_category_id: "", name: "", description: "", sort_order: 0, is_visible: true };

export function ClientCommerceCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void loadCategories(); }, []);

  async function loadCategories() {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Commerce categories are unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }
    const session = await supabase.auth.getSession();
    if (!session.data.session) { window.location.replace("/portal/login"); return; }
    const result = await supabase.rpc("get_my_commerce_categories");
    if (result.error) setError(`Categories failed to load: ${result.error.message}`);
    else setCategories((result.data as Category[]) || []);
    setLoading(false);
  }

  async function saveCategory() {
    if (!supabase || !draft.name.trim()) { setError("Enter a category name before saving."); return; }
    setSaving(true); setError(""); setMessage("");
    const result = await supabase.rpc("save_my_commerce_category", {
      category_payload: {
        id: draft.id || null,
        parent_category_id: draft.parent_category_id || null,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        sort_order: draft.sort_order,
        is_visible: draft.is_visible,
      },
    });
    setSaving(false);
    if (result.error) { setError(`Category could not be saved: ${result.error.message}`); return; }
    setMessage("Category saved."); setDraft(emptyDraft); await loadCategories();
  }

  async function deleteCategory(category: Category) {
    if (!supabase || !window.confirm(`Delete ${category.name}?`)) return;
    const result = await supabase.rpc("delete_my_commerce_category", { category_uuid: category.id });
    if (result.error) setError(`Category could not be deleted: ${result.error.message}`);
    else { setMessage("Category deleted."); await loadCategories(); }
  }

  return (
    <main className="nxq-page"><section className="portal-shell">
      <CommerceNav />
      <div className="panel-title"><Tags size={22} /><div><h1>Commerce categories</h1><p className="subtle">Organize products into clear categories and subcategories.</p></div></div>
      {error ? <div className="auth-error">{error}</div> : null}
      {message ? <div className="auth-success">{message}</div> : null}
      <section className="panel panel-wide">
        <div className="panel-title"><Save size={20} /><h2>{draft.id ? "Edit category" : "Add category"}</h2></div>
        <div className="setup-form-grid">
          <label><span>Category name</span><input className="auth-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label><span>Parent category</span><select className="auth-input" value={draft.parent_category_id} onChange={(e) => setDraft({ ...draft, parent_category_id: e.target.value })}><option value="">No parent</option>{categories.filter((c) => c.id !== draft.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label><span>Sort order</span><input className="auth-input" type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })} /></label>
          <label className="settings-card"><span>Visible in storefront</span><input type="checkbox" checked={draft.is_visible} onChange={(e) => setDraft({ ...draft, is_visible: e.target.checked })} /></label>
        </div>
        <label className="auth-label"><span>Description</span><textarea className="auth-input" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <button className="wide-btn" disabled={saving} onClick={saveCategory} type="button">{saving ? "Saving..." : "Save category"}</button>
      </section>
      <section className="panel panel-wide"><h2>Categories</h2>{loading ? <div className="empty-state">Loading categories...</div> : categories.length === 0 ? <div className="empty-state">No categories yet.</div> : categories.map((category) => (
        <article className="settings-card" key={category.id}><div className="panel-title panel-title-row"><div><strong>{category.name}</strong><p>{category.product_count} product{category.product_count === 1 ? "" : "s"} · {category.is_visible ? "visible" : "hidden"}</p></div><div style={{ display: "flex", gap: ".5rem" }}><button className="icon-btn" type="button" onClick={() => setDraft({ id: category.id, parent_category_id: category.parent_category_id || "", name: category.name, description: category.description || "", sort_order: category.sort_order, is_visible: category.is_visible })}>Edit</button><button className="icon-btn" type="button" onClick={() => deleteCategory(category)}><Trash2 size={15} /> Delete</button></div></div></article>
      ))}</section>
    </section></main>
  );
}
