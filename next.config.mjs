/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // better-sqlite3 is a native addon: it must stay a real require() at runtime
  // instead of being bundled by the server compiler.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
