// Experimental intent model: Jev (TypeSafe System One), behind the "Use Jev" toggle (docs/intent-model.md D18).
// It asks exactly the Choice question measured on validation by pipeline/jev_validation.py, read from the exported
// config, and acts on the threshold chosen there. Plain fetch to the HTTP API (docs.typesafe.ai/api), no SDK.
//
// Privacy (docs/handoff.md H4): the routes mask every message before classifying it; this module masks again at its own
// boundary, so a future caller that forgets can't send a card number or PIN to TypeSafe. The key stays on the server.
// No runtime imports beyond masking, so it is unit-tested without the network (jev.test.ts).
import config from "@/lib/intent-model-jev.json";
import { maskSensitive } from "@/lib/privacy/mask";
import type { IntentLabel, Scores } from "./model";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_TIMEOUT_MS = 3000;
export const JEV = { model: config.model, threshold: config.threshold, questionVersion: config.question_version };

export class JevError extends Error {
  constructor(message: string, readonly kind: "disabled" | "timeout" | "auth" | "throttled" | "unavailable" | "bad_response") {
    super(message);
  }
}

/** The toggle exists only where it's switched on (JEV_TOGGLE=1) and a key is configured. Production keeps Cohere. */
export function jevEnabled(env: Record<string, string | undefined> = process.env) {
  return env.JEV_TOGGLE === "1" && !!env.TYPESAFE_API_KEY;
}

/** The request body: the (masked) message as state and the validated Choice question. */
export function jevRequestBody(text: string) {
  return {
    model: config.model,
    state: { message: maskSensitive(text).text },
    questions: { intent: { type: "choice", instructions: config.instructions, criteria: config.criteria } },
  };
}

/** Jev's answer as our Scores (all seven labels, highest first), or a bad_response error. */
export function parseJevAnswer(body: unknown): { scores: Scores; model: string } {
  const b = (body ?? {}) as { model?: string; answers?: { intent?: { probabilities?: Record<string, number> } } };
  const probabilities = b.answers?.intent?.probabilities;
  if (!probabilities || config.labels.some((l) => typeof probabilities[l] !== "number")) {
    throw new JevError("Jev returned no probability for every intent", "bad_response");
  }
  const scores = config.labels
    .map((label) => ({ label: label as IntentLabel, probability: probabilities[label] }))
    .sort((a, b) => b.probability - a.probability);
  return { scores, model: b.model ?? config.model };
}

export async function classifyJev(
  text: string,
  opts: { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ scores: Scores; model: string }> {
  const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new JevError("TYPESAFE_API_KEY is not configured", "disabled");
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(jevRequestBody(text)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? JEV_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") throw new JevError("Jev timed out", "timeout");
    throw new JevError(`Jev unavailable: ${name ?? String(err)}`, "unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new JevError(`Jev auth failed (${res.status})`, "auth");
  if (res.status === 429) throw new JevError("Jev throttled", "throttled");
  if (!res.ok) throw new JevError(`Jev unavailable (${res.status})`, "unavailable");
  return parseJevAnswer(await res.json().catch(() => null));
}
