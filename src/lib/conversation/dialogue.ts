// Dialogue policy (build step 11): given the previous state, this turn's intent scores and the extracted details,
// decide what the conversation is about and the assistant's next move. Plain code, no model calls, so every rule is
// testable (dialogue.test.ts) and explainable. Rules and their reasons: docs/conversation.md C5–C8.
import type { IntentLabel, Scores } from "@/lib/intent/model";
import type { DateIssue } from "./extract";
import { EMPTY_DETAILS, FINISHED, MAX_TEXTS, NO_WHEN, type ConversationState, type Details, type MatchView } from "./state";

export const DISPUTES: IntentLabel[] = ["unrecognized_charge", "wrongful_fee"];
/** Intents about one specific charge: they collect amount + date and use the lookup (disputes, and status: S1). */
export const CHARGE_INTENTS: IntentLabel[] = [...DISPUTES, "transaction_status"];
const SAFETY: IntentLabel[] = ["move_money", "human_agent"];
/** C5: share of (A + B) the winning option needs when answering "A or B?". Provisional, set by reasoning. */
export const CLARIFY_SHARE = 0.6;
/** C5: unresolved clarifications before offering a human. */
const MAX_CLARIFY = 2;
/** C17: re-asks for details that got nothing new before handing off (ask, ask again, then a person). */
const MAX_DETAIL_ASKS = 2;
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
  | "picked" // C14: the customer picked one of two listed charges (resolve.ts re-reads it and continues)
  | "pick" // PL-10: two candidates listed for the customer to pick
  | "lookup_status" // S1: status question with its details complete: look the charge up (no confirmation needed)
  | "status_answer" // S1: explain what happened to the charge (PL-3/4/5, or PL-9 approved + offer a review)
  | "open_review" // PL-7: the dispute goes to review (a verified case, step 13)
  | "record_failed"; // V2: the case couldn't be written and verified: say so, nothing is claimed

export type ResolvedBy = "model" | "clarification" | "offer" | "kept_topic" | "new_topic" | "confirmation" | "words";

export type TurnInput = {
  text: string;
  intent: { intent: IntentLabel; decision: "act" | "ask"; scores: Scores };
  details: Partial<Details>; // only grounded values
  range?: { from: string; to: string } | null; // C13: a validated vague period ("la semana pasada")
  dateIssue?: DateIssue | null; // C17: a date the customer stated that we can't use, and why
};

export type TurnOutcome = {
  state: ConversationState;
  move: Move;
  resolvedBy: ResolvedBy;
  missing: (keyof Details)[];
  clarifyOptions: [IntentLabel, IntentLabel] | null;
  pendingBefore: ConversationState["pending"];
  dateIssue: DateIssue | null; // C17: passed to the reply so it says why the date couldn't be used
};

const YES = new Set(["si", "sim", "claro", "correcto", "correto", "exacto", "exato", "dale", "ok", "okay", "vale", "confirmo", "isso", "afirmativo", "perfecto", "perfeito", "yes", "listo", "certo"]);
const NO = new Set(["no", "nao", "incorrecto", "incorreto", "errado", "negativo", "nop"]);
const BUT = /\b(pero|mas|porem|but)\b/;
/** S2: after an approved charge is explained, the customer says it isn't theirs or isn't right. */
const DISPUTE_IT = /\b(no (lo|la) (reconozco|hice|autorice)|no fui yo|no es mio|no es mia|nao (reconheco|fui eu|fiz)|nao e meu|incorrect[oa]|incorret[oa]|errad[oa]|de mas|a mais|duplicad[oa]|dos veces|duas vezes)\b/;
/** C13: the customer doesn't remember (the date, or the merchant when that's what we asked). */
const DONT_KNOW = /\b(no (me )?(acuerdo|recuerdo|se|sabria)|ni idea|no tengo idea|nao (me )?(lembro|sei)|sei la|nao faco ideia)\b/;
/** C13: "the most recent one". */
const LATEST = /\b(mas reciente|el ultimo|la ultima|lo ultimo|mais recente|o ultimo|a ultima)\b/;
/** C14: picking from a list. */
const NONE_OF_THEM = /\b(ninguno|ninguna|ningun|nenhum|nenhuma)\b/;
const FIRST = /\b(primer|primero|primera|primeiro|primeira|el 1|o 1|a 1)\b/;
const SECOND = /\b(segundo|segunda|el 2|o 2|a 2)\b/;
const OLDER = /\b(anterior|mas antiguo|el antiguo|mais antigo|o antigo)\b/;
const MONTHS = ["enero|janeiro", "febrero|fevereiro", "marzo|marco", "abril", "mayo|maio", "junio|junho", "julio|julho",
  "agosto", "septiembre|setiembre|setembro", "octubre|outubro", "noviembre|novembro", "diciembre|dezembro"];

