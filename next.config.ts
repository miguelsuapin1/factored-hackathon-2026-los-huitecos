import type { NextConfig } from "next";

// The intent API bundles the local fallback model (fetched at build time by scripts/fetch-model.mjs) and only
// the Linux x64 ONNX runtime, so the function stays under Vercel's 250 MB limit and never downloads at runtime.
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/classify": [
      "./models/**/*",
      // onnxruntime-node loads its native binding with a dynamic path the tracer can't follow
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*.js",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/**",
    ],
  },
  outputFileTracingExcludes: {
    "/api/classify": [
      "./node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      "./node_modules/onnxruntime-web/**",
      "./node_modules/@img/*darwin*/**",
      "./node_modules/@img/*win32*/**",
      "./node_modules/@img/*arm64*/**",
      "./node_modules/@huggingface/transformers/.cache/**",
    ],
  },
};

export default nextConfig;
