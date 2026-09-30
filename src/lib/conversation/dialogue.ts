// Dialogue policy (build step 11): given the previous state, this turn's intent scores and the extracted details,
// decide what the conversation is about and the assistant's next move. Plain code, no model calls, so every rule is
// testable (dialogue.test.ts) and explainable. Rules and their reasons: docs/conversation.md C5–C8.
import type { IntentLabel, Scores } from "@/lib/intent/model";
import { EMPTY_DETAILS, FINISHED, MAX_TEXTS, type ConversationState, type Details } from "./state";

export const DISPUTES: IntentLabel[] = ["unrecognized_charge", "wrongful_fee"];
/** Intents about one specific charge: they collect amount + date and use the lookup (disputes, and status: S1). */
export const CHARGE_INTENTS: IntentLabel[] = [...DISPUTES, "transaction_status"];
const SAFETY: IntentLabel[] = ["move_money", "human_agent"];
/** C5: share of (A + B) the winning option needs when answering "A or B?". Provisional, set by reasoning. */
export const CLARIFY_SHARE = 0.6;
/** C5: unresolved clarifications before offering a human. */
const MAX_CLARIFY = 2;
/** C7: what a dispute needs before we can confirm it. */
const REQUIRED: (keyof Details)[] = ["amount", "date"];

export type Move =
  | "ask_clarify" // "¿A o B?"
  | "ask_summary" // H1: the customer asked for a person; ask for a one-line summary for the agent
  | "ask_details" // ask only for what's missing
  | "confirm" // restate details, ask yes/no
  | "ask_correction" // customer said no: which detail is wrong?
  | "confirmed" // yes: the policy engine decides next (resolve.ts turns it into open_review or handoff)
  | "status_update" // the dispute is already finished (under review, with an agent, closed): say so
  | "answer" // non-dispute intent: the Phase 1 per-intent guidance
  | "handoff" // a person takes over (repeated clarifications here; policy reasons in resolve.ts)
  // Set by resolve.ts after the lookup and policy engine (step 12, docs/policy.md):
  | "no_match" // PL-1: nothing matches, ask to check the details
  | "ask_narrow" // PL-2: several match, ask for the merchant or exact date
  | "explain_status" // PL-3/4/5: pending, reversed or declined: explain, no dispute
  | "lookup_status" // S1: status question with its details complete: look the charge up (no confirmation needed)
  | "status_answer" // S1: explain what happened to the charge (PL-3/4/5, or PL-9 approved + offer a review)
  | "open_review" // PL-7: the dispute goes to review (a verified case, step 13)
  | "record_failed"; // V2: the case couldn't be written and verified: say so, nothing is claimed

export type ResolvedBy = "model" | "clarification" | "offer" | "kept_topic" | "new_topic" | "confirmation";

export type TurnInput = {
  text: string;
  intent: { intent: IntentLabel; decision: "act" | "ask"; scores: Scores };
  details: Partial<Details>; // only grounded values
};

export type TurnOutcome = {
  state: ConversationState;
  move: Move;
  resolvedBy: ResolvedBy;
  missing: (keyof Details)[];
  clarifyOptions: [IntentLabel, IntentLabel] | null;
  pendingBefore: ConversationState["pending"];
};

const YES = new Set(["si", "sim", "claro", "correcto", "correto", "exacto", "exato", "dale", "ok", "okay", "vale", "confirmo", "isso", "afirmativo", "perfecto", "perfeito", "yes", "listo", "certo"]);
const NO = new Set(["no", "nao", "incorrecto", "incorreto", "errado", "negativo", "nop"]);
const BUT = /\b(pero|mas|porem|but)\b/;
/** S2: after an approved charge is explained, the customer says it isn't theirs or isn't right. */
const DISPUTE_IT = /\b(no (lo|la) (reconozco|hice|autorice)|no fui yo|no es mio|no es mia|nao (reconheco|fui eu|fiz)|nao e meu|incorrect[oa]|incorret[oa]|errad[oa]|de mas|a mais|duplicad[oa]|dos veces|duas vezes)\b/;
/** S3: accepting the offer of a person. */
const AGENT = /\b(asesor\w*|agente|persona|humano|atendente|pessoa|alguien|algu[eé]m)\b/;
/** C10: choosing "the review" from the options offered after a refusal. Read by code, like yes/no. */
const REVIEW = /\b(revis\w*|reclam\w*|disput\w*|contest\w*|investig\w*)\b/;

