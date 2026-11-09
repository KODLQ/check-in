// Minimal types for heic-decode (libheif compiled to WASM; no bundled types).
declare module 'heic-decode' {
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  interface LazyImage {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  }
  function decode(input: { buffer: Uint8Array | ArrayBuffer }): Promise<DecodedImage>;
  namespace decode {
    function all(input: { buffer: Uint8Array | ArrayBuffer }): Promise<LazyImage[] & { dispose(): void }>;
  }
  export default decode;
}
