// In-memory agent store (step 20): unit tests, and local runs without SUPABASE_SECRET_KEY (never production, see
// store.ts). Seeded with three SYNTHETIC, team-written hand-offs for the demo customer so the console can be tried.
import type { AgentCase, AgentCustomer, AgentTransaction } from "./briefing";
import type { AgentStore, CaseMessage, InboxItem, Sender } from "./types";

type Entry = { kind: "handoff" | "review"; case: AgentCase; customer: AgentCustomer; transaction: AgentTransaction };

const DEMO_CUSTOMER: AgentCustomer = { firstName: "Demo", country: "MX", segment: "Basic", status: "Active", dataSource: "team_synthetic" };

export function seedEntries(now = Date.now()): Entry[] {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();
  const common = { customerId: "CLI-DEMO00000001", language: "es" as const, verifiedFacts: [], environment: "local", status: "open" as const };
  return [
    {
      kind: "handoff", customer: DEMO_CUSTOMER,
      transaction: { transactionId: "TRX-DEMO0000000000003", dateLocal: "2026-06-03", amount: 120, currency: "USD", merchant: "Conciertos Live",
        status: "Approved", responseCode: "00", channel: "Web", country: "MX", fraudScore: 41.7 },
      case: { ...common, id: "00000000-0000-4000-8000-000000000001", reference: "GT-DEMQ6RSK", createdAt: at(4), rule: "PL-6", reason: "high_risk",
        intent: "unrecognized_charge", transactionId: "TRX-DEMO0000000000003",
        summary: "unrecognized_charge: 120 USD at Conciertos Live on 2026-06-03. handed off: high_risk (PL-6).",
        verifiedFacts: [{ fact: "Customer confirmed this is the charge they mean", source: "conversation" }],
        customerStatements: { date: "2026-06-03", amount: 120, currency: "USD" },
        checksDone: ["turn 1: topic unrecognized_charge (by words)", "turn 1: lookup (memory, around the date): 1 match(es)",
          "turn 2: customer confirmed the matched charge", "turn 2: re-read TRX-DEMO0000000000003: Approved", "turn 2: policy PL-6"],
        openQuestions: ["Possible fraud: confirm the customer has the card and whether others could use it; consider blocking."] },
    },
    {
      kind: "handoff", customer: DEMO_CUSTOMER, transaction: null,
      case: { ...common, id: "00000000-0000-4000-8000-000000000002", reference: "GT-DEMW8TPA", createdAt: at(27), rule: "PL-2", reason: "ambiguous",
        intent: "unrecognized_charge", transactionId: null, language: "pt",
        summary: "unrecognized_charge: 89.9 USD at Cable TV. handed off: ambiguous (PL-2).",
        customerStatements: { amount: 89.9, currency: "USD", merchant: "Cable TV" },
        checksDone: ["turn 1: topic unrecognized_charge (by words)", "turn 2: lookup (memory, last 180 days): 3 match(es)",
          "turn 3: lookup (memory, last 180 days, with merchant): 3 match(es)", "turn 3: policy PL-2"],
        openQuestions: ["Several transactions match the customer's details; the customer couldn't tell which one."] },
    },
    {
      kind: "handoff", customer: DEMO_CUSTOMER, transaction: null,
      case: { ...common, id: "00000000-0000-4000-8000-000000000003", reference: "GT-DEMH4NZC", createdAt: at(95), rule: "DLG-human", reason: "customer_asked",
        intent: "human_agent", transactionId: null, summary: "human_agent: a charge (details not collected). handed off: customer_asked (DLG-human).",
        customerStatements: { summary: "me cobraron dos veces la misma compra" }, checksDone: ["turn 1: topic human_agent (by model)"],
        openQuestions: ["The customer asked to speak with a person. Start from their summary and any details below."] },
    },
  ];
}

export function createMemoryAgentStore(entries: Entry[] = seedEntries()): AgentStore & { reset(e?: Entry[]): void } {
  let cases = entries;
  let msgs: (CaseMessage & { caseId: string })[] = [];
  let nextId = 1;
  const byRef = (ref: string) => cases.find((e) => e.kind === "handoff" && e.case.reference === ref);
  const inbox = (e: Entry): InboxItem => ({
    reference: e.case.reference, createdAt: e.case.createdAt, status: e.case.status, rule: e.case.rule, reason: e.case.reason,
    intent: e.case.intent, language: e.case.language, customerId: e.case.customerId, environment: e.case.environment, summary: e.case.summary,
  });
  return {
    source: "memory",
    reset(e = seedEntries()) { cases = e; msgs = []; nextId = 1; },
    async listRequests(environment) {
      const list = cases.filter((e) => e.kind === "handoff" && (!environment || e.case.environment === environment))
        .sort((a, b) => b.case.createdAt.localeCompare(a.case.createdAt));
      return [...list.filter((e) => e.case.status !== "closed"), ...list.filter((e) => e.case.status === "closed").slice(0, 15)].map(inbox);
    },
    async getCase(ref) {
      const e = byRef(ref);
      return e ? { case: { ...e.case }, customer: e.customer, transaction: e.transaction } : null;
    },
    async messages(caseId, afterId) {
      return msgs.filter((m) => m.caseId === caseId && m.id > afterId).map(({ caseId: _, ...m }) => (void _, m));
    },
    async accept(ref) {
      const e = byRef(ref);
      if (!e) return "not_found";
      if (e.case.status === "closed") return "closed";
      if (e.case.status !== "open") return "already_taken";
      e.case.status = "in_progress";
      await this.addMessage(e.case.id, "system", "agent_joined");
      return "accepted";
    },
    async close(ref) {
      const e = byRef(ref);
      if (!e) return "not_found";
      if (e.case.status !== "in_progress") return "not_active";
      e.case.status = "closed";
      await this.addMessage(e.case.id, "system", "agent_closed");
      return "closed";
    },
    async addMessage(caseId, sender: Sender, body) {
      const m = { id: nextId++, caseId, createdAt: new Date().toISOString(), sender, body };
      msgs.push(m);
      const { caseId: _, ...out } = m;
      void _;
      return out;
    },
    async caseForCustomer(ref, customerId) {
      const e = byRef(ref);
      return e && e.case.customerId === customerId ? { id: e.case.id, status: e.case.status, language: e.case.language } : null;
    },
  };
}
