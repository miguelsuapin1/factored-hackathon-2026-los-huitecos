// One customer turn: understand (intent + details, in parallel) -> decide the next move from the conversation state
// (code) -> look up the charge and apply the policy (code) -> respond (Haiku phrasing a code-chosen instruction).
// API contract: docs/contracts.md K1.
import { after } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { advance, missingFor, readYesNo } from "@/lib/conversation/dialogue";
import { extractDetails } from "@/lib/conversation/extract";
import { numbersIn } from "@/lib/conversation/numbers";
import { maskSensitive } from "@/lib/privacy/mask";
import { resolveTurn } from "@/lib/conversation/resolve";
import { supabaseStore } from "@/lib/cases/supabase-store";
import { EXTRACT_PROMPT_VERSION } from "@/lib/conversation/extract";
import { customerFor, lookup } from "@/lib/lookup";
import { restoreState, sealState } from "@/lib/conversation/token";
import { classifyMessage, IntentUnavailableError } from "@/lib/intent/classify";
import { composeReply, PROMPT_VERSION } from "@/lib/reply/compose";
import { guessLanguage, planReply } from "@/lib/reply/templates";

export const maxDuration = 30;
const MAX_CHARS = 500;

export async function POST(request: Request) {
  let body: { text?: unknown; forceFallback?: unknown; state?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { \"text\": \"...\", \"state\": \"<optional>\" }" }, { status: 400 });
  }
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) return Response.json({ error: "text is required" }, { status: 400 });
  if (raw.length > MAX_CHARS) {
    return Response.json({ error: `text is longer than ${MAX_CHARS} characters` }, { status: 413 });
  }
  // H4: mask card numbers, PINs, CVVs and emails before the text goes anywhere (models, state, cases).
  const { text, masked } = maskSensitive(raw);
  // src/proxy.ts already rejected requests without a valid session; this reads who it is.
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
  if (!session) return Response.json({ error: "Your session expired or you're not signed in." }, { status: 401 });

  // Warm the fallback intent model after the response (see api/classify/route.ts for why).
  after(() =>
    import("@/lib/intent/embed-local")
      .then((m) => m.loadLocalModel())
      .catch((err) => console.error(JSON.stringify({ event: "fallback_model_load_failed", error: String(err) }))),
  );

  try {
    const { state: prev, restartReason } = await restoreState(body.state, session);
    // A plain "yes" to a confirmation carries no details: skip the extraction call.
    const skipExtract = prev.pending?.kind === "confirm" && readYesNo(text) === "yes";
    const [intent, extraction] = await Promise.all([
      classifyMessage(text, { forceFallback: body.forceFallback === true }),
      extractDetails(text, {
        skip: skipExtract,
        asked: prev.pending?.kind === "merchant" ? ["the merchant or store"]
          : prev.pending?.kind === "details" ? ["the missing details of the charge (amount, date)"] : [],
      }),
    ]);

    const outcome = advance(prev, { text, intent, details: extraction.details, range: extraction.range, dateIssue: extraction.dateIssue });
    const language = prev.lang ?? guessLanguage(text);
    const { move, trace: policy } = await resolveTurn(outcome, {
      session: customerFor(session),
      lookup,
      store: supabaseStore,
      language,
      promptVersions: {
        intent: `${intent.model}@${intent.modelVersion}`, extract: EXTRACT_PROMPT_VERSION, reply: PROMPT_VERSION,
        environment: process.env.VERCEL_ENV ?? "local", // local/preview/production share one table: filter test rows
      },
    });
    const { state } = outcome;
    // After the policy step: EF-1 can turn a search into a question for the date, which the dialogue didn't know about.
    const missing = missingFor(state);
    const d = state.details;
    const m = state.match;
    const plan = planReply(
      {
        move,
        intent: state.workingIntent ?? intent.intent,
        clarifyOptions: outcome.clarifyOptions,
        clarifyAttempts: state.pending?.kind === "clarify" ? state.pending.attempts : 0,
        details: d,
        missing: missing.filter((k): k is "amount" | "date" => k === "amount" || k === "date"),
        match: m,
        explainRule: policy.rule === "PL-3" || policy.rule === "PL-4" || policy.rule === "PL-5" || policy.rule === "PL-9" ? policy.rule : null,
        handoffReason: state.handoffReason,
        status: state.status,
        caseRef: state.caseRef,
        warnSensitive: masked.includes("secret"),
        options: state.pending?.kind === "pick" ? state.pending.options : null,
        pickAttempts: state.pending?.kind === "pick" ? state.pending.attempts : 0,
        intentGuessed: state.intentGuessed,
        dateIssue: outcome.dateIssue,
        detailAsks: state.pending?.kind === "details" ? (state.pending.attempts ?? 0) : 0,
      },
      language,
    );
    // Numbers the reply may contain: what the customer wrote, grounded details, and the matched record (C9, PL rules).
    const listed = state.pending?.kind === "pick" ? state.pending.options : [];
    const dateParts = [d.date, m?.date, ...listed.map((o) => o.date)].flatMap((iso) => (iso ? iso.split("-").map(Number) : []));
    const reply = await composeReply({
      customerText: text,
      plan,
      allowedNumbers: [
        ...state.customerTexts.flatMap(numbersIn),
        ...[d.amount, d.expectedAmount, m?.amount ?? null, ...listed.map((o) => o.amount)].filter((v): v is number => v !== null),
        ...(state.caseRef ? numbersIn(state.caseRef) : []),
        ...dateParts,
      ],
      languageHint: prev.lang,
    });
    state.lang = reply.language;
    const token = await sealState(state);

    const conversation = {
      state: token,
      conversationId: state.id,
      turn: state.turn,
      workingIntent: state.workingIntent,
      resolvedBy: outcome.resolvedBy,
      move,
      details: d,
      match: m, // the matched charge as the customer may see it (no fraud score)
      policy: { rule: policy.rule, decision: policy.decision, lookup: policy.lookup && { source: policy.lookup.source, count: policy.lookup.count } },
      handoffReason: state.handoffReason,
      case: policy.case && { reference: policy.case.reference, verified: policy.case.verified, kind: policy.case.kind },
      missing,
      pending: state.pending,
      status: state.status,
      restartReason,
      masked, // which kinds of sensitive data were masked in this message (H4)
      extraction: {
        source: extraction.source, dropped: extraction.dropped, error: extraction.error, ms: Math.round(extraction.ms),
        promptVersion: extraction.promptVersion, costUsd: extraction.costUsd,
      },
    };
    // Structured trace line (docs/contracts.md K4). Message texts and detail values are not logged.
    console.log(JSON.stringify({
      event: "turn", traceId: intent.traceId, chars: text.length, masked,
      intent: { model: intent.model, label: intent.intent, confidence: Number(intent.confidence.toFixed(4)),
        decision: intent.decision, fallbackReason: intent.fallbackReason,
        attempts: intent.attempts.map((a) => ({ ...a, ms: Math.round(a.ms) })), ms: Math.round(intent.totalMs) },
      conversation: { conversationId: state.id, turn: state.turn, resolvedBy: outcome.resolvedBy, move, dialogueMove: outcome.move,
        workingIntent: state.workingIntent, pendingBefore: outcome.pendingBefore?.kind ?? null, status: state.status,
        restartReason, detailsKnown: Object.entries(d).filter(([, v]) => v !== null).map(([k]) => k),
        extract: { source: extraction.source, dropped: extraction.dropped, error: extraction.error,
          ms: Math.round(extraction.ms), inputTokens: extraction.inputTokens, outputTokens: extraction.outputTokens,
          costUsd: extraction.costUsd } },
      policy: { rule: policy.rule, decision: policy.decision, lookup: policy.lookup, handoffReason: state.handoffReason,
        matchStatus: m?.status ?? null },
      case: policy.case && { source: policy.case.source, kind: policy.case.kind, verified: policy.case.verified,
        ms: policy.case.ms, error: policy.case.error },
      reply: { source: reply.source, language: reply.language, fallbackReason: reply.fallbackReason,
        promptVersion: reply.promptVersion, ms: Math.round(reply.ms), inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens, costUsd: reply.costUsd },
    }));
    return Response.json({ intent, reply, conversation });
  } catch (err) {
    const attempts = err instanceof IntentUnavailableError ? err.attempts : undefined;
    console.error(JSON.stringify({ event: "turn_failed", error: String(err), attempts }));
    return Response.json({ error: "The assistant is unavailable right now. Try again shortly." }, { status: 503 });
  }
}
