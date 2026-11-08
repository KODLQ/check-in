// expo-crypto is native; back it with Node's crypto for the test.
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomValues: (arr: Uint8Array) => nodeCrypto.randomFillSync(arr),
    digest: async (_alg: string, data: Uint8Array) => {
      const out: Uint8Array = nodeCrypto.createHash('sha256').update(data).digest();
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    },
  };
});

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

describe('crypto polyfill', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  beforeEach(() => {
    // Simulate Hermes: no WebCrypto at all.
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    delete (globalThis as { crypto?: unknown }).crypto;
    jest.resetModules();
  });

  afterAll(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  });

  it('installs getRandomValues and SHA-256 digest used by PKCE', async () => {
    require('@/lib/crypto-polyfill');
    const c = (globalThis as unknown as { crypto: Crypto }).crypto;

    const bytes = c.getRandomValues(new Uint8Array(16));
    expect(bytes.some((b) => b !== 0)).toBe(true);

    const hash = await c.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    expect(toHex(hash)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('rejects unsupported algorithms instead of hashing wrongly', async () => {
    require('@/lib/crypto-polyfill');
    const c = (globalThis as unknown as { crypto: Crypto }).crypto;
    await expect(c.subtle.digest('SHA-1', new Uint8Array([1]))).rejects.toThrow('Unsupported');
  });
});
