// Softmax regression over sentence embeddings: the same math as sklearn's LogisticRegression.predict_proba,
// using weights exported by pipeline/train_intent.py. No training happens here.
import cohereModel from "@/lib/intent-model-cohere-mv3.json";
import e5Model from "@/lib/intent-model-e5small.json";

export type IntentLabel =
  | "unrecognized_charge"
  | "wrongful_fee"
  | "transaction_status"
  | "balance_check"
  | "move_money"
  | "human_agent"
  | "out_of_scope";

export type ModelId = "cohere-mv3" | "e5small";

type ExportedModel = {
  labels: string[];
  weights: number[][];
  bias: number[];
  threshold: number;
  embedding: { model: string; dimensions: number };
  git_commit: string;
};

export const MODELS: Record<ModelId, ExportedModel> = {
  "cohere-mv3": cohereModel as ExportedModel,
  e5small: e5Model as ExportedModel,
};

export type Scores = { label: IntentLabel; probability: number }[];

export function classifyEmbedding(model: ModelId, embedding: Float32Array | number[]) {
  const m = MODELS[model];
  if (embedding.length !== m.weights[0].length) {
    throw new Error(`embedding has ${embedding.length} dims, ${model} expects ${m.weights[0].length}`);
  }
  const logits = m.weights.map((w, k) => {
    let z = m.bias[k];
    for (let i = 0; i < w.length; i++) z += w[i] * embedding[i];
    return z;
  });
  const max = Math.max(...logits);
  const exp = logits.map((z) => Math.exp(z - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  const scores: Scores = m.labels
    .map((label, k) => ({ label: label as IntentLabel, probability: exp[k] / sum }))
    .sort((a, b) => b.probability - a.probability);
  return { scores, top: scores[0], threshold: m.threshold };
}
