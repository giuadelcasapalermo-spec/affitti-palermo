import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**/*': ['./data/**/*'],
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/calendario',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
