/** Node v24.16.0 `Blob`/`File` over the given bindings (generate-node-blob.mjs). */
export default function createNodeBlob(
  primordials: Readonly<Record<string, unknown>>,
  internalBinding: (id: string) => unknown,
  bind: (id: string) => unknown,
): { readonly Blob: unknown; readonly File: unknown };
