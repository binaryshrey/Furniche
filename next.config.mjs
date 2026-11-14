/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@matterport/r3f', '@matterport/webcomponent', 'three'],
};
export default nextConfig;
