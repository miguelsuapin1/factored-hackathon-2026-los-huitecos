import { after } from "next/server";
import { classifyMessage, IntentUnavailableError } from "@/lib/intent/classify";
import { jevEnabled } from "@/lib/intent/jev";
import { maskSensitive } from "@/lib/privacy/mask";

export const maxDuration = 30;

// Warm the fallback model so an outage doesn't also pay its cold start, but only AFTER the response is sent:
// loading 118 MB of ONNX at boot competed for CPU with the first Bedrock call and made it time out.
// Imported lazily: if it fails to load, only the fallback is affected and the error is logged.
function warmFallback() {
  after(() =>
    import("@/lib/intent/embed-local")
      .then((m) => m.loadLocalModel())
      .catch((err) => console.error(JSON.stringify({ event: "fallback_model_load_failed", error: String(err) }))),
  );
}

const MAX_CHARS = 500;

export async function POST(request: Request) {
  let body: { text?: unknown; forceFallback?: unknown; useJev?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { \"text\": \"...\" }" }, { status: 400 });
  }
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw) return Response.json({ error: "text is required" }, { status: 400 });
  if (raw.length > MAX_CHARS) {
    return Response.json({ error: `text is longer than ${MAX_CHARS} characters` }, { status: 413 });
  }
  // H4: this endpoint also sends text to Cohere (and Jev, D18), so it masks exactly like /api/chat.
  const { text } = maskSensitive(raw);

  warmFallback();
  try {
    const result = await classifyMessage(text, { forceFallback: body.forceFallback === true, useJev: body.useJev === true && jevEnabled() });
    // Structured trace line (tracing proper is build step 6). The message text is not logged.
    console.log(JSON.stringify({
      event: "intent_classified", traceId: result.traceId, model: result.model, intent: result.intent,
      confidence: Number(result.confidence.toFixed(4)), decision: result.decision, fallbackReason: result.fallbackReason,
      attempts: result.attempts.map((a) => ({ ...a, ms: Math.round(a.ms) })), totalMs: Math.round(result.totalMs),
      chars: text.length,
    }));
    return Response.json(result);
  } catch (err) {
    const attempts = err instanceof IntentUnavailableError ? err.attempts : undefined;
    console.error(JSON.stringify({ event: "intent_failed", error: String(err), attempts }));
    return Response.json({ error: "The intent service is unavailable. Try again shortly." }, { status: 503 });
  }
}
