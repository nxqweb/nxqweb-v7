// Decides whether the automatic background generator may run for a store right now. Pure rules, counted in pictures (never in money), so the
// owner sets the numbers. Nothing here calls a provider or the database; the real generator (a later, approved step) must ask this first.
export type BackgroundLimitInput = {
  switchedOn?: unknown; // the owner's master switch; anything but true means off
  now?: unknown; // epoch milliseconds
  clientUsedThisPeriod?: unknown; // pictures this store has already had this period (rejected tries count)
  clientAllowance?: unknown; // pictures this store may have per period
  allMadeThisMonth?: unknown; // pictures made for everyone this calendar month
  allMonthlyCap?: unknown; // the owner's hard monthly ceiling for everyone
  lastRequestAt?: unknown; // epoch ms of this store's last request, or null
  cooldownSeconds?: unknown; // minimum gap between two requests from one store
};

export type BackgroundLimitResult = { ok: boolean; reason: string };

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

export function checkBackgroundRequest(input: BackgroundLimitInput): BackgroundLimitResult {
  const no = (reason: string): BackgroundLimitResult => ({ ok: false, reason });
  if (input?.switchedOn !== true) return no("Automatic backgrounds are switched off right now.");
  const now = count(input.now), used = count(input.clientUsedThisPeriod), allowance = count(input.clientAllowance), all = count(input.allMadeThisMonth), cap = count(input.allMonthlyCap), cooldown = count(input.cooldownSeconds);
  // Anything we cannot read as a plain number means "do not run": a broken limit must never mean "no limit".
  if (now === null || used === null || allowance === null || all === null || cap === null || cooldown === null) return no("The limits could not be read, so nothing was run.");
  if (all >= cap) return no("The monthly limit for all stores has been reached. It resets next month, or the owner can raise it.");
  if (used >= allowance) return no("This store has used its background pictures for this period.");
  if (input.lastRequestAt !== null && input.lastRequestAt !== undefined) {
    const last = count(input.lastRequestAt);
    if (last === null) return no("The limits could not be read, so nothing was run.");
    const wait = Math.ceil((last + cooldown * 1000 - now) / 1000);
    if (wait > 0) return no(`Please wait ${wait} second${wait === 1 ? "" : "s"} before trying again.`);
  }
  return { ok: true, reason: "" };
}
