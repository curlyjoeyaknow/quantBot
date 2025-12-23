/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@quantbot/analytics',
    '@quantbot/core',
    '@quantbot/simulation',
    '@quantbot/storage',
    '@quantbot/utils',
  ],
  turbopack: {},
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
