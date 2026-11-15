// heic-decode ships no types: it decodes a HEIC photo to RGBA pixels (libheif compiled to WebAssembly).
declare module 'heic-decode' {
  export default function decode(input: { buffer: Uint8Array | ArrayBuffer }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}
