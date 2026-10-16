import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, LogOut, Package, Save, Trash2, UserRound } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { StoreCredit } from "../components/StoreCredit";
import { deleteShopperProfile, fetchShopperOrders, fetchShopperProfile, saveShopperProfile } from "../lib/shopperApi";
import {
  forgotPasswordSentMessage, formatOrderTotal, friendlyShopperError, isRecoveryUrl, normalizeProfileInput, orderStatusLabel, profileToCheckoutFields,
  resetRedirectUrl, shopperLimits, storeSlugFromPath, tooManyAttemptsMessage, validateCredentials, validateEmailOnly, validateNewPassword, type ShopperOrderRow, type ShopperProfileRow,
} from "../lib/shopperAccount";

export function PublicShopperAccount() {
  const slug = storeSlugFromPath(window.location.pathname);
  const storePath = `/store/${encodeURIComponent(slug)}`;
  const [storeName, setStoreName] = useState("this store");
  const [accountsEnabled, setAccountsEnabled] = useState<boolean | null>(null);
  const [signedInEmail, setSignedInEmail] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  // Read the URL on first render, before the auth library clears the recovery hash.
  const [recovering, setRecovering] = useState(() => isRecoveryUrl(window.location.hash, window.location.search));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [orders, setOrders] = useState<ShopperOrderRow[]>([]);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadAccount() {
    if (!supabase) return;
    const [profileResult, ordersResult] = await Promise.all([fetchShopperProfile(slug), fetchShopperOrders(slug)]);
    if (profileResult.error || ordersResult.error) {
      setError(friendlyShopperError(profileResult.error?.message || ordersResult.error?.message));
      setAccountLoaded(false);
      return;
    }
    const saved = profileToCheckoutFields(profileResult.data as ShopperProfileRow);
    setFullName(saved.name);
    setPhone(saved.phone);
    setAddress(saved.address);
    setOrders(((ordersResult.data as { orders?: ShopperOrderRow[] } | null)?.orders) || []);
    setAccountLoaded(true);
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!isSupabaseConfigured || !supabase) { setAccountsEnabled(false); return; }
      const [status, store, session] = await Promise.all([
        supabase.rpc("get_public_store_accounts_status", { store_slug_value: slug }),
        supabase.rpc("get_public_stripe_ready_commerce_storefront", { store_slug_value: slug }),
        supabase.auth.getSession(),
      ]);
      if (cancelled) return;
      const storeData = store.data as { store?: { name?: string } } | null;
      if (storeData?.store?.name) setStoreName(storeData.store.name);
      const enabled = Boolean((status.data as { accounts_enabled?: boolean } | null)?.accounts_enabled);
      setAccountsEnabled(enabled);
      const user = session.data.session?.user;
      if (enabled && recovering) {
        // Opened from a reset email: show the new-password form, or ask for a fresh link if the session did not form.
        if (!user) { setRecovering(false); setMode("forgot"); setError("This reset link is invalid or has expired. Request a new one."); }
      } else if (enabled && user?.email) { setSignedInEmail(user.email); await loadAccount(); }
    }
    void start();
    const listener = supabase?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") { setRecovering(true); setSignedInEmail(""); setAccountLoaded(false); }
    });
    return () => { cancelled = true; listener?.data.subscription.unsubscribe(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- slug is fixed for this mounted route

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError(""); setMessage("");
    const check = validateCredentials(email, password);
    if (!check.ok) { setError(check.error); return; }
    setBusy("auth");
    if (mode === "signup") {
      // No user metadata on purpose: a shopper must never be turned into a business client by the signup trigger.
      const result = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.href } });
      if (result.error) setError(friendlyShopperError(result.error.message));
      else if (!result.data.session) setMessage("Almost there! We sent a confirmation link to your email. Confirm it, then come back here and sign in.");
      else { setSignedInEmail(result.data.user?.email || email.trim()); await loadAccount(); }
    } else {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) setError(friendlyShopperError(result.error.message));
      else { setSignedInEmail(result.data.user?.email || email.trim()); setPassword(""); await loadAccount(); }
    }
    setBusy("");
  }

  async function submitForgot(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError(""); setMessage("");
    const check = validateEmailOnly(email);
    if (!check.ok) { setError(check.error); return; }
    setBusy("auth");
    const result = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: resetRedirectUrl(window.location.origin, slug) });
    // Same answer whether or not the email has an account, so nobody can use this form to find out who shops here.
    const friendly = result.error ? friendlyShopperError(result.error.message) : "";
    if (friendly === tooManyAttemptsMessage) setError(friendly);
    else setMessage(forgotPasswordSentMessage);
    setBusy("");
  }

  async function submitNewPassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError(""); setMessage("");
    const check = validateNewPassword(newPassword, confirmPassword);
    if (!check.ok) { setError(check.error); return; }
    setBusy("auth");
    const result = await supabase.auth.updateUser({ password: newPassword });
    if (result.error) { setError(friendlyShopperError(result.error.message)); setBusy(""); return; }
    const userResult = await supabase.auth.getUser();
    setNewPassword(""); setConfirmPassword(""); setRecovering(false);
    window.history.replaceState(null, "", window.location.pathname);
    if (userResult.data.user?.email) { setSignedInEmail(userResult.data.user.email); await loadAccount(); }
    setMessage("Your password was changed. You are signed in.");
    setBusy("");
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setError(""); setMessage("");
    const input = normalizeProfileInput({ fullName, phone, address });
    if (!input.ok) { setError(input.error); return; }
    setBusy("save");
    const result = await saveShopperProfile(slug, input.payload);
    if (result.error) setError(friendlyShopperError(result.error.message));
    else setMessage("Saved. We will fill these in for you at checkout.");
    setBusy("");
  }

  async function deleteDetails() {
    if (!supabase) return;
    if (!window.confirm("Delete your saved name, phone and address for this store? Your past orders stay in your history.")) return;
    setError(""); setMessage(""); setBusy("delete");
    const result = await deleteShopperProfile(slug);
    if (result.error) setError(friendlyShopperError(result.error.message));
    else { setFullName(""); setPhone(""); setAddress(""); setMessage("Your saved details were deleted."); }
    setBusy("");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSignedInEmail(""); setAccountLoaded(false); setOrders([]); setFullName(""); setPhone(""); setAddress(""); setMessage(""); setError("");
  }

  const backLink = <a className="icon-btn" href={storePath}><ArrowLeft size={16} /> Back to {storeName}</a>;

  if (accountsEnabled === null) return <main className="nxq-page store-theme"><div className="empty-state">Loading...</div></main>;

  if (!accountsEnabled) {
    return (
      <main className="nxq-page store-theme"><section className="portal-shell">
        <div className="panel-title panel-title-row"><div className="panel-title"><UserRound size={24} /><div><h1>Accounts</h1><p className="subtle">{storeName} does not offer customer accounts right now.</p></div></div>{backLink}</div>
        <section className="panel panel-wide"><p>You can still shop and check out as a guest.</p></section>
        <StoreCredit />
      </section></main>
    );
  }

  return (
    <main className="nxq-page store-theme"><section className="portal-shell">
      <div className="panel-title panel-title-row"><div className="panel-title"><UserRound size={24} /><div><h1>{recovering ? "Choose a new password" : signedInEmail ? "Your account" : mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Sign in"}</h1><p className="subtle">{storeName} · saved details and order history</p></div></div>{backLink}</div>
      {error ? <div className="auth-error" role="alert">{error}</div> : null}
      {message ? <div className="auth-success" role="status">{message}</div> : null}

      {recovering ? <section className="panel panel-wide">
        <div className="panel-title"><KeyRound size={20} /><div><h2>New password</h2><p className="subtle">Pick a new password for your {storeName} account.</p></div></div>
        <form onSubmit={(event) => void submitNewPassword(event)}>
          <div className="setup-form-grid">
            <label><span>New password</span><input className="auth-input" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
            <label><span>Confirm new password</span><input className="auth-input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label>
          </div>
          <button className="wide-btn" type="submit" disabled={busy === "auth"}>{busy === "auth" ? "One moment..." : "Change password"}</button>
        </form>
      </section> : !signedInEmail && mode === "forgot" ? <section className="panel panel-wide">
        <form onSubmit={(event) => void submitForgot(event)}>
          <div className="setup-form-grid">
            <label><span>Email</span><input className="auth-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </div>
          <button className="wide-btn" type="submit" disabled={busy === "auth"}>{busy === "auth" ? "One moment..." : "Send reset link"}</button>
        </form>
        <button className="icon-btn" type="button" onClick={() => { setMode("signin"); setError(""); setMessage(""); }}>Back to sign in</button>
      </section> : !signedInEmail ? <section className="panel panel-wide">
        <form onSubmit={(event) => void submitCredentials(event)}>
          <div className="setup-form-grid">
            <label><span>Email</span><input className="auth-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label><span>Password</span><input className="auth-input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </div>
          <button className="wide-btn" type="submit" disabled={busy === "auth"}>{busy === "auth" ? "One moment..." : mode === "signup" ? "Create account" : "Sign in"}</button>
        </form>
        <button className="icon-btn" type="button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setMessage(""); }}>
          {mode === "signup" ? "I already have an account" : "Create a new account"}
        </button>
        {mode === "signin" ? <button className="icon-btn" type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Forgot your password?</button> : null}
        <p className="subtle">An account is optional. You can always check out as a guest. We never ask for or store card details here.</p>
      </section> : <>
        <section className="panel panel-wide">
          <div className="panel-title panel-title-row"><div><strong>{signedInEmail}</strong><p className="subtle">Signed in</p></div><button className="icon-btn" type="button" onClick={() => void signOut()}><LogOut size={16} /> Sign out</button></div>
        </section>

        {accountLoaded ? <>
          <section className="panel panel-wide">
            <div className="panel-title"><Save size={20} /><div><h2>Saved details</h2><p className="subtle">Used to fill in checkout for you. No card details are saved here.</p></div></div>
            <form onSubmit={(event) => void saveDetails(event)}>
              <div className="setup-form-grid">
                <label><span>Name</span><input className="auth-input" autoComplete="name" maxLength={shopperLimits.name} value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
                <label><span>Phone</span><input className="auth-input" autoComplete="tel" maxLength={shopperLimits.phone} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                <label><span>Shipping address</span><input className="auth-input" autoComplete="street-address" maxLength={shopperLimits.address} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
              </div>
              <div className="settings-grid">
                <button className="wide-btn" type="submit" disabled={busy === "save"}>{busy === "save" ? "Saving..." : "Save details"}</button>
                <button className="icon-btn" type="button" disabled={busy === "delete"} onClick={() => void deleteDetails()}><Trash2 size={16} /> Delete saved details</button>
              </div>
            </form>
          </section>

          <section className="panel panel-wide">
            <div className="panel-title"><Package size={20} /><div><h2>Your orders</h2><p className="subtle">Orders placed at {storeName} with {signedInEmail}.</p></div></div>
            {orders.length === 0 ? <div className="empty-state">No orders yet.</div> : orders.map((order) => (
              <article className="settings-card" key={order.order_number} style={{ marginBottom: ".75rem" }}>
                <div className="panel-title panel-title-row"><div><strong>Order {order.order_number}</strong><p>{order.placed_at ? new Date(order.placed_at).toLocaleDateString() : ""}</p></div><strong>{formatOrderTotal(order)}</strong></div>
                <p>{orderStatusLabel(order)}</p>
              </article>
            ))}
          </section>
        </> : null}
      </>}
      <StoreCredit />
    </section></main>
  );
}
