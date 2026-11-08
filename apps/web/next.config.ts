import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@check-in/shared'],
  // Chat apps (iMessage, WhatsApp, Snapchat, Discord…) read link previews from <head>.
  // Never stream metadata, so every client gets OG tags in the initial HTML.
  htmlLimitedBots: /.*/,
  // The hand-off page carries a claim ticket in its URL fragment: never leak the URL as a Referer.
  async headers() {
    return [{ source: '/get-app', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }];
  },
  images: { remotePatterns: [{ hostname: '127.0.0.1' }, { hostname: '*.supabase.co' }] },
};

export default nextConfig;
