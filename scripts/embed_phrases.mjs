// Embed every phrase with the same model, precision and prefix the deployed app uses
// (src/lib/embedding-config.json), so the classifier is trained on exactly the vectors it will see.
// Output: data/processed/phrase_embeddings.f32 (rows x dims, float32) + phrase_embeddings.json (ids, config).
import { pipeline } from "@huggingface/transformers";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "src/lib/embedding-config.json"), "utf8"));
const phrases = JSON.parse(readFileSync(join(root, "data/processed/phrase_texts.json"), "utf8"));

const extractor = await pipeline("feature-extraction", config.model, { dtype: config.dtype });
const texts = phrases.map((p) => config.prefix + p.text);
const started = performance.now();
const output = await extractor(texts, { pooling: config.pooling, normalize: config.normalize });
const ms = performance.now() - started;

const [rows, dims] = output.dims;
if (rows !== phrases.length || dims !== config.dimensions) throw new Error(`unexpected shape ${output.dims}`);
mkdirSync(join(root, "data/processed"), { recursive: true });
writeFileSync(join(root, "data/processed/phrase_embeddings.f32"), Buffer.from(output.data.buffer));
writeFileSync(
  join(root, "data/processed/phrase_embeddings.json"),
  JSON.stringify({ config, rows, dims, ids: phrases.map((p) => p.phrase_id), embed_ms: Math.round(ms) }, null, 2),
);
console.log(`embedded ${rows} phrases x ${dims} dims in ${(ms / 1000).toFixed(1)}s (${(ms / rows).toFixed(1)} ms/phrase)`);
