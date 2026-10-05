// Download the local fallback embedding model into ./models at build time (runs as `prebuild`), so the deployed
// app loads it from disk and never needs the internet for the fallback path. Same model and precision as training
// (src/lib/embedding-config.json).
import { env, pipeline } from "@huggingface/transformers";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const config = JSON.parse(readFileSync(join(root, "src/lib/embedding-config.json"), "utf8"));
const target = join(root, "models", config.model, "onnx", "model_quantized.onnx");
if (existsSync(target)) {
  console.log(`fallback model already present: ${config.model}`);
} else {
  env.cacheDir = join(root, "models");
  const t0 = Date.now();
  // Hugging Face sometimes answers 503 for a few seconds; a failed download would fail the whole deploy, so retry.
  const waits = [5000, 15000];
  for (let attempt = 1; ; attempt++) {
    try {
      const extractor = await pipeline("feature-extraction", config.model, { dtype: config.dtype });
      await extractor(config.prefix + "prueba", { pooling: config.pooling, normalize: config.normalize });
      break;
    } catch (err) {
      if (attempt > waits.length) throw err;
      console.warn(`model download failed (attempt ${attempt}): ${err.message}; retrying in ${waits[attempt - 1] / 1000}s`);
      await new Promise((r) => setTimeout(r, waits[attempt - 1]));
    }
  }
  console.log(`downloaded ${config.model} (${config.dtype}) to ./models in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
