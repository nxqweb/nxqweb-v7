import { useCallback, useEffect, useRef, useState } from "react";
import {
  moveWithinRole, nextSortOrder, photoErrorMessage, photoProblem, roleLabels, roomFor, scanLabel, shrinkPhoto,
  type PhotoRole, type PhotoUploader, type SitePhoto, type SitePhotosGateway,
} from "../lib/sitePhotos";

type QueueItem = { id: string; file: File; preview: string; altText: string; caption: string; error: string };

type Props = { gateway: SitePhotosGateway; upload: PhotoUploader };

let queueCounter = 0;

export function ClientSitePhotos({ gateway, upload }: Props) {
  const [photos, setPhotos] = useState<SitePhoto[]>([]);
  const [loadError, setLoadError] = useState("");
  const [role, setRole] = useState<PhotoRole>("work");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const previews = useRef<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      setPhotos(await gateway.list());
      setLoadError("");
    } catch (error) {
      setLoadError(photoErrorMessage(error));
    }
  }, [gateway]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { previews.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const room = Math.max(0, roomFor(photos, role) - queue.length);

  function pick(files: FileList | null) {
    if (!files) return;
    const found: string[] = [];
    const accepted: QueueItem[] = [];
    let space = room;
    for (const file of Array.from(files)) {
      const problem = photoProblem(file);
      if (problem) { found.push(problem); continue; }
      if (space <= 0) { found.push(`${file.name}: there is no room left for more photos here.`); continue; }
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      accepted.push({ id: `q${(queueCounter += 1)}`, file, preview, altText: "", caption: "", error: "" });
      space -= 1;
    }
    setProblems(found);
    setMessage("");
    if (accepted.length) setQueue((current) => [...current, ...accepted]);
  }

  function updateQueue(id: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function dropFromQueue(id: string) {
    setQueue((current) => {
      const gone = current.find((item) => item.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadAll() {
    if (busy || queue.length === 0) return;
    setBusy(true);
    setMessage("");
    let added = 0;
    let order = nextSortOrder(photos, role);
    for (const item of queue) {
      if (item.altText.trim().length < 3) { updateQueue(item.id, { error: "Describe this photo in a few words first." }); continue; }
      updateQueue(item.id, { error: "" });
      const smaller = await shrinkPhoto(item.file);
      const sent = await upload(smaller);
      if (!sent.ok) { updateQueue(item.id, { error: sent.message }); continue; }
      try {
        await gateway.save({ fileId: sent.fileId, role, altText: item.altText.trim(), caption: item.caption.trim(), sortOrder: order });
        order += 1;
        added += 1;
        dropFromQueue(item.id);
      } catch (error) {
        updateQueue(item.id, { error: photoErrorMessage(error) });
      }
    }
    setBusy(false);
    if (added > 0) setMessage(added === 1 ? "1 photo added. It is being checked for safety." : `${added} photos added. They are being checked for safety.`);
    await refresh();
  }

  async function change(photo: SitePhoto, patch: Partial<Pick<SitePhoto, "role" | "altText" | "caption" | "sortOrder">>) {
    setMessage("");
    try {
      await gateway.save({
        fileId: photo.fileId, role: patch.role ?? photo.role, altText: patch.altText ?? photo.altText, caption: patch.caption ?? photo.caption, sortOrder: patch.sortOrder ?? photo.sortOrder,
      });
      await refresh();
    } catch (error) {
      setMessage(photoErrorMessage(error));
    }
  }

  async function move(photo: SitePhoto, direction: -1 | 1) {
    const swap = moveWithinRole(photos, photo.fileId, direction);
    if (!swap) return;
    setMessage("");
    try {
      for (const entry of swap) {
        const current = photos.find((item) => item.fileId === entry.fileId);
        if (current) await gateway.save({ fileId: current.fileId, role: current.role, altText: current.altText, caption: current.caption, sortOrder: entry.sortOrder });
      }
      await refresh();
    } catch (error) {
      setMessage(photoErrorMessage(error));
    }
  }

  async function remove(photo: SitePhoto) {
    if (!window.confirm(`Take "${photo.fileName}" off your website photos? The file itself stays in your Files.`)) return;
    setMessage("");
    try {
      await gateway.remove(photo.fileId);
      await refresh();
    } catch (error) {
      setMessage(photoErrorMessage(error));
    }
  }

  const grouped: PhotoRole[] = ["work", "site"];

  return (
    <fieldset className="site-photos" data-testid="site-photos">
      <legend>Photos for your website</legend>
      <p className="subtle">
        Photos of your work appear in an "Our work" section on your website. Other photos (your logo, your team, your shop front) go to your NXQX team. Every photo is checked for
        safety before anyone can see it, and we shrink big photos for you. Use JPG, PNG or WebP.
      </p>
      {loadError ? <p className="auth-error" role="alert">{loadError}</p> : null}

      <label className="auth-label" htmlFor="site-photo-role">What are these photos?</label>
      <select className="auth-input" disabled={busy} id="site-photo-role" onChange={(event) => setRole(event.target.value as PhotoRole)} value={role}>
        {grouped.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
      </select>

      <label className="auth-label" htmlFor="site-photo-files">Choose photos <small>(you can pick several; room for {room} more here)</small></label>
      <input accept="image/jpeg,image/png,image/webp" className="auth-input" disabled={busy || room === 0} id="site-photo-files" multiple onChange={(event) => { pick(event.target.files); event.target.value = ""; }} type="file" />
      {problems.length > 0 ? <div className="auth-error" role="alert"><ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div> : null}

      {queue.length > 0 ? (
        <div className="site-photo-queue" data-testid="site-photo-queue">
          {queue.map((item) => (
            <div className="site-photo-row" key={item.id}>
              <img alt="" className="site-photo-thumb" src={item.preview} />
              <div className="site-photo-fields">
                <strong>{item.file.name}</strong>
                <label className="auth-label" htmlFor={`alt-${item.id}`}>Describe this photo <em className="required-mark">(required)</em></label>
                <input className="auth-input" disabled={busy} id={`alt-${item.id}`} maxLength={160} onChange={(event) => updateQueue(item.id, { altText: event.target.value })} placeholder="Example: A large oak after it was trimmed" value={item.altText} />
                <label className="auth-label" htmlFor={`cap-${item.id}`}>Caption <small>(optional, shown under the photo)</small></label>
                <input className="auth-input" disabled={busy} id={`cap-${item.id}`} maxLength={160} onChange={(event) => updateQueue(item.id, { caption: event.target.value })} value={item.caption} />
                {item.error ? <p className="auth-error" role="alert">{item.error}</p> : null}
                <button className="icon-btn" disabled={busy} onClick={() => dropFromQueue(item.id)} type="button">Remove from this batch</button>
              </div>
            </div>
          ))}
          <button className="wide-btn" disabled={busy} onClick={() => void uploadAll()} type="button">{busy ? "Uploading..." : queue.length === 1 ? "Add this photo" : `Add these ${queue.length} photos`}</button>
        </div>
      ) : null}

      {message ? <p className="subtle" role="status">{message}</p> : null}

      {photos.length > 0 ? (
        <div className="site-photo-list" data-testid="site-photo-list">
          <button className="icon-btn" onClick={() => void refresh()} type="button">Check photo status</button>
          {grouped.map((group) => {
            const inGroup = photos.filter((photo) => photo.role === group).sort((a, b) => a.sortOrder - b.sortOrder);
            if (inGroup.length === 0) return null;
            return (
              <section key={group}>
                <h3>{roleLabels[group]}</h3>
                {inGroup.map((photo, index) => {
                  const state = scanLabel(photo);
                  return (
                    <div className="site-photo-row" data-testid="site-photo-item" key={photo.fileId}>
                      <div className="site-photo-fields">
                        <strong>{photo.fileName}</strong>
                        <span className={`scan-pill ${state.tone}`}>{state.text}</span>
                        <label className="auth-label" htmlFor={`desc-${photo.fileId}`}>Description</label>
                        <input className="auth-input" defaultValue={photo.altText} id={`desc-${photo.fileId}`} maxLength={160} onBlur={(event) => { if (event.target.value.trim() !== photo.altText) void change(photo, { altText: event.target.value.trim() }); }} />
                        <div className="site-photo-actions">
                          <button aria-label={`Move ${photo.fileName} up`} className="icon-btn" disabled={index === 0} onClick={() => void move(photo, -1)} type="button">Up</button>
                          <button aria-label={`Move ${photo.fileName} down`} className="icon-btn" disabled={index === inGroup.length - 1} onClick={() => void move(photo, 1)} type="button">Down</button>
                          <button className="icon-btn" onClick={() => void change(photo, { role: photo.role === "work" ? "site" : "work" })} type="button">{photo.role === "work" ? "Move to other photos" : "Show in Our work"}</button>
                          <button className="icon-btn" onClick={() => void remove(photo)} type="button">Remove</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      ) : null}
    </fieldset>
  );
}
