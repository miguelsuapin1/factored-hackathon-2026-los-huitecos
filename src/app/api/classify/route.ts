import { classifyMessage } from "@/lib/intent/classify";
import { loadLocalModel } from "@/lib/intent/embed-local";

export const maxDuration = 30;

// Start loading the fallback model when the function boots, so an outage doesn't also pay the cold start.
void loadLocalModel().catch((err) => console.error(JSON.stringify({ event: "fallback_model_load_failed", error: String(err) })));

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

  try {
    const result = await classifyMessage(text, { forceFallback: body.forceFallback === true });
    // Structured trace line (tracing proper is build step 6). The message text is not logged.
    console.log(JSON.stringify({
      event: "intent_classified", traceId: result.traceId, model: result.model, intent: result.intent,
      confidence: Number(result.confidence.toFixed(4)), decision: result.decision, fallbackReason: result.fallbackReason,
      attempts: result.attempts.map((a) => ({ ...a, ms: Math.round(a.ms) })), totalMs: Math.round(result.totalMs),
      chars: text.length,
    }));
    return Response.json(result);
  } catch (err) {
    console.error(JSON.stringify({ event: "intent_failed", error: String(err) }));
    return Response.json({ error: "The intent service is unavailable. Try again shortly." }, { status: 503 });
  }
}
