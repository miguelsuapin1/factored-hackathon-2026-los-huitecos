// Understand step: intent + confidence for one customer message.
// Primary: Cohere on Bedrock (1 bounded retry on timeout/unavailable). Fallback: local e5-small in-process.
// Experiment (D18): with `useJev`, Jev (TypeSafe) answers first at its own validated threshold; if it fails, the usual
// chain answers and the trace says why. Callers pass masked text; jev.ts masks again at its boundary.
// The fallback module is imported lazily so a problem loading it (native runtime, model files) can never take
// down the primary path. The decision rule (act vs ask) is the validation-chosen threshold of whichever model answered
// (docs/intent-model.md D11, D15, D16). Every step's timing and outcome is returned for the trace.
import { randomUUID } from "node:crypto";
import { BedrockError, embedBedrock } from "./embed-bedrock";
import { classifyJev, JEV, JevError } from "./jev";
import { classifyEmbedding, MODELS, type EmbeddingModelId, type IntentLabel, type ModelId, type Scores } from "./model";

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

export async function classifyMessage(text: string, opts: { forceFallback?: boolean; useJev?: boolean } = {}): Promise<IntentResult> {
  const traceId = randomUUID();
  const started = performance.now();
  const attempts: Attempt[] = [];
  let jevReason: string | null = null;

  if (opts.useJev) {
    const t0 = performance.now();
    try {
      const { scores, model: answered } = await classifyJev(text);
      attempts.push({ model: "jev", ok: true, ms: performance.now() - t0 });
      const top = scores[0];
      return {
        traceId, intent: top.label, confidence: top.probability, threshold: JEV.threshold,
        decision: top.probability >= JEV.threshold ? "act" : "ask",
        model: "jev", modelVersion: `${answered} · question ${JEV.questionVersion}`, fallbackReason: null,
        scores, attempts, totalMs: performance.now() - started,
      };
    } catch (err) {
      const kind = err instanceof JevError ? err.kind : "unavailable";
      attempts.push({ model: "jev", ok: false, ms: performance.now() - t0, error: kind });
      jevReason = `jev ${kind}`;
    }
  }

  let embedding: Float32Array | null = null;
  let model: EmbeddingModelId = "cohere-mv3";
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
  // The Jev experiment failed and the usual chain answered: say so (the toggle was on, so it isn't silent).
  if (jevReason) fallbackReason = fallbackReason ? `${jevReason}; ${fallbackReason}` : jevReason;

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
