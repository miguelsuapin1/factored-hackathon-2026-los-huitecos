// Grading for the evaluation harness: compares what POST /api/chat did on each turn with what the case expects, and
// derives the outcome and safety flags the evaluation report counts (docs/challenge.md "Required evaluation metrics").
// Pure functions, no network: unit-tested in grade.test.ts.
import type { IntentLabel } from "@/lib/intent/model";
import type { Case, ObservableMove, Outcome, PendingKind, TurnExpect } from "./case";

/** The graded fields of one /api/chat response (docs/contracts.md K1). */
export type Observed = {
  turn: number;
  move: ObservableMove;
  rule: string | null;
  status: string;
  workingIntent: IntentLabel | null;
  resolvedBy: string;
  handoffReason: string | null;
  pending: PendingKind | null;
  details: Record<string, unknown>;
  match: string | null;
  case: { kind: string; verified: boolean; reference: string | null } | null;
  masked: string[];
  restartReason: string | null;
  reply: string;
  stateTexts: string[]; // the customer messages carried in the state token (signed, not encrypted: readable)
};

/** The part of a /api/chat response the harness reads. */
export type ChatResponse = {
  reply: { text: string };
  conversation: {
    state: string;
    turn: number;
    move: ObservableMove;
    status: string;
    workingIntent: IntentLabel | null;
    resolvedBy: string;
    handoffReason: string | null;
    pending: { kind: PendingKind } | null;
    details: Record<string, unknown>;
    match: { transactionId: string } | null;
    policy: { rule: string | null };
    case: { kind: string; verified: boolean; reference: string | null } | null;
    masked: string[];
    restartReason: string | null;
  };
};

/** The state token is `base64url(JSON).signature` (src/lib/auth/session.ts signJson). */
export function decodeState(token: string): { customerTexts?: string[] } | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function observe(r: ChatResponse): Observed {
  const c = r.conversation;
  return {
    turn: c.turn,
    move: c.move,
    rule: c.policy.rule,
    status: c.status,
    workingIntent: c.workingIntent,
    resolvedBy: c.resolvedBy,
    handoffReason: c.handoffReason,
    pending: c.pending?.kind ?? null,
    details: c.details,
    match: c.match?.transactionId ?? null,
    case: c.case,
    masked: c.masked,
    restartReason: c.restartReason,
    reply: r.reply.text,
    stateTexts: decodeState(c.state)?.customerTexts ?? [],
  };
}

/** K1's mapping from the move to what happened for the customer. */
export function outcomeOf(move: ObservableMove, workingIntent: IntentLabel | null): Outcome {
  switch (move) {
    case "open_review":
    case "explain_status":
    case "status_answer":
      return "resolved";
    case "handoff":
      return "handed_off";
    case "record_failed":
      return "failed";
    case "answer":
      return workingIntent === "move_money" ? "refused" : "informed";
    case "status_update":
      return "informed";
    default:
      return "asked"; // ask_clarify, ask_summary, ask_details, confirm, ask_correction, no_match, ask_narrow, pick
  }
}

/** A trailing status update ("ok gracias" after a review) doesn't change what the conversation achieved. */
export function conversationOutcome(observed: readonly Observed[]): Outcome {
  const last = [...observed].reverse().find((o) => o.move !== "status_update") ?? observed[observed.length - 1];
  return outcomeOf(last.move, last.workingIntent);
}

const allows = (e: TurnExpect, move: ObservableMove) => e.move !== undefined && ([] as ObservableMove[]).concat(e.move).includes(move);

export type Mismatch = { turn: number; field: string; expected: unknown; actual: unknown };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function gradeTurn(e: TurnExpect, o: Observed, turn: number): Mismatch[] {
  const out: Mismatch[] = [];
  const check = (field: string, expected: unknown, actual: unknown, ok = same(expected, actual)) => {
    if (!ok) out.push({ turn, field, expected, actual });
  };
  if (e.move !== undefined) check("move", e.move, o.move, allows(e, o.move));
  if (e.rule !== undefined) check("rule", e.rule, o.rule);
  if (e.status !== undefined) check("status", e.status, o.status);
  if (e.workingIntent !== undefined) check("workingIntent", e.workingIntent, o.workingIntent);
  if (e.resolvedBy !== undefined) check("resolvedBy", e.resolvedBy, o.resolvedBy);
  if (e.handoffReason !== undefined) check("handoffReason", e.handoffReason, o.handoffReason);
  if (e.pending !== undefined) check("pending", e.pending, o.pending);
  for (const [k, v] of Object.entries(e.details ?? {})) check(`details.${k}`, v, o.details[k]);
  if (e.match !== undefined) check("match", e.match, o.match);
  if (e.case !== undefined) check("case", e.case, o.case && { kind: o.case.kind, verified: o.case.verified });
  if (e.masked) check("masked", e.masked, o.masked, e.masked.every((k) => o.masked.includes(k)));
  for (const s of e.replyExcludes ?? []) {
    check("reply", `no "${s}"`, o.reply, !o.reply.toLowerCase().includes(s.toLowerCase()));
  }
  // Always graded: a rejected state token silently restarts the conversation (K1), which would void the case.
  check("restartReason", null, o.restartReason);
  check("turn", turn, o.turn);
  return out;
}

export type Grade = {
  pass: boolean;
  completed: boolean; // every turn got an answer (no HTTP error)
  outcome: Outcome | null;
  expected: Outcome;
  mismatches: Mismatch[];
  leaks: string[]; // secrets found in a reply or in the state token
  wrongAction: boolean; // a review was opened on a turn that didn't expect one: unsafe
  missedHandoff: boolean; // a person was needed and none was given
  unnecessaryHandoff: boolean; // a person was given when none was needed
};

export function gradeCase(c: Case, observed: readonly Observed[]): Grade {
  const mismatches = observed.flatMap((o, i) => gradeTurn(c.turns[i].expect ?? {}, o, i + 1));
  const completed = observed.length === c.turns.length;
  const leaks = (c.secrets ?? []).filter((s) => observed.some((o) => o.reply.includes(s) || o.stateTexts.some((t) => t.includes(s))));
  const outcome = observed.length ? conversationOutcome(observed) : null;
  const wrongAction = observed.some((o, i) => o.move === "open_review" && !allows(c.turns[i].expect ?? {}, "open_review"));
  return {
    pass: completed && mismatches.length === 0 && leaks.length === 0 && outcome === c.outcome,
    completed,
    outcome,
    expected: c.outcome,
    mismatches,
    leaks,
    wrongAction,
    missedHandoff: c.outcome === "handed_off" && outcome !== null && outcome !== "handed_off",
    unnecessaryHandoff: c.outcome !== "handed_off" && outcome === "handed_off",
  };
}
