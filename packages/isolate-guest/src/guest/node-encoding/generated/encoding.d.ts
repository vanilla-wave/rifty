/** Node v24.16.0 `internal/encoding` module object (generate-node-encoding.mjs). */
export default function createNodeEncoding(
  primordials: Readonly<Record<string, unknown>>,
  internalBinding: (id: string) => unknown,
  bind: (id: string) => unknown,
): {
  readonly TextDecoder: typeof globalThis.TextDecoder;
  readonly TextEncoder: typeof globalThis.TextEncoder;
  readonly getEncodingFromLabel: (label: string) => string | undefined;
};
