/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so an unrelated lockfile higher up the tree
  // doesn't get inferred as the root.
  outputFileTracingRoot: import.meta.dirname,
  // The vector-similarity route (app/api/agent/similar) uses Transformers.js +
  // the Weaviate client, which ship native/ONNX binaries. Keep them external so
  // Next doesn't try to bundle them — they're required at runtime instead.
  serverExternalPackages: [
    '@xenova/transformers',
    'onnxruntime-node',
    'weaviate-client'
  ]
};

export default nextConfig;