/** C14: which of the listed charges the customer means (options are newest first), "none", or null if unclear. */
export function readPick(text: string, options: MatchView[], merchant?: string | null): number | "none" | null {
  const t = normalize(text);
  if (NONE_OF_THEM.test(t)) return "none";
  const unique = (hits: number[]) => (hits.length === 1 ? hits[0] : null);
  const fold = (s: string) => normalize(s);
  // merchant named (in the text or extracted), ignoring short words
  const byMerchant = options.map((o, i) => ({ i, m: o.merchant ? fold(o.merchant) : "" })).filter(({ m }) =>
    m && (t.includes(m) || (merchant && (m.includes(fold(merchant)) || fold(merchant).includes(m))) ||
      m.split(" ").some((w) => w.length >= 4 && t.split(" ").includes(w))));
  const merchantHit = unique(byMerchant.map((x) => x.i));
  if (merchantHit !== null) return merchantHit;
  // a day of the month ("el del 10") or a month name ("el de febrero")
  const days = (t.match(/\b\d{1,2}\b/g) ?? []).map(Number).filter((d) => d >= 1 && d <= 31);
  const byDay = options.map((o, i) => ({ i, d: Number(o.date.slice(8, 10)) })).filter(({ d }) => days.includes(d));
  if (unique(byDay.map((x) => x.i)) !== null) return byDay[0].i;
  const byMonth = options.map((o, i) => ({ i, m: Number(o.date.slice(5, 7)) }))
    .filter(({ m }) => new RegExp(`\\b(${MONTHS[m - 1]})\\b`).test(t));
  if (unique(byMonth.map((x) => x.i)) !== null) return byMonth[0].i;
  if (LATEST.test(t) || FIRST.test(t)) return 0;
  if (OLDER.test(t) || SECOND.test(t)) return options.length > 1 ? 1 : null;
  return null;
}

/** C16: the customer states what the amount should have been. */
const SHOULD_BE = /\b(deberia (ser|haber sido)|tenia que ser|tendria que ser|deveria (ser|ter sido)|era para ser|tinha que ser)\b/;
/** C15: words that say which kind of charge question it is. */
const UNREC_WORDS = /\b(no (lo |la )?reconozco|desconozco|no fui yo|no (lo |la )?hice|no autorice|fraude|clonar\w*|me robaron|nao reconhec\w*|nao reconheco|nao fiz|nao fui eu|desconhec\w*|clonad\w*)\b/;
const WRONG_WORDS = /\b(dos veces|duplicad\w*|doble|de mas|incorrect\w*|mal cobrad\w*|equivocad\w*|error en el monto|deberia (ser|haber sido)|duas vezes|a mais|errad\w*|deveria ser|comision\w*|anuidade|tarifa)\b/;
const STATUS_WORDS = /\b(que paso|el estado|estatus|rechaz\w*|pendiente|no (ha )?llegad\w*|que aconteceu|status|recusad\w*|pendente|estornad\w*|revertid\w*|que houve)\b/;

