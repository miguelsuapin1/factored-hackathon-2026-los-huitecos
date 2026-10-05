// What the agent reads when a hand-off request arrives (D-007): a table of the case's facts and a short
// paragraph about the conversation. Built by code from the case row (docs/contracts.md K3), never by a model and never
// from a transcript (the brief's "structured handoff": no raw transcript is stored). Pure: tested by briefing.test.ts.
import { INTENT_LABELS } from "@/lib/intent/labels";

export type CaseStatus = "open" | "in_progress" | "closed";

export type AgentCase = {
  id: string;
  reference: string;
  createdAt: string;
  status: CaseStatus;
  rule: string;
  reason: string | null;
  customerId: string;
  intent: string;
  language: "es" | "pt";
  transactionId: string | null;
  summary: string;
  verifiedFacts: { fact: string; source: string }[];
  customerStatements: Record<string, unknown>;
  checksDone: string[];
  openQuestions: string[];
  environment: string | null;
};

export type AgentCustomer = { firstName: string | null; country: string; segment: string | null; status: string; dataSource: string } | null;

export type AgentTransaction = {
  transactionId: string; dateLocal: string; amount: number; currency: string; merchant: string | null;
  status: string; responseCode: string | null; channel: string | null; country: string | null; fraudScore: number | null;
} | null;

export type Briefing = { headline: string; paragraph: string; rows: [string, string][] };

export const REASON_TEXT: Record<string, string> = {
  customer_asked: "the customer asked to talk to a person",
  repeated_clarification: "the request was still unclear after two clarifying questions",
  no_match: "no transaction matched the customer's details, even after one correction",
  ambiguous: "several transactions match and the customer couldn't tell which one",
  high_risk: "the matched charge has a high fraud score",
  record_unavailable: "the matched transaction couldn't be re-read before deciding",
  tool_failure: "the transaction lookup failed, so nothing was verified automatically",
  too_old: "the customer dates the charge further back than the assistant can search",
};

export const RULE_TEXT: Record<string, string> = {
  "PL-1": "no matching charge",
  "PL-2": "several matching charges",
  "PL-6": "fraud score at or above the cutoff",
  "PL-8": "record unavailable",
  "PL-11": "date older than the searchable 365 days",
  "DLG-clarify": "repeated clarification",
  "DLG-human": "customer asked for a person",
};

const LANGUAGE = { es: "Spanish", pt: "Portuguese" } as const;
const TOPIC: Record<string, string> = {
  unrecognized_charge: "a charge they don't recognize", wrongful_fee: "a charge or fee they think is wrong",
  transaction_status: "what happened to a transaction", balance_check: "their balance", move_money: "moving money",
  human_agent: "talking to a person", out_of_scope: "something outside disputes", unknown: "an unclear request",
};
const COUNTRY: Record<string, string> = { MX: "Mexico", CO: "Colombia", AR: "Argentina" };

