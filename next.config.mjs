/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@matterport/r3f', '@matterport/webcomponent', 'three'],
  experimental: {
    // Floor plans are read by model id at runtime (lib/matterport.ts), which the file tracer
    // can't follow, so ship the folder with the routes that use it.
    outputFileTracingIncludes: {
      '/api/models/[sid]': ['./data/geometry/**'],
      '/api/models/[sid]/entry': ['./data/geometry/**'],
    },
  },
};
export default nextConfig;
