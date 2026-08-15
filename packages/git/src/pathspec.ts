/** A pathspec `spec` matches `path` exactly or as a directory prefix (`<spec>/…`). */
export const pathspecMatch = (path: string, spec: string): boolean => {
  const normalized = spec.replace(/\/+$/, '');
  if (normalized === '' || normalized === '.') return true;
  return path === normalized || path.startsWith(`${normalized}/`);
};

/** First pathspec matching no path in `files` (for the PathspecError message). */
export function firstUnmatched(specs: string[], files: string[]): string {
  return specs.find((s) => !files.some((p) => pathspecMatch(p, s))) ?? specs[0] ?? '';
}
