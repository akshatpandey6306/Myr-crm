import type { NextConfig } from "next";

const apiProxyUrl = (process.env.API_PROXY_URL || 'http://localhost:4000/api/v1').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiProxyUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;