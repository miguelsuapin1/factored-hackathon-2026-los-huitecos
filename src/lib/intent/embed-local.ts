// Local fallback embeddings: multilingual-e5-small via Transformers.js, loaded from ./models (bundled at build
// time), with the exact settings used for training (src/lib/embedding-config.json). No network at runtime.
import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import config from "@/lib/embedding-config.json";

env.localModelPath = path.join(process.cwd(), "models");
env.allowLocalModels = true;
env.allowRemoteModels = false;

let extractor: Promise<FeatureExtractionPipeline> | null = null;

export function loadLocalModel() {
  extractor ??= pipeline("feature-extraction", config.model, {
    dtype: config.dtype as "q8",
  }) as Promise<FeatureExtractionPipeline>;
  return extractor;
}

export async function embedLocal(text: string): Promise<Float32Array> {
  const model = await loadLocalModel();
  const output = await model(config.prefix + text, { pooling: config.pooling as "mean", normalize: config.normalize });
  return output.data as Float32Array;
}
