function projectEntry(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value === '/' ||
    value.includes('\0')
  ) {
    throw new TypeError('Node project entryPath must be a project-rooted file path');
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment, index) => index > 0 && (segment === '' || segment === '.' || segment === '..'),
    )
  ) {
    throw new TypeError('Node project entryPath must be normalized inside the project root');
  }
  return `.${value}`;
}

function shellWord(value: string): string {
  if (value.includes('\0')) throw new TypeError('Node CLI argument must not contain NUL');
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Exact project-rooted entry + argv spelling shared by definitions and runtimes. */
export function nodeProjectShellCommand(entryPath: unknown, args: readonly unknown[]): string {
  if (!Array.isArray(args)) throw new TypeError('Node CLI args must be an array');
  const words = args.map((argument, index) => {
    if (typeof argument !== 'string') {
      throw new TypeError(`Node CLI argument ${index} must be a string`);
    }
    return shellWord(argument);
  });
  return ['node', shellWord(projectEntry(entryPath)), ...words].join(' ');
}
