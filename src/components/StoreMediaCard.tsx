import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { authorizeStorageUpload, cancelStorageUpload, completeStorageUpload } from "../lib/storageUploadAuthorization";
import { uploadDeniedFromError } from "../lib/uploadDenied";
import { backgroundCanContinue, backgroundKind, backgroundSizeAdvice, backgroundStoredSize, readabilityOverlay } from "../lib/backgroundRules";
import { logoCanContinue, logoSizeAdvice, logoStoredSize } from "../lib/logoRules";
import { extensionFor, mediaFilePath, mediaSaveMessage, parseStoreMedia, type MediaKind, type StoreMedia } from "../lib/storeMedia";

// The client's own logo and background (database draft 10). Pick a picture, see plain advice, tick the rights box, save. Nothing goes live until Save succeeds.
type Picked = { file: File; kind: "png" | "jpeg" | "webp"; width: number; height: number; previewUrl: string; overlay: number; note: string };

async function readPicture(file: File, wantOverlay: boolean): Promise<{ width: number; height: number; overlay: number; note: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    let overlay = 0, note = "";
    if (wantOverlay) {
      const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) { ctx.drawImage(bitmap, 0, 0, w, h); const found = readabilityOverlay({ width: w, height: h, data: ctx.getImageData(0, 0, w, h).data }); overlay = found.overlay; note = found.note; }
    }
    const out = { width: bitmap.width, height: bitmap.height, overlay, note };
    bitmap.close();
    return out;
  } catch { return null; }
}

// Never wider than 2400 px. Falls back to the original file when anything about resizing goes wrong.
async function limitSize(file: File, kind: "png" | "jpeg" | "webp", width: number, height: number, mediaKind: MediaKind): Promise<File> {
  const target = mediaKind === "logo" ? logoStoredSize(width, height) : backgroundStoredSize(width, height);
  if (!target || !target.resized) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas"); canvas.width = target.width; canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();
    const type = kind === "jpeg" ? "image/jpeg" : kind === "png" ? "image/png" : "image/webp";
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
    return blob && blob.size > 0 && blob.size < file.size ? new File([blob], file.name, { type }) : file;
  } catch { return file; }
}

