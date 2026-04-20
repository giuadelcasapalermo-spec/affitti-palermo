import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
