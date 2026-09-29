// One customer turn (Phase 1): understand (intent) -> respond (Haiku phrasing a code-chosen instruction).
import { after } from "next/server";
import { classifyMessage, IntentUnavailableError } from "@/lib/intent/classify";
import { composeReply } from "@/lib/reply/compose";

export const maxDuration = 30;
const MAX_CHARS = 500;

export async function POST(request: Request) {
  let body: { text?: unknown; forceFallback?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { \"text\": \"...\" }" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return Response.json({ error: `text is longer than ${MAX_CHARS} characters` }, { status: 413 });
  }

  // Warm the fallback intent model after the response (see api/classify/route.ts for why).
  after(() =>
    import("@/lib/intent/embed-local")
      .then((m) => m.loadLocalModel())
      .catch((err) => console.error(JSON.stringify({ event: "fallback_model_load_failed", error: String(err) }))),
  );

  try {
    const intent = await classifyMessage(text, { forceFallback: body.forceFallback === true });
    const reply = await composeReply(text, intent);
    // Structured trace line (build step 6 turns this into proper tracing). The message text is not logged.
    console.log(JSON.stringify({
      event: "turn", traceId: intent.traceId, chars: text.length,
      intent: { model: intent.model, label: intent.intent, confidence: Number(intent.confidence.toFixed(4)),
        decision: intent.decision, fallbackReason: intent.fallbackReason,
        attempts: intent.attempts.map((a) => ({ ...a, ms: Math.round(a.ms) })), ms: Math.round(intent.totalMs) },
      reply: { source: reply.source, language: reply.language, fallbackReason: reply.fallbackReason,
        promptVersion: reply.promptVersion, ms: Math.round(reply.ms), inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens, costUsd: reply.costUsd },
    }));
    return Response.json({ intent, reply });
  } catch (err) {
    const attempts = err instanceof IntentUnavailableError ? err.attempts : undefined;
    console.error(JSON.stringify({ event: "turn_failed", error: String(err), attempts }));
    return Response.json({ error: "The assistant is unavailable right now. Try again shortly." }, { status: 503 });
  }
}
