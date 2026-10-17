import { useEffect } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { claimOutcome, claimedReferralKey, clearPendingReferral, isNewAccount, readPendingReferral, referralCodeFromUser } from "../lib/referralCode";

let attempting = false;

// Shows nothing. On a client page it applies a referral code the person arrived with (remembered in their account data or in this browser), once.
// Failures are silent on purpose: this is a bonus, never a blocker. A code that can never work is dropped; one that may work later is kept.
export function ReferralClaimer() {
  useEffect(() => {
    if (attempting || !isSupabaseConfigured || !supabase) return;
    attempting = true;
    const client = supabase;
    void (async () => {
      try {
        const session = await client.auth.getSession();
        const user = session.data.session?.user;
        if (!user) return;
        try { if (window.localStorage.getItem(claimedReferralKey(user.id))) return; } catch { /* continue: the database rejects a second claim anyway */ }
        // The browser-remembered code only counts for a brand-new account (see referralCode.ts); the account's own saved code always counts.
        const code = referralCodeFromUser(user) || (isNewAccount(user.created_at, Date.now()) ? readPendingReferral() : "");
        if (!code) return;
        const result = await client.rpc("nxq_claim_referral", { target_referral_code: code });
        if (!result.error || claimOutcome(result.error.message) === "done") {
          try { window.localStorage.setItem(claimedReferralKey(user.id), "1"); } catch { /* cosmetic */ }
          clearPendingReferral();
        }
      } catch { /* try again on a later visit */ } finally { attempting = false; }
    })();
  }, []);
  return null;
}
