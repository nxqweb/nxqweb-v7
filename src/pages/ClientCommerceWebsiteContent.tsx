import { useEffect, useState } from "react";
import { ArrowLeft, FileText, ImagePlus, Save, Sparkles } from "lucide-react";
import { CommerceNav } from "../components/CommerceNav";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type WebsiteContent = {
  client_id?: string;
  announcement_enabled: boolean;
  announcement_text: string;
  homepage_message_enabled: boolean;
  homepage_message_heading: string;
  homepage_message_body: string;
  verse_enabled: boolean;
  verse_text: string;
  verse_reference: string;
  verse_message: string;
  story_heading: string;
  story_body: string;
  contact_phone: string;
  contact_email: string;
  business_hours: string;
  pickup_details: string;
  shipping_policy: string;
  returns_policy: string;
  custom_order_policy: string;
  instagram_url: string;
  facebook_url: string;
  tiktok_url: string;
  youtube_url: string;
  custom_page_addon_enabled: boolean;
  custom_page_title: string;
  custom_page_slug: string;
  custom_page_body: string;
  custom_page_image_url: string;
  custom_page_button_text: string;
  custom_page_button_url: string;
  custom_page_show_in_menu: boolean;
  custom_page_published: boolean;
};

const initialContent: WebsiteContent = {
  announcement_enabled: false,
  announcement_text: "",
  homepage_message_enabled: false,
  homepage_message_heading: "",
  homepage_message_body: "",
  verse_enabled: false,
  verse_text: "",
  verse_reference: "",
  verse_message: "",
  story_heading: "",
  story_body: "",
  contact_phone: "",
  contact_email: "",
  business_hours: "",
  pickup_details: "",
  shipping_policy: "",
  returns_policy: "",
  custom_order_policy: "",
  instagram_url: "",
  facebook_url: "",
  tiktok_url: "",
  youtube_url: "",
  custom_page_addon_enabled: false,
  custom_page_title: "",
  custom_page_slug: "updates",
  custom_page_body: "",
  custom_page_image_url: "",
  custom_page_button_text: "",
  custom_page_button_url: "",
  custom_page_show_in_menu: false,
  custom_page_published: false,
};

