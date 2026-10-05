// The agent console's rules (D-007), independent of HTTP and of the database so they're unit-tested
// (service.test.ts) against the memory store. Routes in src/app/api/agent/* and src/app/api/handoff only parse input,
// check the session and call these.
//   - Only hand-off cases appear; reviews (PL-7) stay with the back office.
//   - An agent must accept a request before writing; only one acceptance wins (open → in_progress is conditional).
//   - The customer can write only while an agent is on the case, and only about their own case.
//   - Customer text is masked before it is stored (H4), like every other customer message.
import { maskSensitive } from "@/lib/privacy/mask";
import { buildBriefing, type Briefing } from "./briefing";
import { MAX_MESSAGE_CHARS, REFERENCE_RE, type AgentStore, type CaseDetail, type CaseMessage, type CaseStatus } from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const err = (status: number, error: string) => ({ ok: false as const, status, error });
const ok = <T>(value: T) => ({ ok: true as const, value });

export function validReference(ref: unknown): ref is string {
  return typeof ref === "string" && REFERENCE_RE.test(ref);
}

function cleanText(raw: unknown): Result<string> {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return err(400, "Write a message first.");
  if (text.length > MAX_MESSAGE_CHARS) return err(413, `Messages are limited to ${MAX_MESSAGE_CHARS} characters.`);
  return ok(text);
}

const afterId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

export type AgentCaseView = CaseDetail & { briefing: Briefing; messages: CaseMessage[] };

export async function agentCase(store: AgentStore, ref: unknown, after: unknown): Promise<Result<AgentCaseView>> {
  if (!validReference(ref)) return err(400, "Unknown case reference.");
  const detail = await store.getCase(ref);
  if (!detail) return err(404, "No hand-off case with that reference.");
  const messages = await store.messages(detail.case.id, afterId(after));
  return ok({ ...detail, briefing: buildBriefing(detail.case, detail.customer, detail.transaction), messages });
}

export type AgentAction = "accept" | "close" | "message";

export async function agentAction(store: AgentStore, ref: unknown, action: unknown, text?: unknown): Promise<Result<{ status: CaseStatus; message?: CaseMessage }>> {
  if (!validReference(ref)) return err(400, "Unknown case reference.");
  if (action === "accept") {
    const r = await store.accept(ref);
    if (r === "accepted") return ok({ status: "in_progress" });
    if (r === "not_found") return err(404, "No hand-off case with that reference.");
    return err(409, r === "closed" ? "This request is already closed." : "Another agent already accepted this request.");
  }
  if (action === "close") {
    const r = await store.close(ref);
    if (r === "closed") return ok({ status: "closed" });
    return r === "not_found" ? err(404, "No hand-off case with that reference.") : err(409, "Only an accepted request can be closed.");
  }
  if (action === "message") {
    const t = cleanText(text);
    if (!t.ok) return t;
    const detail = await store.getCase(ref);
    if (!detail) return err(404, "No hand-off case with that reference.");
    if (detail.case.status !== "in_progress") return err(409, "Accept the request before writing to the customer.");
    const message = await store.addMessage(detail.case.id, "agent", t.value);
    return ok({ status: "in_progress", message });
  }
  return err(400, "Unknown action.");
}

export type CustomerView = { status: CaseStatus; language: "es" | "pt"; messages: CaseMessage[] };

/** The customer's poll: their own case only. Another customer's reference looks exactly like a missing one (404). */
export async function customerPoll(store: AgentStore, ref: unknown, customerId: string, after: unknown): Promise<Result<CustomerView>> {
  if (!validReference(ref)) return err(400, "Unknown case reference.");
  const c = await store.caseForCustomer(ref, customerId);
  if (!c) return err(404, "Case not found.");
  return ok({ status: c.status, language: c.language, messages: await store.messages(c.id, afterId(after)) });
}

export async function customerSend(store: AgentStore, ref: unknown, customerId: string, text: unknown): Promise<Result<{ message: CaseMessage; masked: string[] }>> {
  if (!validReference(ref)) return err(400, "Unknown case reference.");
  const t = cleanText(text);
  if (!t.ok) return t;
  const c = await store.caseForCustomer(ref, customerId);
  if (!c) return err(404, "Case not found.");
  if (c.status !== "in_progress") return err(409, c.status === "open" ? "An agent hasn't joined yet." : "This conversation with the agent has ended.");
  const { text: masked, masked: kinds } = maskSensitive(t.value);
  return ok({ message: await store.addMessage(c.id, "customer", masked), masked: kinds });
}
