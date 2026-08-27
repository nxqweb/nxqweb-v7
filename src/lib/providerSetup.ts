export type ProviderSetupGroup = {
  id: "notifications" | "malware" | "ai";
  title: string;
  purpose: string;
  accountTask: string;
  secretNames: readonly string[];
  proof: string;
};

export const providerSetupGroups: readonly ProviderSetupGroup[] = [
  {
    id: "notifications",
    title: "Notification delivery",
    purpose: "Sends approved NXQ email notifications through the protected first-party adapter.",
    accountTask: "Create the provider account, verify a sender domain, and create a sending-only API key.",
    secretNames: [
      "NXQ_NOTIFICATION_ADAPTER_URL",
      "NXQ_NOTIFICATION_ADAPTER_TOKEN",
      "NXQ_RESEND_API_KEY",
      "NXQ_NOTIFICATION_FROM_EMAIL",
    ],
    proof: "Send one authorized staging notification and preserve its successful delivery evidence.",
  },
  {
    id: "malware",
    title: "Client file malware scanning",
    purpose: "Keeps uploads quarantined until the protected adapter returns valid clean-scan evidence.",
    accountTask: "Create the scanner account and issue a key limited to the file-scanning service.",
    secretNames: [
      "NXQ_MALWARE_SCAN_ADAPTER_URL",
      "NXQ_MALWARE_SCAN_ADAPTER_TOKEN",
      "NXQ_CLOUDMERSIVE_API_KEY",
    ],
    proof: "Scan one safe staging fixture and verify its checksum-bound clean result and release evidence.",
  },
  {
    id: "ai",
    title: "AI classification and build planning",
    purpose: "Uses one provider-neutral strict-output configuration for classification and build-plan enrichment.",
    accountTask: "Create the model-provider account, choose a strict-structured-output model, and issue a restricted API key.",
    secretNames: [
      "NXQ_AI_MODEL_PROVIDER_URL",
      "NXQ_AI_MODEL_PROVIDER_TOKEN",
      "NXQ_AI_MODEL_PROVIDER_MODEL",
      "NXQ_AI_MODEL_PROVIDER_PROTOCOL",
      "NXQ_BUILD_PLAN_AI_ADAPTER_URL",
      "NXQ_BUILD_PLAN_AI_ADAPTER_TOKEN",
    ],
    proof: "Complete one successful staging classification and one validated AI-enriched build plan.",
  },
] as const;

export const providerSetupSafetyRules = [
  "Enter secret values only in protected Supabase Edge secrets.",
  "Never paste a secret into chat, source, logs, workflow inputs, or a committed environment file.",
  "Configure and verify staging before making a separate production decision.",
] as const;
