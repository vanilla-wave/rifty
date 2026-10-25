import type { AgentCapabilities } from './types.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reads the host's existing diagnostics; pending work never changes a returned receipt. */
export async function mutationDiagnostics(
  capabilities: AgentCapabilities,
  changes: readonly { path: string; deleted?: boolean }[],
  signal?: AbortSignal,
): Promise<string> {
  const diagnostics = capabilities.diagnostics;
  if (!diagnostics) return 'diagnostics: unavailable';
  if (signal?.aborted) return 'diagnostics: pending (run cancelled)';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const pending = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), 1000);
    cancel = () => resolve(undefined);
    signal?.addEventListener('abort', cancel, { once: true });
  });
  const collected = Promise.all(
    changes.map(async (change) => {
      if (change.deleted) return { path: change.path, unavailable: 'deleted file' };
      try {
        return { path: change.path, entries: await diagnostics(change.path) };
      } catch (error) {
        return {
          path: change.path,
          unavailable: `diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
  try {
    const results = await Promise.race([collected, pending]);
    if (!results) return 'diagnostics: pending';
    let available = 10;
    return results
      .map((result) => {
        if (result.unavailable !== undefined)
          return `${result.path}: diagnostics: unavailable (${result.unavailable})`;
        if (!Array.isArray(result.entries))
          return `${result.path}: diagnostics: unavailable (unsupported host response)`;
        const shown = result.entries.slice(0, available);
        available -= shown.length;
        const lines = shown.map((entry: unknown) => {
          if (!record(entry) || typeof entry.message !== 'string') return JSON.stringify(entry);
          const range = record(entry.range) ? entry.range : undefined;
          const start = record(range?.start) ? range.start : undefined;
          const line = typeof start?.line === 'number' ? `:${start.line + 1}` : '';
          const code =
            entry.code === undefined
              ? ''
              : `${entry.source === 'ts' ? 'TS' : 'code '}${entry.code} `;
          return `${code}${result.path}${line} ${entry.message}`;
        });
        return `${result.path}: diagnostics: ${result.entries.length} diagnostic(s)${lines.length ? `\n${lines.join('\n')}` : ''}${shown.length < result.entries.length ? `\n[${result.entries.length - shown.length} more diagnostics]` : ''}`;
      })
      .join('\n');
  } catch (error) {
    return `diagnostics: unavailable (diagnostics failed: ${error instanceof Error ? error.message : String(error)})`;
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener('abort', cancel);
  }
}