const fmtAmount = (amount: number, currency: string | null | undefined) =>
  `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** What the customer said, in one clause: "350.00 USD at Super Ahorro on 2026-06-10". Null when they gave nothing. */
export function statedCharge(s: Record<string, unknown>): string | null {
  const amount = num(s.amount);
  const parts = [
    amount !== null ? fmtAmount(amount, str(s.currency)) : null,
    str(s.merchant) ? `at ${str(s.merchant)}` : null,
    str(s.date) ? `on ${str(s.date)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** How long a request has waited, for the inbox: "just now", "12 min", "3 h", "2 d". */
export function waited(createdAt: string, now = Date.now()) {
  const min = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}

export function buildBriefing(c: AgentCase, customer: AgentCustomer, tx: AgentTransaction): Briefing {
  const topic = TOPIC[c.intent] ?? c.intent;
  const who = customer?.firstName ? `${customer.firstName} (${c.customerId})` : `Customer ${c.customerId}`;
  const where = customer ? `, ${COUNTRY[customer.country] ?? customer.country}${customer.segment ? `, ${customer.segment}` : ""}` : "";
  const said = statedCharge(c.customerStatements);
  const theirWords = str(c.customerStatements.summary);
  const expected = num(c.customerStatements.expectedAmount);
  const confirmed = c.checksDone.some((x) => x.includes("confirmed the matched charge")) ||
    c.verifiedFacts.some((f) => f.fact.startsWith("Customer confirmed"));
  const lookups = c.checksDone.filter((x) => x.includes("lookup (")).length;

  const sentences: string[] = [];
  sentences.push(`${who}${where} wrote in ${LANGUAGE[c.language]} about ${topic}.`);
  if (said) sentences.push(`They reported ${said}${expected !== null ? `, and say it should have been ${fmtAmount(expected, str(c.customerStatements.currency))}` : ""}.`);
  else sentences.push("They didn't give the charge's details.");
  if (theirWords) sentences.push(`In their words: "${theirWords}".`);
  if (tx) {
    sentences.push(`The assistant matched transaction ${tx.transactionId} (${fmtAmount(tx.amount, tx.currency)}${tx.merchant ? ` at ${tx.merchant}` : ""} on ${tx.dateLocal}, ${tx.status})${confirmed ? " and the customer confirmed it is the charge they mean" : ""}.`);
  } else if (lookups > 0) {
    sentences.push(`The assistant searched their transactions ${lookups === 1 ? "once" : `${lookups} times`} without settling on one charge.`);
  }
  const why = c.reason ? REASON_TEXT[c.reason] ?? c.reason.replace(/_/g, " ") : RULE_TEXT[c.rule] ?? "the policy required a person";
  sentences.push(`It was handed to a person because ${why} (${c.rule}).`);
  if (c.openQuestions[0]) sentences.push(`Next: ${c.openQuestions[0]}`);

  const rows: [string, string][] = [
    ["Reference", c.reference],
    ["Requested", new Date(c.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ["Customer", `${customer?.firstName ?? "—"} · ${c.customerId}`],
  ];
  if (customer) rows.push(["Profile", `${COUNTRY[customer.country] ?? customer.country} · ${customer.segment ?? "—"} · ${customer.status}${customer.dataSource === "team_synthetic" ? " · synthetic demo customer" : ""}`]);
  rows.push(["Language", LANGUAGE[c.language]], ["Topic", INTENT_LABELS[c.intent]?.en ?? c.intent]);
  rows.push(["Why a person", `${c.rule}${RULE_TEXT[c.rule] ? `: ${RULE_TEXT[c.rule]}` : ""}${c.reason ? ` (${c.reason})` : ""}`]);
  if (said || expected !== null) rows.push(["Customer said", [said, expected !== null ? `should be ${fmtAmount(expected, str(c.customerStatements.currency))}` : null].filter(Boolean).join(" · ")]);
  if (tx) {
    rows.push(["Transaction", `${tx.transactionId} · ${fmtAmount(tx.amount, tx.currency)} · ${tx.merchant ?? "no merchant"} · ${tx.dateLocal} (customer's local day)`]);
    rows.push(["Record", `${tx.status}${tx.responseCode ? ` · code ${tx.responseCode}` : ""} · ${tx.channel ?? "—"} · ${tx.country ?? "—"}${confirmed ? " · confirmed by the customer" : ""}`]);
    rows.push(["Fraud score", tx.fraudScore === null ? "not available" : `${tx.fraudScore} (hand-off cutoff 30; never shown to the customer)`]);
  } else if (c.transactionId) {
    rows.push(["Transaction", `${c.transactionId} (record not found in the serving data)`]);
  }
  if (c.environment && c.environment !== "production") rows.push(["Environment", `${c.environment} (test traffic)`]);

  return { headline: `${INTENT_LABELS[c.intent]?.en ?? c.intent} · ${RULE_TEXT[c.rule] ?? c.rule}`, paragraph: sentences.join(" "), rows };
}
