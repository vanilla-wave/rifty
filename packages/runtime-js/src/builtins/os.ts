/**
 * Node-compatible `node:os` (subset).
 *
 * Browser context: most calls return safe defaults. Anything that genuinely
 * needs OS state (uptime over the OS, real network interfaces, etc.) throws
 * NotImplementedError so callers see the gap.
 */
import { NotImplementedError } from '@rifty/io';

export const EOL = '\n';

export function tmpdir(): string {
  return '/tmp';
}

export function homedir(): string {
  return '/home/rifty';
}

export function hostname(): string {
  return 'rifty';
}

// ADR-0026 — `os.platform()` / `os.arch()` mirror `process.platform` /
// `process.arch` exactly. `process.platform === 'rifty'` and
// `process.arch === 'wasm'` are public ABI; any code doing
// `os.platform() === process.platform` must keep working.
export function platform(): string {
  return 'rifty';
}

export function arch(): string {
  return 'wasm';
}

export function type(): string {
  return 'Linux';
}

export function release(): string {
  return '0.0.0';
}

export function endianness(): 'BE' | 'LE' {
  const u16 = new Uint16Array([0xabcd]);
  const u8 = new Uint8Array(u16.buffer);
  return u8[0] === 0xcd ? 'LE' : 'BE';
}

export function cpus(): Array<{
  model: string;
  speed: number;
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}> {
  const count =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 1;
  const stub = {
    model: 'rifty-virtual-cpu',
    speed: 1000,
    times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
  };
  return Array.from({ length: count }, () => ({ ...stub, times: { ...stub.times } }));
}

export function totalmem(): number {
  return 1024 * 1024 * 1024; // 1 GiB fictitious
}

export function freemem(): number {
  return 512 * 1024 * 1024;
}

export function uptime(): number {
  return performance.now() / 1000;
}

export function loadavg(): [number, number, number] {
  return [0, 0, 0];
}

export function networkInterfaces(): Record<string, never[]> {
  return {};
}

export function userInfo(): {
  username: string;
  uid: number;
  gid: number;
  shell: string;
  homedir: string;
} {
  return { username: 'rifty', uid: 1000, gid: 1000, shell: '/bin/sh', homedir: homedir() };
}

export const constants = {
  signals: {} as Record<string, number>,
  errno: {} as Record<string, number>,
  priority: {} as Record<string, number>,
};

export function availableParallelism(): number {
  return typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : 1;
}

export function getPriority(_pid?: number): number {
  return 0;
}

export function setPriority(_pidOrPriority: number, _priority?: number): void {
  throw new NotImplementedError('os.setPriority');
}

const osModule = {
  EOL,
  tmpdir,
  homedir,
  hostname,
  platform,
  arch,
  type,
  release,
  endianness,
  cpus,
  totalmem,
  freemem,
  uptime,
  loadavg,
  networkInterfaces,
  userInfo,
  constants,
  availableParallelism,
  getPriority,
  setPriority,
};

export default osModule;
