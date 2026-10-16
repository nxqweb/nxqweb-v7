export type JourneyStatus = "complete" | "current" | "upcoming" | "stopped";
export type RequirementStatus = "complete" | "action_required" | "processing" | "optional";

export type ClientJourneyAction = {
  owner: "client" | "nxq";
  title: string;
  detail: string;
  href: string;
};

export type ClientJourneyMilestone = {
  key: string;
  title: string;
  status: JourneyStatus;
  detail: string;
};

export type ClientJourneyRequirement = {
  key: string;
  title: string;
  status: RequirementStatus;
  detail: string;
  href: string;
};

export type ClientLaunchJourney = {
  client_id: string;
  business_name: string;
  client_status: string;
  project_id: string | null;
  stage_key: string;
  stage_title: string;
  stage_detail: string;
  progress_percent: number;
  attention_required: boolean;
  next_action: ClientJourneyAction;
  milestones: ClientJourneyMilestone[];
  requirements: ClientJourneyRequirement[];
  generated_at: string;
};

export function journeyStatusLabel(status: JourneyStatus | RequirementStatus) {
  return status.replaceAll("_", " ");
}

// The journey comes from one database function but is read in three places. A response that is empty or has the wrong shape used to crash
// the whole page (blank screen). This checks it once where it arrives: a bad response means "no journey yet", a good one gets safe defaults.
export function parseLaunchJourney(data: unknown): ClientLaunchJourney | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const action = row.next_action;
  if (!action || typeof action !== "object") return null;
  const a = action as Record<string, unknown>;
  if (typeof a.title !== "string" || typeof a.href !== "string") return null;
  return {
    ...(row as unknown as ClientLaunchJourney),
    next_action: { owner: a.owner === "client" ? "client" : "nxq", title: a.title, detail: typeof a.detail === "string" ? a.detail : "", href: a.href },
    milestones: Array.isArray(row.milestones) ? (row.milestones as ClientJourneyMilestone[]) : [],
    requirements: Array.isArray(row.requirements) ? (row.requirements as ClientJourneyRequirement[]) : [],
  };
}