/** C15: which dispute the words point to, if they point clearly to one. */
function disputeKindFromWords(text: string, details: Partial<Details>): IntentLabel | null {
  const t = normalize(text);
  const unrec = UNREC_WORDS.test(t);
  const wrong = WRONG_WORDS.test(t) || (details.expectedAmount !== null && details.expectedAmount !== undefined);
  if (wrong && !unrec) return "wrongful_fee";
  if (unrec && !wrong) return "unrecognized_charge";
  return null;
}

/** C15: the flow for a charge question the model couldn't classify: the customer's words first; otherwise, between
 * two disputes the model's top one (guessed), and between a dispute and status, status (read-only; PL-9 offers a
 * review for an approved charge). */
export function chargeKind(options: [IntentLabel, IntentLabel], text: string, details: Partial<Details>): { intent: IntentLabel; guessed: boolean } {
  const byWords = disputeKindFromWords(text, details);
  if (byWords) return { intent: byWords, guessed: false };
  if (STATUS_WORDS.test(normalize(text))) return { intent: "transaction_status", guessed: false };
  if (options.includes("transaction_status")) return { intent: "transaction_status", guessed: true };
  return { intent: options[0], guessed: true };
}

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
  // C16: once the charged amount is known, a new amount said as "debería ser 250" is the expected amount, never a
  // replacement. Haiku sometimes returns it as `amount` (seen live, 1 of 9 runs of TC-01: 350 was overwritten by
  // 250 and the lookup found nothing). A correction at the confirmation step ("no, era de 360") still replaces it.
  const incoming = { ...input.details };
  if (prev.details.amount !== null && incoming.amount !== undefined && incoming.amount !== prev.details.amount
      && prev.pending?.kind !== "confirm" && SHOULD_BE.test(normalize(input.text))) {
    if (incoming.expectedAmount === undefined || incoming.expectedAmount === null) incoming.expectedAmount = incoming.amount;
    delete incoming.amount;
  }
  const merged = mergeDetails(prev.details, incoming);
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
  // C13: an exact date replaces any vague one; a validated period, "el más reciente" or "no me acuerdo" stand in for
  // a missing date while a charge is being discussed.
  if (input.details.date) state.when = { ...NO_WHEN };
  else if (input.range) state.when = { ...NO_WHEN, from: input.range.from, to: input.range.to };
  const onCharge = prev.workingIntent !== null && CHARGE_INTENTS.includes(prev.workingIntent);
  if (onCharge && !input.details.date && !input.range && prev.pending?.kind !== "merchant" && prev.pending?.kind !== "pick") {
    // "el más reciente" / "no me acuerdo" replace whatever date or period was said before (seen live: after "el mes
    // pasado" found nothing, "el más reciente" kept searching May).
    const t = normalize(input.text);
    if (LATEST.test(t)) {
      state.details = { ...state.details, date: null };
      state.when = { ...NO_WHEN, latest: true };
    } else if (DONT_KNOW.test(t)) {
      state.details = { ...state.details, date: null };
      state.when = { ...NO_WHEN, unknown: true };
    }
  }
  const dateIssue = input.details.date ? null : (input.dateIssue ?? null);
  const done = (move: Move, resolvedBy: ResolvedBy, clarifyOptions: [IntentLabel, IntentLabel] | null = null): TurnOutcome => ({
    state, move, resolvedBy, clarifyOptions, pendingBefore, missing: missingFor(state), dateIssue,
  });
  // C17: we asked for details and this reply brought nothing we can use: count it, so the question isn't repeated
  // forever (seen live: "fue el 10 de octubre" asked four times).
  const t0 = normalize(input.text);
  const progress = merged.changed || !!input.range || LATEST.test(t0) || DONT_KNOW.test(t0);
  const asks = prev.pending?.kind === "details" && !progress ? (prev.pending.attempts ?? 0) + 1 : 0;
  const disputeMove = (st: ConversationState, d: typeof done, resolvedBy: ResolvedBy) => nextDisputeMove(st, d, resolvedBy, { asks, dateIssue });

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

  // 2e. We asked for the merchant because several charges matched (C13): the merchant narrows the search;
  // "no sé" or no merchant at all → a person, with everything collected so far.
  if (prev.pending?.kind === "merchant" && !confidentSafety) {
    if (!DONT_KNOW.test(normalize(input.text)) && input.details.merchant) return disputeMove(state, done, "kept_topic");
    return ambiguousHandoff(state, done);
  }

  // 2f. We listed two charges (PL-10): the customer picks one, read by code (C14). Unclear → ask once more → a person.
  if (prev.pending?.kind === "pick" && !confidentSafety) {
    const { options, attempts } = prev.pending;
    const pick = readPick(input.text, options, input.details.merchant);
    if (typeof pick === "number") {
      state.match = options[pick];
      state.pending = null;
      return done("picked", "offer");
    }
    if (pick === "none" && !prev.merchantAsked) {
      state.merchantAsked = true;
      state.pending = { kind: "merchant" };
      return done("ask_narrow", "offer");
    }
    if (pick === null && attempts === 0) {
      state.pending = { kind: "pick", options, attempts: 1 };
      return done("pick", "offer");
    }
    return ambiguousHandoff(state, done);
  }

  // 2b. Waiting for "A or B?" (C5).
  if (prev.pending?.kind === "clarify" && !confidentSafety) {
    const [a, b] = prev.pending.options;
    // C11: a bare "sí"/"no" doesn't choose between two options (seen live with the fallback model): ask again.
    const p = (label: IntentLabel) => intent.scores.find((s) => s.label === label)?.probability ?? 0;
    const total = p(a) + p(b);
    // C12: "revisen el cargo" picks the dispute option when one is offered (code-read, as in C10).
    const asksReview = REVIEW.test(normalize(input.text)) ? [a, b].find((o) => DISPUTES.includes(o)) : undefined;
    // C17: an answer that gives a detail of the charge (an amount, a date, a period, even one we can't search)
    // picks the charge option (seen live: "fue el 10 de octubre" to "¿investigar el cargo o un agente?" picked the agent).
    const givesDetail = merged.changed || !!input.range || !!input.dateIssue;
    const byDetail = givesDetail ? [a, b].find((o) => CHARGE_INTENTS.includes(o)) : undefined;
    const winner = asksReview ?? byDetail ?? (p(a) >= p(b) ? a : b);
    if (!bareAck && total > 0 && (asksReview || byDetail || p(winner) / total >= CLARIFY_SHARE)) {
      state.workingIntent = winner;
      state.pending = null;
      if (winner === "human_agent") {
        // H1/H2, as when the model says it directly: hand off with the context we have, or ask for one line.
        if (hasContext(prev)) return humanHandoff(state, done);
        state.pending = { kind: "summary" };
        return done("ask_summary", "clarification");
      }
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
  // C12b: a short reply (≤ 4 words) to a question we just asked about a charge ("Cable TV", "en Oxxo") is an answer,
  // even if the intent model reads it as confidently out of scope (seen live: "Cable TV" → out_of_scope 74%).
  const answeringUs = prev.pending?.kind === "details" || prev.pending?.kind === "merchant";
  const shortAnswer = answeringUs && intent.intent === "out_of_scope" && normalize(input.text).split(/\s+/).length <= 4;
  // C12c: a reply that gives what we asked for (a detail, a date range, "el más reciente", "no me acuerdo") is an
  // answer, whatever intent the model gives it (seen live: "el más reciente" → balance_check 81%, "latest movements").
  const t = normalize(input.text);
  const gaveWhatWeAsked = answeringUs && (merged.changed || !!input.range || LATEST.test(t) || DONT_KNOW.test(t));
  const ackInTopic = (bareAck || shortAnswer || gaveWhatWeAsked) && prev.workingIntent !== null && CHARGE_INTENTS.includes(prev.workingIntent) && !confidentSafety;
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
      state.when = { ...NO_WHEN };
      state.merchantAsked = false;
      state.dateAsked = false;
      state.intentGuessed = false;
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
  // C15: the customer's words may still settle which kind of dispute it is ("Error en el monto, debería ser 250").
  if (prev.workingIntent && CHARGE_INTENTS.includes(prev.workingIntent)) {
    if (DISPUTES.includes(prev.workingIntent)) {
      const said = disputeKindFromWords(input.text, input.details);
      if (said && said !== prev.workingIntent) {
        state.workingIntent = said;
        state.intentGuessed = false;
      } else if (said) state.intentGuessed = false;
    }
    return disputeMove(state, done, "kept_topic");
  }

  // 5. Not confident and no topic yet. C15: if both likely intents are about a charge (dispute or status), the
  // question "¿no lo reconoces o es incorrecto?" changes nothing we do next (same details, same lookup), so don't
  // ask: take the kind from the customer's words, else start read-only (status) or with the model's top dispute.
  const options: [IntentLabel, IntentLabel] = [intent.scores[0].label, intent.scores[1].label];
  if (CHARGE_INTENTS.includes(options[0]) && CHARGE_INTENTS.includes(options[1])) {
    const { intent: chosen, guessed } = chargeKind(options, input.text, merged.details);
    state.workingIntent = chosen;
    state.intentGuessed = guessed;
    state.pending = null;
    return disputeMove(state, done, guessed ? "model" : "words");
  }
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

function ambiguousHandoff(state: ConversationState, done: (move: Move, resolvedBy: ResolvedBy) => TurnOutcome): TurnOutcome {
  state.pending = null;
  state.status = "handoff";
  state.handoffReason = "ambiguous";
  return done("handoff", "kept_topic");
}

function stripNulls(details: Partial<Details>): Partial<Details> {
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null && v !== undefined));
}

