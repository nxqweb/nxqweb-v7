// The automatic background maker, with the picture provider kept OUTSIDE this file so a real provider is a one-line swap later.
// Order of checks: master switch and limits first (the provider is never called when they say no), then the provider, then the result is checked.
// The result is ALWAYS "waiting for the owner's approval"; nothing generated can go live by itself. Provider errors are never passed on to the client (they can contain account details).
import { buildBackgroundPrompt, BACKGROUND_SIZE, type BackgroundBrief } from "./backgroundPrompt.ts";
import { checkBackgroundRequest, type BackgroundLimitInput } from "./backgroundLimits.ts";
import { BACKGROUND_MAX_BYTES, backgroundKind } from "./backgroundRules.ts";

export type BackgroundImage = { mime: string; bytes: Uint8Array };
export type BackgroundProvider = { name: string; generate(prompt: string, size: { width: number; height: number }): Promise<BackgroundImage> };

export type GenerateOutcome =
  | { status: "pending_approval"; image: BackgroundImage; prompt: string; countsAgainstLimit: true }
  | { status: "refused"; reason: string; countsAgainstLimit: false }
  | { status: "failed"; reason: string; countsAgainstLimit: true };

// The provider used until the owner connects a real one: it makes nothing.
export const offProvider: BackgroundProvider = { name: "off", generate: async () => { throw new Error("no provider connected"); } };

export async function generateBackground(input: { brief: BackgroundBrief; limits: BackgroundLimitInput; provider: BackgroundProvider | null | undefined }): Promise<GenerateOutcome> {
  const gate = checkBackgroundRequest(input?.limits ?? {});
  if (!gate.ok) return { status: "refused", reason: gate.reason, countsAgainstLimit: false };
  const provider = input.provider;
  if (!provider || typeof provider.generate !== "function" || provider.name === "off") return { status: "refused", reason: "No picture maker is connected yet.", countsAgainstLimit: false };
  const prompt = buildBackgroundPrompt(input.brief ?? {});
  let image: BackgroundImage;
  try {
    image = await provider.generate(prompt, { ...BACKGROUND_SIZE });
  } catch {
    return { status: "failed", reason: "The picture could not be made this time. Please try again later.", countsAgainstLimit: true };
  }
  const kind = backgroundKind(image?.mime, undefined);
  if (!kind || !(image.bytes instanceof Uint8Array) || image.bytes.length === 0 || image.bytes.length > BACKGROUND_MAX_BYTES) {
    return { status: "failed", reason: "The picture that came back could not be used. Please try again later.", countsAgainstLimit: true };
  }
  return { status: "pending_approval", image, prompt, countsAgainstLimit: true };
}
