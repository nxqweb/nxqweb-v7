import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, Plus, RefreshCcw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Location = { id:string;location_code:string;display_name:string;is_primary:boolean;status:string;city:string|null;state_region:string|null;postal_code:string|null;phone:string|null;email:string|null;service_area:string|null;seo_slug:string;services?:{name:string;slug:string;summary?:string|null}[] };

export function ClientBusinessLocations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postal, setPostal] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [area, setArea] = useState("");
  const [services, setServices] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      setLoading(false);
      return;
    }
    const result = await supabase.rpc("current_client_locations");
    if (result.error) setError(result.error.message);
    else setLocations(((result.data as { locations?: Location[] } | null)?.locations) || []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function add() {
    if (!supabase || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    const serviceList = services.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 30);
    const result = await supabase.rpc("current_client_create_location", {
      target_display_name: name.trim() || `${city.trim()}, ${region.trim()}`,
      target_city: city.trim(),
      target_state_region: region.trim(),
      target_postal_code: postal.trim() || null,
      target_phone: phone.trim() || null,
      target_email: email.trim().toLowerCase() || null,
      target_service_area: area.trim() || null,
      target_services: serviceList,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setMessage("Location saved securely. NXQ queued its location page and SEO refresh automatically.");
    setName(""); setCity(""); setRegion(""); setPostal(""); setPhone(""); setEmail(""); setArea(""); setServices("");
    await load();
  }

  return <main className="nxq-page"><section className="portal-shell"><div className="panel-title panel-title-row"><div className="panel-title"><MapPin size={22}/><div><h1>Locations</h1><p className="subtle">Keep every location accurate in one place. NXQ handles location-page and local SEO refresh work automatically.</p></div></div><div className="client-control-row"><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a><button className="icon-btn" onClick={() => void load()} type="button"><RefreshCcw size={16}/> Refresh</button></div></div>{error ? <div className="auth-error">{error}</div> : null}{message ? <div className="auth-success">{message}</div> : null}<section className="panel panel-wide"><div className="panel-title"><Plus size={18}/><div><h2>Add a location</h2><p className="subtle">Standard plans support one primary location. Enterprise unlocks a unified multi-location website.</p></div></div><div className="setup-form-grid"><label><span>Location name</span><input className="auth-input" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Dallas North"/></label><label><span>City</span><input className="auth-input" maxLength={100} value={city} onChange={(event) => setCity(event.target.value)}/></label><label><span>State / region</span><input className="auth-input" maxLength={100} value={region} onChange={(event) => setRegion(event.target.value)}/></label><label><span>Postal code</span><input className="auth-input" maxLength={20} value={postal} onChange={(event) => setPostal(event.target.value)}/></label><label><span>Phone</span><input className="auth-input" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)}/></label><label><span>Email</span><input className="auth-input" maxLength={254} type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label><label><span>Service area</span><input className="auth-input" maxLength={500} value={area} onChange={(event) => setArea(event.target.value)}/></label><label><span>Services</span><input className="auth-input" value={services} onChange={(event) => setServices(event.target.value)} placeholder="Tree removal, trimming, storm cleanup"/><small>Separate services with commas.</small></label></div><button className="wide-btn" disabled={saving || !city.trim() || !region.trim()} onClick={() => void add()} type="button"><Plus size={16}/> {saving ? "Saving location..." : "Add location"}</button></section><section className="panel panel-wide"><h2>Current locations</h2>{loading ? <div className="empty-state">Loading locations...</div> : locations.length === 0 ? <div className="empty-state">No locations yet. Add the main business location above.</div> : <div style={{ display: "grid", gap: ".8rem" }}>{locations.map((location) => <article className="owner-message-card" key={location.id}><div className="panel-title panel-title-row"><div><strong>{location.display_name}</strong><p className="subtle">{location.location_code} · {location.city}, {location.state_region} · /locations/{location.seo_slug}/</p></div><span className="status-summary">{location.is_primary ? "Primary · " : ""}{location.status}</span></div>{location.service_area ? <p>Service area: {location.service_area}</p> : null}{location.services?.length ? <p className="subtle">Services: {location.services.map((service) => service.name).join(", ")}</p> : null}</article>)}</div>}</section></section></main>;
}
