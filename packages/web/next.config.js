/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow accessing parent directory files
  serverExternalPackages: ['sqlite3'],
}

module.exports = nextConfig

