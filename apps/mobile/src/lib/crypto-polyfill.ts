/**
 * Minimal WebCrypto polyfill for React Native (Hermes), backed by expo-crypto.
 *
 * supabase-js uses `crypto.getRandomValues` for the PKCE verifier and
 * `crypto.subtle.digest('SHA-256')` for the challenge. Without them it silently
 * downgrades to Math.random and the `plain` challenge method, which weakens the
 * magic-link / OAuth flow. Import this module before creating the Supabase client.
 */
import * as ExpoCrypto from 'expo-crypto';

type DigestInput = ArrayBuffer | ArrayBufferView;

interface CryptoLike {
  getRandomValues?: typeof ExpoCrypto.getRandomValues;
  subtle?: { digest: (algorithm: string | { name: string }, data: DigestInput) => Promise<ArrayBuffer> };
}

const g = globalThis as unknown as { crypto?: CryptoLike };
const target: CryptoLike = g.crypto ?? {};

if (typeof target.getRandomValues !== 'function') {
  target.getRandomValues = ExpoCrypto.getRandomValues;
}

if (!target.subtle || typeof target.subtle.digest !== 'function') {
  target.subtle = {
    async digest(algorithm, data) {
      const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
      if (name !== 'SHA-256') throw new Error(`Unsupported digest algorithm: ${name}`);
      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data as BufferSource);
    },
  };
}

if (!g.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: target, configurable: true });
}
