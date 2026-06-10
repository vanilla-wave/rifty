export const TERMINAL_HISTORY_PATH = '/workspace/.rifty/terminal-history.json';
export const TERMINAL_HISTORY_LIMIT = 500;

export type TerminalHistoryMode = 'repl' | 'dev' | 'real-vite';

export interface TerminalHistoryRecord {
  readonly command: string;
  readonly cwd: string;
  readonly mode: TerminalHistoryMode;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode?: number;
}

export interface TerminalHistoryFs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  mkdirSync(path: string, options: { recursive?: boolean }): void;
}

export interface TerminalHistoryVfs {
  readFile(path: string): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string, options: { recursive?: boolean }): Promise<void>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx <= 0) return '/';
  return path.slice(0, idx);
}

function isMode(value: unknown): value is TerminalHistoryMode {
  return value === 'repl' || value === 'dev' || value === 'real-vite';
}

function parseRecord(value: unknown): TerminalHistoryRecord | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<TerminalHistoryRecord>;
  if (typeof item.command !== 'string') return null;
  if (typeof item.cwd !== 'string') return null;
  if (!isMode(item.mode)) return null;
  if (typeof item.sessionId !== 'string') return null;
  if (typeof item.startedAt !== 'string') return null;
  if (typeof item.finishedAt !== 'string') return null;
  if (typeof item.durationMs !== 'number') return null;
  if (item.exitCode != null && typeof item.exitCode !== 'number') return null;
  return {
    command: item.command,
    cwd: item.cwd,
    mode: item.mode,
    sessionId: item.sessionId,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    durationMs: Math.max(0, item.durationMs),
    exitCode: item.exitCode,
  };
}

function normalizeRecords(
  values: readonly unknown[],
  limit = TERMINAL_HISTORY_LIMIT,
): TerminalHistoryRecord[] {
  return values
    .map(parseRecord)
    .filter((item): item is TerminalHistoryRecord => item != null)
    .slice(0, limit);
}

function parseHistory(raw: string): TerminalHistoryRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') return [];
  const records = (parsed as { records?: unknown }).records;
  return Array.isArray(records) ? normalizeRecords(records) : [];
}

export function loadTerminalHistory(
  fs: TerminalHistoryFs,
  path = TERMINAL_HISTORY_PATH,
): TerminalHistoryRecord[] {
  try {
    if (!fs.existsSync(path)) return [];
    return parseHistory(dec.decode(fs.readFileBytesSync(path)));
  } catch {
    return [];
  }
}

export function saveTerminalHistory(
  fs: TerminalHistoryFs,
  records: readonly TerminalHistoryRecord[],
  path = TERMINAL_HISTORY_PATH,
  limit = TERMINAL_HISTORY_LIMIT,
): void {
  try {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(
      path,
      enc.encode(
        JSON.stringify(
          {
            version: 1,
            records: normalizeRecords(records, limit),
          },
          null,
          2,
        ),
      ),
    );
  } catch {
    // History must never break command execution.
  }
}

export async function loadTerminalHistoryAsync(
  fs: TerminalHistoryVfs,
  path = TERMINAL_HISTORY_PATH,
): Promise<TerminalHistoryRecord[]> {
  try {
    const raw = await fs.readFile(path);
    return parseHistory(typeof raw === 'string' ? raw : dec.decode(raw));
  } catch {
    return [];
  }
}

export async function saveTerminalHistoryAsync(
  fs: TerminalHistoryVfs,
  records: readonly TerminalHistoryRecord[],
  path = TERMINAL_HISTORY_PATH,
  limit = TERMINAL_HISTORY_LIMIT,
): Promise<void> {
  try {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(
      path,
      enc.encode(
        JSON.stringify(
          {
            version: 1,
            records: normalizeRecords(records, limit),
          },
          null,
          2,
        ),
      ),
    );
  } catch {
    // History must never break command execution.
  }
}

export function addTerminalHistoryRecord(
  records: readonly TerminalHistoryRecord[],
  record: TerminalHistoryRecord,
  limit = TERMINAL_HISTORY_LIMIT,
): readonly TerminalHistoryRecord[] {
  if (record.command.trim().length === 0) return records;
  return [record, ...records].slice(0, limit);
}

export function searchTerminalHistory(
  records: readonly TerminalHistoryRecord[],
  query: string,
  limit = 20,
): readonly TerminalHistoryRecord[] {
  const needle = query.trim().toLowerCase();
  const matches =
    needle.length === 0
      ? records
      : records.filter((item) =>
          `${item.command}\n${item.cwd}\n${item.mode}`.toLowerCase().includes(needle),
        );
  return matches.slice(0, limit);
}
