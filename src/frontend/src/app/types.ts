export type ConversationStatus = "running" | "pending_human" | "completed" | "error";

export interface ConversationMeta {
  id: string;
  title: string;
  status: ConversationStatus;
  startedAt: number;
  lastUpdated: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  title?: string;
  content: string;
  createdAt: number;
  reasoning?: string;
}

export interface ResearchInsightState {
  currentPage?: string;
  reasoning?: string;
  lastUpdated: number;
}

export interface PlanSectionFormState {
  title: string;
  focus: string;
  keyQuestions: string[];
}

export interface PlanStructureFormState {
  introduction: string;
  conclusion: string;
}

export interface ResearchPlanFormState {
  purpose: string;
  sections: PlanSectionFormState[];
  structure: PlanStructureFormState;
  metaAnalysis: string;
}