function normalize(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
}

/** C8: a yes/no read by code, not a model. "sí, pero el monto era 360" is not a plain yes. */
export function readYesNo(text: string): "yes" | "no" | null {
  const clean = normalize(text);
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const first = words[0] === "de" && words[1] === "acuerdo" ? "ok" : words[0];
  if (NO.has(first)) return "no";
  if (YES.has(first) && !/\d/.test(clean) && !BUT.test(clean) && words.length <= 6) return "yes";
  return null;
}

function mergeDetails(prev: Details, next: Partial<Details>): { details: Details; changed: boolean } {
  const details = { ...prev };
  let changed = false;
  for (const key of Object.keys(next) as (keyof Details)[]) {
    const value = next[key];
    if (value === null || value === undefined || value === prev[key]) continue;
    (details[key] as Details[typeof key]) = value;
    changed = true;
  }
  return { details, changed };
}

export function advance(prev: ConversationState, input: TurnInput): TurnOutcome {
  const { intent } = input;
  const pendingBefore = prev.pending;
  const merged = mergeDetails(prev.details, input.details);
  const state: ConversationState = {
    ...prev,
    turn: prev.turn + 1,
    details: merged.details,
    customerTexts: [...prev.customerTexts, input.text].slice(-MAX_TEXTS),
  };
  const confidentSafety = intent.decision === "act" && SAFETY.includes(intent.intent);
  // C12: a bare "sí" / "ok" / "no" (≤ 2 words, no new details) is a reply inside the conversation, never a confident
  // new topic. The intent model scores a lone "sí" as out_of_scope 71%, just above its 70% threshold (found by the
  // robustness sweep, 2026-09-30): without this, "sí" to "¿me dices el comercio?" dropped the dispute.
  const bareAck = readYesNo(input.text) !== null && normalize(input.text).split(/\s+/).length <= 2 && !merged.changed;
  const done = (move: Move, resolvedBy: ResolvedBy, clarifyOptions: [IntentLabel, IntentLabel] | null = null): TurnOutcome => ({
    state, move, resolvedBy, clarifyOptions, pendingBefore, missing: missingFor(state),
  });

  // 0. We asked for a one-line summary for the agent (H1): this message is it, whatever its intent.
  if (prev.pending?.kind === "summary") {
    if (readYesNo(input.text) === "no" && input.text.trim().split(/\s+/).length <= 3) {
      state.pending = null; // "no, ya no": the customer changed their mind
      state.workingIntent = null;
      return done("answer", "model");
    }
    state.summary = input.text.slice(0, SUMMARY_MAX);
    return humanHandoff(state, done);
  }

  // 1. Waiting for a yes/no (C8).
  if (prev.pending?.kind === "confirm" && !confidentSafety) {
    const answer = readYesNo(input.text);
    if (answer === "yes") {
      state.pending = null;
      state.status = "confirmed";
      return done("confirmed", "confirmation");
    }
    if (answer === "no" && !merged.changed) {
      state.pending = { kind: "details" };
      return done("ask_correction", "confirmation");
    }
    // A correction ("no, fue el 12") or new details: confirm again with the merged values.
    if (merged.changed) return disputeMove(state, done, "confirmation");
    // Neither yes, no nor new details (unless it's a clear new topic): ask again.
    if (!(intent.decision === "act" && intent.intent !== prev.workingIntent)) {
      return done("confirm", "confirmation");
    }
  }

  // 2a. We offered "a review or an agent" (C10). The intent model, trained on opening messages, can't read a menu
  // choice ("revisen el cargo" scores as human_agent), so code reads it. Asking for a person is caught by the model.
  if (prev.pending?.kind === "offer_review" && !confidentSafety && REVIEW.test(normalize(input.text))) {
    state.workingIntent = prev.pending.dispute;
    state.pending = null;
    return disputeMove(state, done, "offer");
  }

  // 2c. We explained an approved charge and offered a review (S2): "no lo reconozco", "sí", "revísenlo" → dispute,
  // keeping the details and the matched charge; a plain "no" closes politely.
  if (prev.pending?.kind === "offer_dispute" && !confidentSafety) {
    const text = normalize(input.text);
    const topDispute = DISPUTES.includes(intent.scores[0].label) ? intent.scores[0].label : null;
    if (readYesNo(input.text) === "yes" || REVIEW.test(text) || DISPUTE_IT.test(text) || (intent.decision === "act" && topDispute)) {
      state.workingIntent = topDispute ?? (state.details.expectedAmount !== null ? "wrongful_fee" : "unrecognized_charge");
      state.pending = null;
      return disputeMove(state, done, "offer");
    }
    if (readYesNo(input.text) === "no") {
      state.pending = null;
      return done("status_update", "offer");
    }
  }

  // 2d. We explained a declined charge and offered an agent to check the reason (S3): "sí" / "un asesor" → a case
  // for a person carrying the charge; "no" closes. Asking for a person outright is caught by the model (step 3, H2).
  if (prev.pending?.kind === "offer_agent" && !confidentSafety) {
    const text = normalize(input.text);
    if (readYesNo(input.text) === "yes" || AGENT.test(text) || REVIEW.test(text)) return humanHandoff(state, done);
    if (readYesNo(input.text) === "no") {
      state.pending = null;
      return done("status_update", "offer");
    }
  }

  // 2b. Waiting for "A or B?" (C5).
  if (prev.pending?.kind === "clarify" && !confidentSafety) {
    const [a, b] = prev.pending.options;
    // C11: a bare "sí"/"no" doesn't choose between two options (seen live with the fallback model): ask again.
    const p = (label: IntentLabel) => intent.scores.find((s) => s.label === label)?.probability ?? 0;
    const total = p(a) + p(b);
    // C12: "revisen el cargo" picks the dispute option when one is offered (code-read, as in C10).
    const asksReview = REVIEW.test(normalize(input.text)) ? [a, b].find((o) => DISPUTES.includes(o)) : undefined;
    const winner = asksReview ?? (p(a) >= p(b) ? a : b);
    if (!bareAck && total > 0 && (asksReview || p(winner) / total >= CLARIFY_SHARE)) {
      state.workingIntent = winner;
      state.pending = null;
      return CHARGE_INTENTS.includes(winner) ? disputeMove(state, done, "clarification") : done("answer", "clarification");
    }
    const attempts = prev.pending.attempts + 1;
    if (attempts >= MAX_CLARIFY) {
      state.pending = null;
      state.status = "handoff";
      state.handoffReason = "repeated_clarification";
      return done("handoff", "clarification");
    }
    state.pending = { kind: "clarify", options: [a, b], attempts };
    return done("ask_clarify", "clarification", [a, b]);
  }

  // 3. Confident: follow the model; a different intent than before is a new topic (C6). Never on a bare "sí"/"ok"
  // while a charge is being discussed (C12).
  const ackInTopic = bareAck && prev.workingIntent !== null && CHARGE_INTENTS.includes(prev.workingIntent);
  if (intent.decision === "act" && !ackInTopic) {
    const resolvedBy: ResolvedBy = prev.workingIntent && prev.workingIntent !== intent.intent ? "new_topic" : "model";
    if (resolvedBy === "new_topic") state.status = "open";
    // A new dispute after a confirmed one is a new case: start from this message's details only.
    if (FINISHED.includes(prev.status) && CHARGE_INTENTS.includes(intent.intent)) {
      state.details = { ...EMPTY_DETAILS, ...stripNulls(input.details) };
      state.status = "open";
      state.match = null;
      state.lookupRetries = 0;
      state.handoffReason = null;
      state.caseRef = null;
      state.caseId = null;
      state.summary = null;
      state.checks = [];
    }
    if (intent.intent === "human_agent") {
      // H1/H2: if we already know what it's about, hand off now with that context; otherwise ask for one line.
      if (hasContext(prev)) return humanHandoff(state, done);
      state.workingIntent = "human_agent";
      state.pending = { kind: "summary" };
      return done("ask_summary", resolvedBy);
    }
    state.workingIntent = intent.intent;
    state.pending = null;
    if (!CHARGE_INTENTS.includes(intent.intent)) {
      // Numbers in a refund demand or another topic are not details of the disputed charge ("devuélveme 5000").
      state.details = prev.details;
      if (intent.intent === "move_money") {
        // The refusal offers a review of the charge or an agent (GUIDANCE.move_money). Remember the offer (C10).
        const dispute = prev.workingIntent && DISPUTES.includes(prev.workingIntent) ? prev.workingIntent : "unrecognized_charge";
        state.pending = { kind: "offer_review", dispute };
      }
      return done("answer", resolvedBy);
    }
    return disputeMove(state, done, resolvedBy);
  }

  // 4. Not confident, but we're already on a charge: it's probably a detail ("fue el martes"). Keep the topic (C6).
  if (prev.workingIntent && CHARGE_INTENTS.includes(prev.workingIntent)) {
    return disputeMove(state, done, "kept_topic");
  }

  // 5. Not confident and no topic yet: ask between the two most likely intents (R2).
  const options: [IntentLabel, IntentLabel] = [intent.scores[0].label, intent.scores[1].label];
  state.pending = { kind: "clarify", options, attempts: 0 };
  return done("ask_clarify", "model", options);
}

