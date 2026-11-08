import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@check-in/shared'],
  // Chat apps (iMessage, WhatsApp, Snapchat, Discord…) read link previews from <head>.
  // Never stream metadata, so every client gets OG tags in the initial HTML.
  htmlLimitedBots: /.*/,
  images: { remotePatterns: [{ hostname: '127.0.0.1' }, { hostname: '*.supabase.co' }] },
};

export default nextConfig;
