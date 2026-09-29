// Primary embeddings: Cohere Embed Multilingual v3 on Amazon Bedrock, called exactly as in training
// (pipeline/embed_bedrock.py): input_type "classification", float embeddings, L2-normalized.
//
// Credentials: on Vercel, short-lived credentials from Vercel's OIDC token (AWS_ROLE_ARN, no stored keys).
// Locally, the default AWS chain (AWS_PROFILE=bedrock in .env.local).
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const MODEL_ID = "cohere.embed-multilingual-v3";
export const BEDROCK_TIMEOUT_MS = 1500;

const client = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION ?? "us-east-1",
  maxAttempts: 1, // retries are handled in classify.ts so they stay bounded and visible in the trace
  ...(process.env.AWS_ROLE_ARN ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) } : {}),
});

// Fetch credentials when the function boots (on Vercel: the OIDC -> STS exchange), so the first request's
// 1.5 s timeout covers only the model call. Failures here surface on the first real call instead.
void client.config.credentials().catch(() => undefined);

export class BedrockError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "throttled" | "auth" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
  get retryable() {
    return this.kind === "timeout" || this.kind === "unavailable";
  }
}

export async function embedBedrock(text: string): Promise<Float32Array> {
  const body = JSON.stringify({ texts: [text], input_type: "classification", embedding_types: ["float"] });
  let raw: Uint8Array;
  try {
    const res = await client.send(
      new InvokeModelCommand({ modelId: MODEL_ID, body, contentType: "application/json", accept: "application/json" }),
      { abortSignal: AbortSignal.timeout(BEDROCK_TIMEOUT_MS) },
    );
    raw = res.body;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
    const status = e.$metadata?.httpStatusCode;
    if (e.name === "AbortError" || e.name === "TimeoutError") throw new BedrockError("Bedrock timed out", "timeout");
    if (e.name === "ThrottlingException" || status === 429) throw new BedrockError("Bedrock throttled", "throttled");
    if (e.name === "AccessDeniedException" || e.name === "CredentialsProviderError" || status === 403) {
      throw new BedrockError(`Bedrock auth failed: ${e.name}`, "auth");
    }
    throw new BedrockError(`Bedrock unavailable: ${e.name ?? e.message}`, "unavailable");
  }
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as { embeddings?: { float?: number[][] } };
  const vector = parsed.embeddings?.float?.[0];
  if (!vector?.length) throw new BedrockError("Bedrock returned no embedding", "bad_response");
  const norm = Math.hypot(...vector);
  return Float32Array.from(vector, (v) => v / norm);
}
