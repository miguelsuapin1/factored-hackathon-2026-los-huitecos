// The agent console's data contract (step 20, D-007; docs/contracts.md K6). Safe to import from client components.
import type { AgentCase, AgentCustomer, AgentTransaction, Briefing, CaseStatus } from "./briefing";

export type Sender = "customer" | "agent" | "system";
/** System messages are codes, rendered in the reader's language: the agent's screen in English, the customer's in ES/PT. */
export type SystemEvent = "agent_joined" | "agent_closed";

export type CaseMessage = { id: number; createdAt: string; sender: Sender; body: string };

export type InboxItem = {
  reference: string;
  createdAt: string;
  status: CaseStatus;
  rule: string;
  reason: string | null;
  intent: string;
  language: "es" | "pt";
  customerId: string;
  environment: string | null;
  summary: string;
};

export type CaseDetail = { case: AgentCase; customer: AgentCustomer; transaction: AgentTransaction };

export type AcceptResult = "accepted" | "not_found" | "already_taken" | "closed";
export type CloseResult = "closed" | "not_found" | "not_active";

export interface AgentStore {
  source: "supabase" | "memory";
  /** Hand-off requests: waiting and in progress (all), plus the most recent closed ones. `environment` null = all. */
  listRequests(environment: string | null): Promise<InboxItem[]>;
  getCase(reference: string): Promise<CaseDetail | null>;
  messages(caseId: string, afterId: number): Promise<CaseMessage[]>;
  /** open → in_progress, only if still open (two agents can't take the same request). */
  accept(reference: string): Promise<AcceptResult>;
  /** in_progress → closed. */
  close(reference: string): Promise<CloseResult>;
  addMessage(caseId: string, sender: Sender, body: string): Promise<CaseMessage>;
  /** The customer's view of their own hand-off: null unless this customer owns it (scoping, like K2). */
  caseForCustomer(reference: string, customerId: string): Promise<{ id: string; status: CaseStatus; language: "es" | "pt" } | null>;
}

export type { AgentCase, AgentCustomer, AgentTransaction, Briefing, CaseStatus };

export const REFERENCE_RE = /^GT-[2-9A-HJ-NP-Z]{8}$/;
export const MAX_MESSAGE_CHARS = 1000;
