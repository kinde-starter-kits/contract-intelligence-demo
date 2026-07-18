/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so an unrelated lockfile higher up the tree
  // doesn't get inferred as the root.
  outputFileTracingRoot: import.meta.dirname
};

export default nextConfig;
