import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, MailCheck, UserPlus } from "lucide-react";
import { getProductFamily, productTiers, type ProductTierKey } from "../lib/productCatalog";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export function PortalSignup() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const selectedFamily = useMemo(
    () => getProductFamily(searchParams.get("family")),
    [searchParams]
  );

  const initialTier = searchParams.get("tier");
  const [selectedTier, setSelectedTier] = useState<ProductTierKey>(
    productTiers.some((tier) => tier.key === initialTier)
      ? (initialTier as ProductTierKey)
      : "starter"
  );
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedBusinessName = businessName.trim();
    const trimmedContactName = contactName.trim();
    const trimmedEmail = email.trim();

    setStatusMessage("");
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Check .env.local.");
      return;
    }

    if (!trimmedBusinessName) {
      setErrorMessage("Enter your business name.");
      return;
    }

    if (!trimmedContactName) {
      setErrorMessage("Enter your name.");
      return;
    }

    if (!trimmedEmail || !password) {
      setErrorMessage("Enter your email and create a password.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/portal/login`,
        data: {
          business_name: trimmedBusinessName,
          contact_name: trimmedContactName,
          product_family_slug: selectedFamily.slug,
          product_tier_key: selectedTier,
        },
      },
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setStatusMessage("Account created. Check your email to verify your account.");
    window.location.href = "/portal/check-email";
  }

  return (
    <main className="nxq-page">
      <section className="portal-shell portal-auth-shell">
        <a className="badge" href="/plans">
          <ArrowLeft size={15} />
          Change product family
        </a>

        <form className="auth-card" onSubmit={handleSignup}>
          <div className="panel-title">
            <UserPlus size={22} />
            <div>
              <h1>Create account</h1>
              <p className="subtle">{selectedFamily.name}</p>
            </div>
          </div>

          <p className="subtle">{selectedFamily.description}</p>

          <section className="panel">
            <div className="panel-title">
              <CheckCircle2 size={20} />
              <div>
                <h2>Choose your tier</h2>
                <p className="subtle">
                  Your product family is selected. Choose the monthly service level that fits your business.
                </p>
              </div>
            </div>

            <div className="settings-grid">
              {productTiers.map((tier) => {
                const isSelected = selectedTier === tier.key;

                return (
                  <button
                    className={`settings-card ${isSelected ? "selected-plan-card" : ""}`}
                    key={tier.key}
                    onClick={() => setSelectedTier(tier.key)}
                    type="button"
                  >
                    <span>{tier.name}</span>
                    <strong>{tier.priceLabel}</strong>
                    <p>{tier.description}</p>
                    <small>{isSelected ? "Selected" : "Choose this tier"}</small>
                  </button>
                );
              })}
            </div>
          </section>

          {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}
          {statusMessage ? <div className="auth-success">{statusMessage}</div> : null}

          <label className="auth-label" htmlFor="business-name">
            Business name
          </label>
          <input
            className="auth-input"
            id="business-name"
            onChange={(event) => setBusinessName(event.target.value)}
            placeholder="Smith Tree Service"
            type="text"
            value={businessName}
          />

          <label className="auth-label" htmlFor="contact-name">
            Your name
          </label>
          <input
            className="auth-input"
            id="contact-name"
            onChange={(event) => setContactName(event.target.value)}
            placeholder="John Smith"
            type="text"
            value={contactName}
          />

          <label className="auth-label" htmlFor="signup-email">
            Email
          </label>
          <input
            className="auth-input"
            id="signup-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="client@example.com"
            type="email"
            value={email}
          />

          <label className="auth-label" htmlFor="signup-password">
            Password
          </label>
          <input
            className="auth-input"
            id="signup-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Create a secure password"
            type="password"
            value={password}
          />

          <div className="notice-card">
            <strong>
              {selectedFamily.name} · {productTiers.find((tier) => tier.key === selectedTier)?.name}
            </strong>
            <p>
              This selection will be saved to your NXQ client workspace. Major plan or product-family changes can later be requested from Client Settings.
            </p>
          </div>

          <button className="primary-btn auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Creating account..." : "Create account"}
            <MailCheck size={18} />
          </button>

          <p className="auth-note">
            Already have an account? <a href="/portal/login">Log in</a>
          </p>
        </form>
      </section>
    </main>
  );
}
