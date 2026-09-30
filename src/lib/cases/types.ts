// Case records (docs/contracts.md K3, docs/verification.md). The shape the agent console (step 20) will read.

export type CaseKind = "review" | "handoff";

export type CaseInput = {
  idempotencyKey: string; // conversation + transaction + kind: a repeated "yes" never creates two cases (V3)
  kind: CaseKind;
  rule: string; // PL-n, or DLG-clarify for repeated clarification
  reason: string | null;
  conversationId: string;
  customerId: string;
  intent: string;
  language: "es" | "pt";
  transactionId: string | null;
  summary: string; // one line for the agent, built by code
  verifiedFacts: { fact: string; source: string }[];
  customerStatements: Record<string, unknown>;
  checksDone: string[];
  openQuestions: string[];
  promptVersions: Record<string, string>;
};

export type CaseRecord = CaseInput & { id: string; reference: string; createdAt: string; status: "open" | "in_progress" | "closed" };

export type CaseStore = {
  source: "supabase" | "memory";
  /** Creates the case, or returns the existing one with the same idempotency key. */
  create(input: CaseInput): Promise<CaseRecord>;
  /** Reads a case back by id (step 13 verification). */
  get(id: string): Promise<CaseRecord | null>;
};

/** A reference customers can quote: "GT-" + 8 characters, no 0/O/1/I to avoid misreading. */
export function newReference(random: () => number = Math.random) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `GT-${Array.from({ length: 8 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("")}`;
}
