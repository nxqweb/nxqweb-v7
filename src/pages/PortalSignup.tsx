import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, MailCheck, Sparkles } from "lucide-react";
import {
  getProductFamily,
  getRequestedProductFamily,
  isPubliclySelectableFamily,
  productTiers,
  type ProductTierKey,
} from "../lib/productCatalog";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export function PortalSignup() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedFamily = useMemo(
    () => getRequestedProductFamily(searchParams.get("family")),
    [searchParams]
  );
  const selectedFamily = useMemo(
    () => getProductFamily(searchParams.get("family")),
    [searchParams]
  );
  const unavailableFamily =
    requestedFamily && !isPubliclySelectableFamily(requestedFamily) ? requestedFamily : null;

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
  const [familyDetails, setFamilyDetails] = useState("");
  const [familyAnswers, setFamilyAnswers] = useState<Record<string, string>>({});
  const [serviceArea, setServiceArea] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [tierGoal, setTierGoal] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tier = productTiers.find((item) => item.key === selectedTier) || productTiers[0];

  const tierQuestion = useMemo(() => {
    if (selectedTier === "growth") {
      return {
        label: "What should growth focus on first?",
        placeholder: "Examples: local search visibility, more estimate requests, stronger service pages, better calls to action.",
      };
    }
    if (selectedTier === "intelligence") {
      return {
        label: "What result should we measure and improve?",
        placeholder: "Examples: more qualified leads, more calls, better form completion, stronger conversion on a key service page.",
      };
    }
    if (selectedTier === "enterprise") {
      return {
        label: "What makes this project operationally complex?",
        placeholder: "Locations, departments, permissions, routing, reporting, custom workflows, larger page counts, or higher usage.",
      };
    }
    return {
      label: "What matters most for the first version?",
      placeholder: "Examples: look more professional, replace an old site, make it easier for customers to contact us.",
    };
  }, [selectedTier]);

  function updateFamilyAnswer(key: string, value: string) {
    setFamilyAnswers((current) => ({ ...current, [key]: value }));
  }

  async function handleSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedBusinessName = businessName.trim();
    const trimmedContactName = contactName.trim();
    const trimmedEmail = email.trim();
    const trimmedFamilyDetails = familyDetails.trim();
    const trimmedPrimaryGoal = primaryGoal.trim();
    const missingFamilyQuestion = selectedFamily.intakeQuestions.find(
      (question) => question.required && !(familyAnswers[question.key] || "").trim()
    );

    setStatusMessage("");
    setErrorMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Account creation is temporarily unavailable. Please try again later.");
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

    if (!trimmedFamilyDetails || !trimmedPrimaryGoal) {
      setErrorMessage("Complete the project-fit questions so NXQ can prepare the right setup after verification.");
      return;
    }

    if (missingFamilyQuestion) {
      setErrorMessage(`Complete the required ${selectedFamily.name} question: ${missingFamilyQuestion.label}`);
      return;
    }

    if (!trimmedEmail || !password) {
      setErrorMessage("Enter your email and create a password.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);

    const sanitizedFamilyAnswers = Object.fromEntries(
      selectedFamily.intakeQuestions
        .map((question) => [question.key, (familyAnswers[question.key] || "").trim()] as const)
        .filter(([, value]) => value.length > 0)
    );

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
          intake_family_details: trimmedFamilyDetails,
          intake_family_answers: sanitizedFamilyAnswers,
          intake_service_area: serviceArea.trim(),
          intake_primary_goal: trimmedPrimaryGoal,
          intake_tier_goal: tierGoal.trim(),
        },
      },
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage("We could not create the account right now. Check your details or try again shortly.");
      return;
    }

    setStatusMessage("Account created. Check your email to verify your account.");
    window.location.href = "/portal/check-email";
  }

  return (
    <main className="lux-home">
      <section className="premium-signup-shell">
        <a className="lux-btn lux-btn-secondary" href="/#pricing">
          <ArrowLeft size={15} />
          Change family or tier
        </a>

        <form className="lux-card premium-signup-card" onSubmit={handleSignup}>
          <div className="lux-section-head">
            <span><Sparkles size={14} /> Project setup</span>
            <h2>{selectedFamily.name} · {tier.name}</h2>
            <p>
              This first step is matched to the website system and service level you selected. After verification, your client workspace continues into the full project setup and review process.
            </p>
          </div>

          {unavailableFamily ? (
            <div className="notice-card">
              <strong>{unavailableFamily.name} is still in development.</strong>
              <p>NXQ-Business is available now, so we switched you to a client-ready option.</p>
            </div>
          ) : null}

          <div className="premium-selection-summary">
            <span className="lux-plan-badge">{selectedFamily.name}</span>
            <span className="lux-plan-badge">{tier.name} · {tier.priceLabel}</span>
            <span className="lux-plan-badge">{tier.outcome}</span>
          </div>

          <section className="premium-intake-box">
            <div className="panel-title">
              <CheckCircle2 size={20} />
              <div>
                <h2>Choose your service level</h2>
                <p className="subtle">You can change this before creating the account.</p>
              </div>
            </div>

            <div className="premium-tier-grid">
              {productTiers.map((item) => {
                const isSelected = selectedTier === item.key;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={`premium-tier-option ${isSelected ? "selected" : ""}`}
                    key={item.key}
                    onClick={() => setSelectedTier(item.key)}
                    type="button"
                  >
                    <span>{item.priceLabel}</span>
                    <strong>{item.name}</strong>
                    <small>{item.outcome}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="premium-intake-box">
            <h2>Tell us what we are building around.</h2>
            <p>The questions below change with the family and tier so your setup reflects the kind of business and website you actually need.</p>

            <div className="premium-form-grid">
              <label>
                <span>Business name</span>
                <input autoComplete="organization" className="auth-input" onChange={(event) => setBusinessName(event.target.value)} placeholder="Smith Tree Service" type="text" value={businessName} />
              </label>

              <label>
                <span>Your name</span>
                <input autoComplete="name" className="auth-input" onChange={(event) => setContactName(event.target.value)} placeholder="John Smith" type="text" value={contactName} />
              </label>

              <label className="full">
                <span>{selectedFamily.intakeLabel}</span>
                <textarea className="auth-input" onChange={(event) => setFamilyDetails(event.target.value)} placeholder={selectedFamily.intakePlaceholder} rows={4} value={familyDetails} />
              </label>

              {selectedFamily.intakeQuestions.map((question) => (
                <label className={question.multiline ? "full" : undefined} key={question.key}>
                  <span>{question.label}{question.required ? " *" : ""}</span>
                  {question.multiline ? (
                    <textarea
                      className="auth-input"
                      onChange={(event) => updateFamilyAnswer(question.key, event.target.value)}
                      placeholder={question.placeholder}
                      rows={3}
                      value={familyAnswers[question.key] || ""}
                    />
                  ) : (
                    <input
                      className="auth-input"
                      onChange={(event) => updateFamilyAnswer(question.key, event.target.value)}
                      placeholder={question.placeholder}
                      type="text"
                      value={familyAnswers[question.key] || ""}
                    />
                  )}
                </label>
              ))}

              <label>
                <span>Primary service area or market</span>
                <input className="auth-input" onChange={(event) => setServiceArea(event.target.value)} placeholder="Chico, CA and nearby communities" type="text" value={serviceArea} />
              </label>

              <label>
                <span>Primary website goal</span>
                <input className="auth-input" onChange={(event) => setPrimaryGoal(event.target.value)} placeholder="More estimate requests" type="text" value={primaryGoal} />
              </label>

              <label className="full">
                <span>{tierQuestion.label}</span>
                <textarea className="auth-input" onChange={(event) => setTierGoal(event.target.value)} placeholder={tierQuestion.placeholder} rows={3} value={tierGoal} />
              </label>
            </div>
          </section>

          <section className="premium-intake-box">
            <h2>Create your NXQ client account.</h2>
            <p>Your selection and project details stay attached to the account so your workspace can continue with the right website and service context.</p>

            <div className="premium-form-grid">
              <label>
                <span>Email</span>
                <input autoComplete="email" className="auth-input" id="signup-email" onChange={(event) => setEmail(event.target.value)} placeholder="client@example.com" type="email" value={email} />
              </label>

              <label>
                <span>Password</span>
                <input autoComplete="new-password" className="auth-input" id="signup-password" minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" type="password" value={password} />
              </label>
            </div>
          </section>

          {errorMessage ? <div className="auth-error" role="alert">{errorMessage}</div> : null}
          {statusMessage ? <div className="auth-success" role="status">{statusMessage}</div> : null}

          <div className="notice-card">
            <strong>{selectedFamily.name} · {tier.name}</strong>
            <p>
              Creating an account does not approve or launch the project. NXQ reviews the completed setup before managed build work can move forward.
            </p>
          </div>

          <button className="lux-btn lux-btn-primary auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Creating account..." : "Create account and continue"}
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