export function ClientCommerceWebsiteContent() {
  const [content, setContent] = useState<WebsiteContent>(initialContent);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadContent() {
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Website content is unavailable because Supabase is not configured.");
      setLoading(false);
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }

    const result = await supabase.rpc("get_my_commerce_website_content");
    if (result.error) setError(`Website content failed to load: ${result.error.message}`);
    else if (result.data) setContent({ ...initialContent, ...(result.data as WebsiteContent) });
    setLoading(false);
  }

  useEffect(() => {
    void loadContent();
  }, []);

  function update<K extends keyof WebsiteContent>(key: K, value: WebsiteContent[K]) {
    setContent((current) => ({ ...current, [key]: value }));
  }

  async function saveContent() {
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    setError("");

    const payload = { ...content } as Record<string, unknown>;
    delete payload.client_id;
    delete payload.custom_page_addon_enabled;

    const result = await supabase.rpc("save_my_commerce_website_content", { content_payload: payload });
    setSaving(false);

    if (result.error) {
      setError(`Website content could not be saved: ${result.error.message}`);
      return;
    }

    if (result.data) setContent({ ...initialContent, ...(result.data as WebsiteContent) });
    setMessage("Website content saved. Public sections update without a redeploy.");
  }

  async function uploadCustomPageImage(file: File) {
    if (!supabase || !content.client_id) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a JPG, PNG, WEBP, or GIF image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("The image must be 8 MB or smaller.");
      return;
    }

    setUploading(true);
    setError("");
    setMessage("");

    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${content.client_id}/custom-page/${crypto.randomUUID()}.${extension}`;
    const upload = await supabase.storage.from("commerce-website-content").upload(path, file, { upsert: false, contentType: file.type });

    if (upload.error) {
      setUploading(false);
      setError(`Image upload failed: ${upload.error.message}`);
      return;
    }

    const publicUrl = supabase.storage.from("commerce-website-content").getPublicUrl(path).data.publicUrl;
    update("custom_page_image_url", publicUrl);
    setUploading(false);
    setMessage("Image uploaded. Save website content to attach it to the custom page draft.");
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell">
        <CommerceNav />

        <div className="panel-title panel-title-row">
          <div className="panel-title">
            <FileText size={22} />
            <div>
              <h1>Website content</h1>
              <p className="subtle">Update safe website sections without editing code or redeploying.</p>
            </div>
          </div>
          <a className="icon-btn" href="/client/commerce"><ArrowLeft size={16} /> Commerce dashboard</a>
        </div>

        <div className="notice-card">Your content changes never alter the protected website layout. Only the fields below can appear publicly.</div>
        {error ? <div className="auth-error">{error}</div> : null}
        {message ? <div className="auth-success">{message}</div> : null}
        {loading ? <div className="empty-state">Loading website content...</div> : null}

        {!loading ? (
          <div style={{ display: "grid", gap: "1rem" }}>
            <section className="panel panel-wide">
              <div className="setup-section-divider"><span>Homepage</span><p>Control the announcement and a short featured message.</p></div>
              <label className="auth-label"><span><input type="checkbox" checked={content.announcement_enabled} onChange={(e) => update("announcement_enabled", e.target.checked)} /> Show announcement bar</span></label>
              <label className="auth-label"><span>Announcement text</span><input className="auth-input" maxLength={300} value={content.announcement_text} onChange={(e) => update("announcement_text", e.target.value)} placeholder="Free local pickup available" /></label>
              <label className="auth-label"><span><input type="checkbox" checked={content.homepage_message_enabled} onChange={(e) => update("homepage_message_enabled", e.target.checked)} /> Show homepage message</span></label>
              <label className="auth-label"><span>Message heading</span><input className="auth-input" value={content.homepage_message_heading} onChange={(e) => update("homepage_message_heading", e.target.value)} placeholder="Made with faith and purpose" /></label>
              <label className="auth-label"><span>Message</span><textarea className="auth-input" rows={4} value={content.homepage_message_body} onChange={(e) => update("homepage_message_body", e.target.value)} /></label>
            </section>

            <section className="panel panel-wide">
              <div className="setup-section-divider"><span>Faith & verse</span><p>Add an optional verse section to the homepage.</p></div>
              <label className="auth-label"><span><input type="checkbox" checked={content.verse_enabled} onChange={(e) => update("verse_enabled", e.target.checked)} /> Show Bible verse</span></label>
              <label className="auth-label"><span>Verse text</span><textarea className="auth-input" rows={4} value={content.verse_text} onChange={(e) => update("verse_text", e.target.value)} placeholder="The light shines in the darkness..." /></label>
              <label className="auth-label"><span>Verse reference</span><input className="auth-input" value={content.verse_reference} onChange={(e) => update("verse_reference", e.target.value)} placeholder="John 1:5" /></label>
              <label className="auth-label"><span>Optional message</span><textarea className="auth-input" rows={3} value={content.verse_message} onChange={(e) => update("verse_message", e.target.value)} /></label>
            </section>

            <section className="panel panel-wide">
              <div className="setup-section-divider"><span>About & contact</span><p>Keep the story and business details current.</p></div>
              <label className="auth-label"><span>Story heading</span><input className="auth-input" value={content.story_heading} onChange={(e) => update("story_heading", e.target.value)} /></label>
              <label className="auth-label"><span>Our Story</span><textarea className="auth-input" rows={6} value={content.story_body} onChange={(e) => update("story_body", e.target.value)} /></label>
              <div className="form-grid-2">
                <label className="auth-label"><span>Phone</span><input className="auth-input" value={content.contact_phone} onChange={(e) => update("contact_phone", e.target.value)} /></label>
                <label className="auth-label"><span>Email</span><input className="auth-input" type="email" value={content.contact_email} onChange={(e) => update("contact_email", e.target.value)} /></label>
              </div>
              <label className="auth-label"><span>Business hours</span><textarea className="auth-input" rows={3} value={content.business_hours} onChange={(e) => update("business_hours", e.target.value)} /></label>
              <label className="auth-label"><span>Pickup details</span><textarea className="auth-input" rows={3} value={content.pickup_details} onChange={(e) => update("pickup_details", e.target.value)} /></label>
            </section>

            <section className="panel panel-wide">
              <div className="setup-section-divider"><span>Policies & social links</span><p>Give customers clear expectations and ways to follow the business.</p></div>
              <label className="auth-label"><span>Shipping policy</span><textarea className="auth-input" rows={4} value={content.shipping_policy} onChange={(e) => update("shipping_policy", e.target.value)} /></label>
              <label className="auth-label"><span>Returns policy</span><textarea className="auth-input" rows={4} value={content.returns_policy} onChange={(e) => update("returns_policy", e.target.value)} /></label>
              <label className="auth-label"><span>Custom-order policy</span><textarea className="auth-input" rows={4} value={content.custom_order_policy} onChange={(e) => update("custom_order_policy", e.target.value)} /></label>
              <div className="form-grid-2">
                <label className="auth-label"><span>Instagram URL</span><input className="auth-input" value={content.instagram_url} onChange={(e) => update("instagram_url", e.target.value)} /></label>
                <label className="auth-label"><span>Facebook URL</span><input className="auth-input" value={content.facebook_url} onChange={(e) => update("facebook_url", e.target.value)} /></label>
                <label className="auth-label"><span>TikTok URL</span><input className="auth-input" value={content.tiktok_url} onChange={(e) => update("tiktok_url", e.target.value)} /></label>
                <label className="auth-label"><span>YouTube URL</span><input className="auth-input" value={content.youtube_url} onChange={(e) => update("youtube_url", e.target.value)} /></label>
              </div>
            </section>

            <section className="panel panel-wide">
              <div className="setup-section-divider"><span>Custom content page · $5/month</span><p>Prepare one extra page with text, one image, and an optional button.</p></div>
              {!content.custom_page_addon_enabled ? <div className="notice-card"><Sparkles size={18} /> The add-on is not active. You can prepare and save the draft, but it cannot be published yet.</div> : <div className="auth-success">Custom page add-on is active.</div>}
              <label className="auth-label"><span>Page title</span><input className="auth-input" value={content.custom_page_title} onChange={(e) => update("custom_page_title", e.target.value)} placeholder="Our Mission" /></label>
              <label className="auth-label"><span>Page URL</span><div className="auth-input" style={{ display: "flex", alignItems: "center", gap: ".35rem" }}><span>/</span><input style={{ flex: 1, border: 0, background: "transparent", color: "inherit", outline: 0 }} value={content.custom_page_slug} onChange={(e) => update("custom_page_slug", e.target.value)} /></div></label>
              <label className="auth-label"><span>Page text</span><textarea className="auth-input" rows={9} value={content.custom_page_body} onChange={(e) => update("custom_page_body", e.target.value)} /></label>
              <div className="panel" style={{ display: "grid", gap: ".75rem" }}>
                <strong>One page image</strong>
                {content.custom_page_image_url ? <img src={content.custom_page_image_url} alt="Custom page preview" style={{ width: "100%", maxWidth: 520, maxHeight: 360, objectFit: "cover", borderRadius: 18 }} /> : <div className="empty-state">No image uploaded.</div>}
                <label className="icon-btn" style={{ width: "fit-content", cursor: uploading ? "wait" : "pointer" }}><ImagePlus size={16} /> {uploading ? "Uploading..." : "Upload image"}<input hidden disabled={uploading} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadCustomPageImage(file); e.currentTarget.value = ""; }} /></label>
              </div>
              <div className="form-grid-2">
                <label className="auth-label"><span>Button text</span><input className="auth-input" value={content.custom_page_button_text} onChange={(e) => update("custom_page_button_text", e.target.value)} placeholder="Contact us" /></label>
                <label className="auth-label"><span>Button link</span><input className="auth-input" value={content.custom_page_button_url} onChange={(e) => update("custom_page_button_url", e.target.value)} placeholder="mailto:hello@example.com" /></label>
              </div>
              <label className="auth-label"><span><input type="checkbox" checked={content.custom_page_show_in_menu} onChange={(e) => update("custom_page_show_in_menu", e.target.checked)} /> Show page in website menu</span></label>
              <label className="auth-label"><span><input type="checkbox" disabled={!content.custom_page_addon_enabled} checked={content.custom_page_published} onChange={(e) => update("custom_page_published", e.target.checked)} /> Publish custom page</span></label>
            </section>

            <button className="wide-btn" disabled={saving} onClick={() => void saveContent()} type="button"><Save size={17} /> {saving ? "Saving..." : "Save website content"}</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
