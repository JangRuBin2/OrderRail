import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Experimental features for Next.js 15
  experimental: {
    // Server Actions are enabled by default in Next.js 15
  },
};

export default nextConfig;
