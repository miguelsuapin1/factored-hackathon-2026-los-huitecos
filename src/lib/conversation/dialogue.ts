// Dialogue policy (build step 11): given the previous state, this turn's intent scores and the extracted details,
// decide what the conversation is about and the assistant's next move. Plain code, no model calls, so every rule is
// testable (dialogue.test.ts) and explainable. Rules and their reasons: docs/conversation.md C5–C8.
import type { IntentLabel, Scores } from "@/lib/intent/model";
import { EMPTY_DETAILS, MAX_TEXTS, type ConversationState, type Details } from "./state";

export const DISPUTES: IntentLabel[] = ["unrecognized_charge", "wrongful_fee"];
const SAFETY: IntentLabel[] = ["move_money", "human_agent"];
/** C5: share of (A + B) the winning option needs when answering "A or B?". Provisional, set by reasoning. */
export const CLARIFY_SHARE = 0.6;
/** C5: unresolved clarifications before offering a human. */
const MAX_CLARIFY = 2;
/** C7: what a dispute needs before we can confirm it. */
const REQUIRED: (keyof Details)[] = ["amount", "date"];

export type Move =
  | "ask_clarify" // "¿A o B?"
  | "ask_details" // ask only for what's missing
  | "confirm" // restate details, ask yes/no
  | "ask_correction" // customer said no: which detail is wrong?
  | "confirmed" // yes: details confirmed, will be checked (steps 12–14 act on it)
  | "answer" // non-dispute intent: the Phase 1 per-intent guidance
  | "handoff"; // offer a human after repeated unresolved clarifications

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
  const done = (move: Move, resolvedBy: ResolvedBy, clarifyOptions: [IntentLabel, IntentLabel] | null = null): TurnOutcome => ({
    state, move, resolvedBy, clarifyOptions, pendingBefore, missing: missingFor(state),
  });

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

  // 2b. Waiting for "A or B?" (C5).
  if (prev.pending?.kind === "clarify" && !confidentSafety) {
    const [a, b] = prev.pending.options;
    const p = (label: IntentLabel) => intent.scores.find((s) => s.label === label)?.probability ?? 0;
    const total = p(a) + p(b);
    const winner = p(a) >= p(b) ? a : b;
    if (total > 0 && p(winner) / total >= CLARIFY_SHARE) {
      state.workingIntent = winner;
      state.pending = null;
      return DISPUTES.includes(winner) ? disputeMove(state, done, "clarification") : done("answer", "clarification");
    }
    const attempts = prev.pending.attempts + 1;
    if (attempts >= MAX_CLARIFY) {
      state.pending = null;
      state.status = "handoff";
      return done("handoff", "clarification");
    }
    state.pending = { kind: "clarify", options: [a, b], attempts };
    return done("ask_clarify", "clarification", [a, b]);
  }

  // 3. Confident: follow the model; a different intent than before is a new topic (C6).
  if (intent.decision === "act") {
    const resolvedBy: ResolvedBy = prev.workingIntent && prev.workingIntent !== intent.intent ? "new_topic" : "model";
    if (resolvedBy === "new_topic") state.status = "open";
    // A new dispute after a confirmed one is a new case: start from this message's details only.
    if (prev.status === "confirmed" && DISPUTES.includes(intent.intent)) {
      state.details = { ...EMPTY_DETAILS, ...stripNulls(input.details) };
      state.status = "open";
    }
    state.workingIntent = intent.intent;
    state.pending = null;
    if (!DISPUTES.includes(intent.intent)) {
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

  // 4. Not confident, but we're already in a dispute: it's probably a detail ("fue el martes"). Keep the topic (C6).
  if (prev.workingIntent && DISPUTES.includes(prev.workingIntent)) {
    return disputeMove(state, done, "kept_topic");
  }

  // 5. Not confident and no topic yet: ask between the two most likely intents (R2).
  const options: [IntentLabel, IntentLabel] = [intent.scores[0].label, intent.scores[1].label];
  state.pending = { kind: "clarify", options, attempts: 0 };
  return done("ask_clarify", "model", options);
}

function stripNulls(details: Partial<Details>): Partial<Details> {
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null && v !== undefined));
}

function missingFor(state: ConversationState) {
  return state.workingIntent && DISPUTES.includes(state.workingIntent)
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
  if (state.status === "confirmed" && resolvedBy === "kept_topic") {
    state.pending = null;
    return done("confirmed", resolvedBy);
  }
  state.status = "open";
  state.pending = { kind: "confirm" };
  return done("confirm", resolvedBy);
}
