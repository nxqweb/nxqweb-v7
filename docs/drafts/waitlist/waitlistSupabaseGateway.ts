// The real connection for the pre-launch waiting list. DRAFT (docs/drafts/waitlist/); the final home is src/lib/waitlistSupabaseGateway.ts.
// It is NOT used anywhere until the one switch in src/lib/waitlistConfig.ts is set, which happens only after migration (waitlist) is applied, join-waitlist is deployed,
// and the owner has turned the function's own switch on. scripts/test-waitlist.mjs checks these exact call names and argument names against the SQL.
import type { SupabaseClient } from "@supabase/supabase-js";
import { WAITLIST_OK_MESSAGE, joinFailureMessage, summaryFromRpc, type WaitlistGateway } from "./waitlist";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function createWaitlistGateway(client: SupabaseClient): WaitlistGateway {
  return {
    async join({ email, source, honeypot }) {
      const { data, error } = await client.functions.invoke("join-waitlist", { body: { email, source, company_website: honeypot } });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status ?? 0;
        return { ok: false, message: joinFailureMessage(status) };
      }
      const answer = data as { ok?: boolean; message?: string } | null;
      return answer?.ok === true ? { ok: true, message: answer.message || WAITLIST_OK_MESSAGE } : { ok: false, message: joinFailureMessage(0) };
    },
    async summary() { return summaryFromRpc(check(await client.rpc("owner_waitlist_summary"))); },
    async inviteWave(wave, count) {
      const data = check(await client.rpc("owner_waitlist_invite_wave", { target_wave: wave, target_count: count })) as { invited?: number } | null;
      return typeof data?.invited === "number" ? data.invited : 0;
    },
  };
}
