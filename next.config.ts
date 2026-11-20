import type { NextConfig } from "next";

const apiProxyUrl = (process.env.API_PROXY_URL || 'http://localhost:4000/api/v1').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
      ],
    }];
  },
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