const SUMMARY_MAX = 300;

/** H2: the conversation already holds dispute details, so the agent has context without asking for a summary. */
function hasContext(prev: ConversationState) {
  return Object.values(prev.details).some((v) => v !== null) || prev.match !== null;
}

function humanHandoff(state: ConversationState, done: (move: Move, resolvedBy: ResolvedBy) => TurnOutcome): TurnOutcome {
  state.pending = null;
  state.status = "handoff";
  state.handoffReason = "customer_asked";
  return done("handoff", "model");
}

function stripNulls(details: Partial<Details>): Partial<Details> {
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null && v !== undefined));
}

function missingFor(state: ConversationState) {
  return state.workingIntent && CHARGE_INTENTS.includes(state.workingIntent)
    ? REQUIRED.filter((k) => state.details[k] === null)
    : [];
}

/** C7 + C8: in a dispute, ask only for what's missing; once complete, confirm (unless already confirmed). */
function disputeMove(
  state: ConversationState,
  done: (move: Move, resolvedBy: ResolvedBy) => TurnOutcome,
  resolvedBy: ResolvedBy,
): TurnOutcome {
  if (missingFor(state).length) {
    state.pending = { kind: "details" };
    return done("ask_details", resolvedBy);
  }
  if (FINISHED.includes(state.status) && resolvedBy === "kept_topic") {
    state.pending = null;
    return done("status_update", resolvedBy);
  }
  if (state.workingIntent === "transaction_status") {
    // S1: a status question only reads a record, so there's nothing to confirm: look it up straight away.
    state.status = "open";
    state.pending = null;
    return done("lookup_status", resolvedBy);
  }
  state.status = "open";
  state.pending = { kind: "confirm" };
  return done("confirm", resolvedBy);
}
