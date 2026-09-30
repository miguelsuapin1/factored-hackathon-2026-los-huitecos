import type { NextConfig } from "next";

// Both intent routes (/api/classify and /api/chat) bundle the local fallback model (fetched at build time by
// scripts/fetch-model.mjs) and only the Linux x64 ONNX runtime, so each function stays under Vercel's 250 MB limit
// and never downloads at runtime. Any new route that can fall back to e5-small must be added to FALLBACK_ROUTES.
const FALLBACK_ROUTES = ["/api/classify", "/api/chat"];

const include = [
  "./models/**/*",
  // onnxruntime-node loads its native binding with a dynamic path the tracer can't follow
  "./node_modules/onnxruntime-node/package.json",
  "./node_modules/onnxruntime-node/dist/**/*.js",
  "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/**",
  // ...and requires onnxruntime-common's CommonJS build, while the tracer only follows the ESM one
  "./node_modules/onnxruntime-common/package.json",
  "./node_modules/onnxruntime-common/dist/cjs/**",
  // transformers imports sharp, which also picks its native binary by platform at runtime (Vercel = Linux x64)
  "./node_modules/@img/sharp-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/**",
];

const exclude = [
  "./node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
  "./node_modules/onnxruntime-node/bin/napi-v*/win32/**",
  "./node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
  "./node_modules/onnxruntime-web/**",
  "./node_modules/@img/*darwin*/**",
  "./node_modules/@img/*win32*/**",
  "./node_modules/@img/*arm64*/**",
  "./node_modules/@huggingface/transformers/.cache/**",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: Object.fromEntries(FALLBACK_ROUTES.map((r) => [r, include])),
  outputFileTracingExcludes: Object.fromEntries(FALLBACK_ROUTES.map((r) => [r, exclude])),
};

export default nextConfig;