/** What the dispute still needs from the customer (C7, C13). Exported for the reply, after the policy step. */
export function missingFor(state: ConversationState) {
  if (!state.workingIntent || !CHARGE_INTENTS.includes(state.workingIntent)) return [];
  // C13: an exact date, a period, "el más reciente", "no me acuerdo", or the merchant (amount + merchant identify a
  // charge over the whole window) all let the search start. EF-1: once the merchant couldn't tell several charges
  // apart and we asked for the date, the merchant no longer stands in for it.
  const dateKnown = dateGiven(state) || (state.details.merchant !== null && !state.dateAsked);
  return REQUIRED.filter((k) => (k === "date" ? !dateKnown : state.details[k] === null));
}

/** The customer gave a date, a period, "el más reciente" or "no me acuerdo" (anything but the merchant). */
export function dateGiven(state: ConversationState) {
  const w = state.when;
  return state.details.date !== null || (w.from !== null && w.to !== null) || w.latest || w.unknown;
}

/** C7 + C8: in a dispute, ask only for what's missing; once complete, confirm (unless already confirmed).
 * C17: a date older than the window we can search goes to a person (PL-11); asking again without getting anything
 * new is limited to MAX_DETAIL_ASKS, then a person. */
function nextDisputeMove(
  state: ConversationState,
  done: (move: Move, resolvedBy: ResolvedBy) => TurnOutcome,
  resolvedBy: ResolvedBy,
  opts: { asks: number; dateIssue: DateIssue | null },
): TurnOutcome {
  const missing = missingFor(state);
  if (missing.includes("date") && opts.dateIssue?.kind === "too_old") {
    state.pending = null;
    state.status = "handoff";
    state.handoffReason = "too_old";
    return done("handoff", resolvedBy);
  }
  if (missing.length) {
    if (opts.asks >= MAX_DETAIL_ASKS) {
      state.pending = null;
      state.status = "handoff";
      state.handoffReason = "repeated_clarification";
      return done("handoff", resolvedBy);
    }
    state.pending = { kind: "details", attempts: opts.asks };
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