export function StoreMediaCard() {
  const [media, setMedia] = useState<StoreMedia | null>(null);
  const [picked, setPicked] = useState<Record<MediaKind, Picked | null>>({ logo: null, background: null });
  const [rights, setRights] = useState<Record<MediaKind, boolean>>({ logo: false, background: false });
  const [soft, setSoft] = useState<Record<MediaKind, boolean>>({ logo: false, background: false });
  const [busy, setBusy] = useState<MediaKind | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    if (!supabase) return;
    const result = await supabase.rpc("get_my_store_media");
    if (!result.error) setMedia(parseStoreMedia(result.data));
  }
  useEffect(() => { void refresh(); }, []);

  async function choose(kind: MediaKind, file: File | undefined) {
    setError(""); setMessage("");
    const previous = picked[kind]; if (previous) URL.revokeObjectURL(previous.previewUrl);
    setPicked((current) => ({ ...current, [kind]: null })); setRights((c) => ({ ...c, [kind]: false })); setSoft((c) => ({ ...c, [kind]: false }));
    if (!file) return;
    const type = backgroundKind(file.type, file.name);
    if (!type) { setError(/svg/i.test(file.type + file.name) ? "SVG pictures are not supported here yet. Please use a PNG, JPEG or WEBP picture." : "Please choose a PNG, JPEG or WEBP picture."); return; }
    const info = await readPicture(file, kind === "background");
    if (!info) { setError("That picture could not be read. Please try a different file."); return; }
    setPicked((current) => ({ ...current, [kind]: { file, kind: type, width: info.width, height: info.height, previewUrl: URL.createObjectURL(file), overlay: info.overlay, note: info.note } }));
  }

  async function save(kind: MediaKind) {
    const item = picked[kind];
    if (!supabase || !item || !media?.clientId || busy) return;
    setBusy(kind); setError(""); setMessage("");
    const token = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = mediaFilePath(media.clientId, kind, extensionFor(item.kind), token);
    if (!path) { setBusy(""); setError("Something went wrong preparing the upload. Please try again."); return; }
    const file = await limitSize(item.file, item.kind, item.width, item.height, kind);
    let ticket: string;
    try { ticket = await authorizeStorageUpload(supabase, "commerce-website-content", path, file); }
    catch (caught) { setBusy(""); setError(uploadDeniedFromError(caught) ?? "Picture upload is not available under the current account limits or billing state."); return; }
    const upload = await supabase.storage.from("commerce-website-content").upload(path, file, { upsert: false, contentType: file.type });
    if (upload.error) { await cancelStorageUpload(supabase, ticket); setBusy(""); setError("The picture could not be uploaded. Your store was not changed."); return; }
    try { await completeStorageUpload(supabase, ticket); }
    catch { await supabase.storage.from("commerce-website-content").remove([path]); await cancelStorageUpload(supabase, ticket); setBusy(""); setError("The upload could not be finalized. Your store was not changed."); return; }
    const url = supabase.storage.from("commerce-website-content").getPublicUrl(path).data.publicUrl;
    const patch: Record<string, unknown> = { [kind]: url };
    if (kind === "background") patch.background_overlay = item.overlay;
    const saved = await supabase.rpc("save_my_store_media", { media_patch: patch });
    if (saved.error) { await supabase.storage.from("commerce-website-content").remove([path]); setBusy(""); setError(mediaSaveMessage(saved.error.message)); return; }
    setBusy(""); setPicked((current) => ({ ...current, [kind]: null })); setRights((c) => ({ ...c, [kind]: false })); setSoft((c) => ({ ...c, [kind]: false }));
    setMessage(kind === "logo" ? "Your logo is saved and shows on your store right away." : "Your background is saved and shows on your store right away.");
    await refresh();
  }

  async function remove(kind: MediaKind) {
    if (!supabase || busy) return;
    setBusy(kind); setError(""); setMessage("");
    const patch = kind === "background" ? { background: null, background_overlay: null } : { logo: null };
    const result = await supabase.rpc("save_my_store_media", { media_patch: patch });
    setBusy("");
    if (result.error) { setError(mediaSaveMessage(result.error.message)); return; }
    setMessage(kind === "logo" ? "Your logo was removed." : "Your background was removed.");
    await refresh();
  }

  function advice(kind: MediaKind, item: Picked) {
    return kind === "logo" ? logoSizeAdvice(item.kind, item.width) : backgroundSizeAdvice(item.width);
  }
  function problem(kind: MediaKind, item: Picked) {
    const input = { kind: item.kind, bytes: item.file.size, width: item.width, rightsConfirmed: rights[kind], acknowledgedSmall: soft[kind] };
    return kind === "logo" ? logoCanContinue(input) : backgroundCanContinue(input);
  }

  if (!media || !media.hasStorefront) return null;
  const current: Record<MediaKind, string | null> = { logo: media.logo, background: media.background };
  const title: Record<MediaKind, string> = { logo: "Your logo", background: "Your background" };
  const help: Record<MediaKind, string> = {
    logo: "Use your own logo, as large as you have it (2000 pixels wide or more looks best). Please do not use someone else's logo.",
    background: "A soft, calm picture works best (cream, pastel, gentle light). It sits behind your whole store, so avoid text and busy pictures.",
  };
  return <section className="panel panel-wide" data-testid="store-media-card">
    <div className="panel-title"><ImageIcon size={20} /><div><h2>Logo and background</h2><p className="subtle">Make your store look like yours. Changes show on your store as soon as you save.</p></div></div>
    {(["logo", "background"] as MediaKind[]).map((kind) => {
      const item = picked[kind]; const check = item ? problem(kind, item) : null; const note = item ? advice(kind, item) : null;
      return <div key={kind} className="settings-grid" style={{ marginBottom: "1rem" }} data-testid={`store-media-${kind}`}>
        <div>
          <strong>{title[kind]}</strong>
          <p className="subtle">{help[kind]}</p>
          {kind === "logo" && media.ownerLogo && !current.logo ? <p className="subtle">Your logo was set up by NXQX. Upload one here to replace it.</p> : null}
          {current[kind] ? <p><img src={current[kind] as string} alt="" style={{ maxWidth: "12rem", maxHeight: "7rem", objectFit: "contain", borderRadius: ".5rem" }} /></p> : null}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy)} onChange={(event) => { void choose(kind, event.target.files?.[0]); event.target.value = ""; }} aria-label={`Choose ${title[kind].toLowerCase()} picture`} />
          {item && note ? <div>
            <p><img src={item.previewUrl} alt="" style={{ maxWidth: "14rem", maxHeight: "8rem", objectFit: "contain", borderRadius: ".5rem" }} /></p>
            <p className="subtle">{item.width} × {item.height} pixels. {note.message}</p>
            {kind === "background" && item.note ? <p className="subtle">{item.note}</p> : null}
            {note.mustAcknowledge ? <label style={{ display: "block" }}><input type="checkbox" checked={soft[kind]} onChange={(e) => setSoft((c) => ({ ...c, [kind]: e.target.checked }))} /> I understand it may look soft, use it anyway</label> : null}
            <label style={{ display: "block" }}><input type="checkbox" checked={rights[kind]} onChange={(e) => setRights((c) => ({ ...c, [kind]: e.target.checked }))} /> This picture is mine, or I have permission to use it on my store</label>
            {check && !check.ok ? <p className="subtle">{check.reason}</p> : null}
            <button className="wide-btn" type="button" disabled={Boolean(busy) || !check?.ok} onClick={() => void save(kind)}>{busy === kind ? "Saving..." : `Save ${kind}`}</button>
          </div> : null}
          {current[kind] && !item ? <button className="icon-btn" type="button" disabled={Boolean(busy)} onClick={() => void remove(kind)}>Remove {kind}</button> : null}
        </div>
      </div>;
    })}
    {message ? <div className="auth-success" role="status">{message}</div> : null}
    {error ? <div className="auth-error" role="alert">{error}</div> : null}
  </section>;
}
