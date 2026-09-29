// Understand step: intent + confidence for one customer message.
// Primary: Cohere on Bedrock (1 bounded retry on timeout/unavailable). Fallback: local e5-small in-process.
// The fallback module is imported lazily so a problem loading it (native runtime, model files) can never take
// down the primary path. The decision rule (act vs ask) is the validation-chosen threshold of whichever model answered
// (docs/intent-model.md D11, D15, D16). Every step's timing and outcome is returned for the trace.
import { randomUUID } from "node:crypto";
import { BedrockError, embedBedrock } from "./embed-bedrock";
import { classifyEmbedding, MODELS, type IntentLabel, type ModelId, type Scores } from "./model";

export type Attempt = { model: ModelId; ok: boolean; ms: number; error?: string };

export type IntentResult = {
  traceId: string;
  intent: IntentLabel;
  confidence: number;
  threshold: number;
  decision: "act" | "ask";
  model: ModelId;
  modelVersion: string;
  fallbackReason: string | null;
  scores: Scores;
  attempts: Attempt[];
  totalMs: number;
};

export class IntentUnavailableError extends Error {
  constructor(message: string, readonly attempts: Attempt[]) {
    super(message);
  }
}

export async function classifyMessage(text: string, opts: { forceFallback?: boolean } = {}): Promise<IntentResult> {
  const traceId = randomUUID();
  const started = performance.now();
  const attempts: Attempt[] = [];
  let embedding: Float32Array | null = null;
  let model: ModelId = "cohere-mv3";
  let fallbackReason: string | null = opts.forceFallback ? "forced (outage simulation)" : null;

  if (!opts.forceFallback) {
    for (let attempt = 1; attempt <= 2 && !embedding; attempt++) {
      const t0 = performance.now();
      try {
        embedding = await embedBedrock(text);
        attempts.push({ model, ok: true, ms: performance.now() - t0 });
      } catch (err) {
        const e = err instanceof BedrockError ? err : new BedrockError(String(err), "unavailable");
        attempts.push({ model, ok: false, ms: performance.now() - t0, error: e.kind });
        fallbackReason = `bedrock ${e.kind}${attempt > 1 ? " after retry" : ""}`;
        if (!e.retryable) break;
      }
    }
  }

  if (!embedding) {
    model = "e5small";
    const t0 = performance.now();
    try {
      const { embedLocal } = await import("./embed-local");
      embedding = await embedLocal(text);
      attempts.push({ model, ok: true, ms: performance.now() - t0 });
    } catch (err) {
      attempts.push({ model, ok: false, ms: performance.now() - t0, error: "fallback_unavailable" });
      throw new IntentUnavailableError(`primary failed (${fallbackReason}) and fallback failed: ${String(err)}`, attempts);
    }
  } else {
    fallbackReason = null;
  }

  const { scores, top, threshold } = classifyEmbedding(model, embedding);
  return {
    traceId,
    intent: top.label,
    confidence: top.probability,
    threshold,
    decision: top.probability >= threshold ? "act" : "ask",
    model,
    modelVersion: MODELS[model].git_commit,
    fallbackReason,
    scores,
    attempts,
    totalMs: performance.now() - started,
  };
}
