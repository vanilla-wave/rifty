export const TERMINAL_STATE_PATH = '/workspace/.rifty/terminal-state.json';

/** Last shell line that produced a running dev server + its exec-time cwd; reload-restore replays it. */
export interface TerminalDevCommand {
  readonly line: string;
  readonly cwd: string;
}

export interface TerminalState {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly devCommand?: TerminalDevCommand;
}

export interface TerminalStateFs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  mkdirSync(path: string, options: { recursive?: boolean }): void;
}

export interface TerminalStateVfs {
  readFile(path: string): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string, options: { recursive?: boolean }): Promise<void>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAX_ENV_ENTRIES = 256;
const MAX_ENV_KEY_LENGTH = 256;
const MAX_ENV_VALUE_LENGTH = 8192;

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx <= 0) return '/';
  return path.slice(0, idx);
}

function parseEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_ENV_ENTRIES) break;
    if (key.length === 0 || key.length > MAX_ENV_KEY_LENGTH) continue;
    if (typeof item !== 'string') continue;
    if (item.length > MAX_ENV_VALUE_LENGTH) continue;
    out[key] = item;
  }
  return out;
}

function parseDevCommand(value: unknown): TerminalDevCommand | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cmd = value as { line?: unknown; cwd?: unknown };
  if (typeof cmd.line !== 'string' || cmd.line.length === 0) return undefined;
  if (typeof cmd.cwd !== 'string' || !cmd.cwd.startsWith('/')) return undefined;
  return { line: cmd.line, cwd: cmd.cwd };
}

function normalizeState(state: TerminalState): TerminalState {
  return {
    cwd: state.cwd.startsWith('/') ? state.cwd : '/',
    env: parseEnv(state.env),
    devCommand: parseDevCommand(state.devCommand),
  };
}

function parseState(raw: string, defaultCwd: string): TerminalState {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') return { cwd: defaultCwd, env: {} };
  const state = parsed as { cwd?: unknown; env?: unknown; devCommand?: unknown };
  return {
    cwd: typeof state.cwd === 'string' && state.cwd.startsWith('/') ? state.cwd : defaultCwd,
    env: parseEnv(state.env),
    devCommand: parseDevCommand(state.devCommand),
  };
}

export function loadTerminalState(
  fs: TerminalStateFs,
  defaultCwd: string,
  path = TERMINAL_STATE_PATH,
): TerminalState {
  try {
    if (!fs.existsSync(path)) return { cwd: defaultCwd, env: {} };
    return parseState(dec.decode(fs.readFileBytesSync(path)), defaultCwd);
  } catch {
    return { cwd: defaultCwd, env: {} };
  }
}

export function saveTerminalState(
  fs: TerminalStateFs,
  state: TerminalState,
  path = TERMINAL_STATE_PATH,
): void {
  try {
    const normalized = normalizeState(state);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, enc.encode(JSON.stringify({ version: 1, ...normalized }, null, 2)));
  } catch {
    // Terminal state persistence is best-effort.
  }
}

export async function loadTerminalStateAsync(
  fs: TerminalStateVfs,
  defaultCwd: string,
  path = TERMINAL_STATE_PATH,
): Promise<TerminalState> {
  try {
    const raw = await fs.readFile(path);
    return parseState(typeof raw === 'string' ? raw : dec.decode(raw), defaultCwd);
  } catch {
    return { cwd: defaultCwd, env: {} };
  }
}

export async function saveTerminalStateAsync(
  fs: TerminalStateVfs,
  state: TerminalState,
  path = TERMINAL_STATE_PATH,
): Promise<void> {
  try {
    const normalized = normalizeState(state);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, enc.encode(JSON.stringify({ version: 1, ...normalized }, null, 2)));
  } catch {
    // Terminal state persistence is best-effort.
  }
}
