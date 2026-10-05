import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, Plus, RefreshCcw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type Location = { id:string;location_code:string;display_name:string;is_primary:boolean;status:string;city:string|null;state_region:string|null;postal_code:string|null;phone:string|null;email:string|null;service_area:string|null;seo_slug:string;services?:{name:string;slug:string;summary?:string|null}[] };
type Entitlement = { tier_key:string|null;active_location_count:number;effective_cap:number;over_entitlement:boolean;enabled_addon_units:number;can_enable_addon:boolean;can_cancel_addon:boolean;unit_price_cents:number;base_price_cents:number;addon_amount_cents:number;internal_total_cents:number };

const centsToDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function ClientBusinessLocations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
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
  const [addonBusy, setAddonBusy] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  async function load() {
    setLoading(true);
    setVerified(false);
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Locations are temporarily unavailable. No location data was changed.");
      setLoading(false);
      return;
    }
    const sessionResult = await supabase.auth.getSession();
    if (!sessionResult.data.session) {
      window.location.replace("/portal/login");
      return;
    }
    const result = await supabase.rpc("current_client_locations");
    if (result.error) {
      setError("Locations could not be verified right now. No location data was changed.");
      setLoading(false);
      return;
    }
    const data = (result.data as (Entitlement & { locations?: Location[] }) | null);
    setLocations(data?.locations || []);
    setEntitlement(data ? {
      tier_key: data.tier_key,
      active_location_count: data.active_location_count,
      effective_cap: data.effective_cap,
      over_entitlement: data.over_entitlement,
      enabled_addon_units: data.enabled_addon_units,
      can_enable_addon: data.can_enable_addon,
      can_cancel_addon: data.can_cancel_addon,
      unit_price_cents: data.unit_price_cents,
      base_price_cents: data.base_price_cents,
      addon_amount_cents: data.addon_amount_cents,
      internal_total_cents: data.internal_total_cents,
    } : null);
    setVerified(true);
    setLoading(false);
  }

  async function enableAddon() {
    if (!supabase || addonBusy) return;
    setAddonBusy(true);
    setError("");
    setMessage("");
    const result = await supabase.rpc("current_client_enable_location_addon");
    setAddonBusy(false);
    if (result.error) {
      setError(result.error.message || "The location add-on could not be enabled.");
      return;
    }
    const data = result.data as { message?: string } | null;
    setMessage(data?.message || "Location add-on enabled.");
    await load();
  }

  async function cancelAddon() {
    if (!supabase || addonBusy) return;
    setAddonBusy(true);
    setError("");
    setMessage("");
    const result = await supabase.rpc("current_client_cancel_location_addon");
    setAddonBusy(false);
    if (result.error) {
      setError(result.error.message || "The location add-on could not be cancelled.");
      return;
    }
    const data = result.data as { message?: string } | null;
    setMessage(data?.message || "Location add-on cancelled.");
    await load();
  }

  async function closeLocation(locationId: string) {
    if (!supabase || closingId) return;
    setClosingId(locationId);
    setError("");
    setMessage("");
    const result = await supabase.rpc("current_client_close_location", { target_location_id: locationId });
    setClosingId(null);
    if (result.error) {
      setError(result.error.message || "This location could not be closed.");
      return;
    }
    setMessage("Location closed. Its data was not deleted.");
    await load();
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
      setError("The location could not be saved. No new location or SEO refresh was queued.");
      return;
    }
    setMessage("Location saved. Any location-page or SEO work will continue through NXQX's normal guarded workflow.");
    setName(""); setCity(""); setRegion(""); setPostal(""); setPhone(""); setEmail(""); setArea(""); setServices("");
    await load();
  }

  return <main className="nxq-page"><section className="portal-shell"><div className="panel-title panel-title-row"><div className="panel-title"><MapPin size={22}/><div><h1>Locations</h1><p className="subtle">Keep every location accurate in one place. Location-page and local SEO work stays behind the same review and publishing protections as the rest of your website.</p></div></div><div className="client-control-row"><a className="icon-btn" href="/client/business"><ArrowLeft size={16}/> Business</a><button className="icon-btn" disabled={loading || saving} onClick={() => void load()} type="button"><RefreshCcw size={16}/> Refresh</button></div></div>{error ? <div className="auth-error" role="alert">{error}</div> : null}{message ? <div className="auth-success">{message}</div> : null}{verified && entitlement ? <section className="panel panel-wide"><h2>Location plan</h2><p className="subtle">{entitlement.active_location_count} of {entitlement.effective_cap} locations in use{entitlement.tier_key ? ` on your ${entitlement.tier_key} plan` : ""}.</p>{entitlement.over_entitlement ? <div className="auth-error" role="alert">You have more active locations than your current plan allows. Close a location or enable a location add-on so NXQX does not have to restrict your account. NXQX never closes a location automatically.</div> : null}<p className="subtle">Base plan: {centsToDollars(entitlement.base_price_cents)}/mo · Location add-ons: {centsToDollars(entitlement.addon_amount_cents)}/mo ({entitlement.enabled_addon_units} × {centsToDollars(entitlement.unit_price_cents)}) · Internal total: {centsToDollars(entitlement.internal_total_cents)}/mo</p><p className="subtle">This total is for your reference only. While NXQX billing is off, nothing here is charged; enabling or cancelling an add-on never charges or refunds you.</p>{(entitlement.can_enable_addon || entitlement.can_cancel_addon) ? <div className="client-control-row">{entitlement.can_enable_addon ? <button className="icon-btn" disabled={addonBusy} onClick={() => void enableAddon()} type="button">{addonBusy ? "Working..." : `Add a location (+${centsToDollars(entitlement.unit_price_cents)}/mo)`}</button> : null}{entitlement.can_cancel_addon ? <button className="icon-btn" disabled={addonBusy} onClick={() => void cancelAddon()} type="button">{addonBusy ? "Working..." : "Cancel a location add-on"}</button> : null}</div> : null}{entitlement.tier_key && !["growth","intelligence","enterprise"].includes(entitlement.tier_key) ? <p className="subtle">Location add-ons are available on Growth and Intelligence plans. Enterprise already includes multi-location.</p> : null}</section> : null}<section className="panel panel-wide"><div className="panel-title"><Plus size={18}/><div><h2>Add a location</h2><p className="subtle">Standard plans support one primary location. Growth and Intelligence can add extra locations above. Enterprise unlocks a unified multi-location website.</p></div></div><div className="setup-form-grid"><label><span>Location name</span><input className="auth-input" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Dallas North"/></label><label><span>City</span><input className="auth-input" maxLength={100} value={city} onChange={(event) => setCity(event.target.value)}/></label><label><span>State / region</span><input className="auth-input" maxLength={100} value={region} onChange={(event) => setRegion(event.target.value)}/></label><label><span>Postal code</span><input className="auth-input" maxLength={20} value={postal} onChange={(event) => setPostal(event.target.value)}/></label><label><span>Phone</span><input className="auth-input" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)}/></label><label><span>Email</span><input className="auth-input" maxLength={254} type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label><label><span>Service area</span><input className="auth-input" maxLength={500} value={area} onChange={(event) => setArea(event.target.value)}/></label><label><span>Services</span><input className="auth-input" value={services} onChange={(event) => setServices(event.target.value)} placeholder="Tree removal, trimming, storm cleanup"/><small>Separate services with commas.</small></label></div><button className="wide-btn" disabled={saving || loading || !city.trim() || !region.trim()} onClick={() => void add()} type="button"><Plus size={16}/> {saving ? "Saving location..." : "Add location"}</button><p className="subtle">Adding a location does not by itself publish a location page or bypass plan, review, SEO, or production gates.</p></section><section className="panel panel-wide"><h2>Current locations</h2>{loading ? <div className="empty-state">Loading locations...</div> : verified && locations.length === 0 ? <div className="empty-state">No locations yet. Add the main business location above.</div> : verified ? <div style={{ display: "grid", gap: ".8rem" }}>{locations.map((location) => <article className="owner-message-card" key={location.id}><div className="panel-title panel-title-row"><div><strong>{location.display_name}</strong><p className="subtle">{location.location_code} · {location.city}, {location.state_region} · /locations/{location.seo_slug}/</p></div><span className="status-summary">{location.is_primary ? "Primary · " : ""}{location.status}</span></div>{location.service_area ? <p>Service area: {location.service_area}</p> : null}{location.services?.length ? <p className="subtle">Services: {location.services.map((service) => service.name).join(", ")}</p> : null}{!location.is_primary ? <button className="icon-btn" disabled={closingId === location.id} onClick={() => void closeLocation(location.id)} type="button">{closingId === location.id ? "Closing..." : "Close location"}</button> : null}</article>)}</div> : null}</section></section></main>;
}
