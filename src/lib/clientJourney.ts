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
