import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@bella/db'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

export default nextConfig;
