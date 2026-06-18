/**
 * Node-compatible `node:os` (subset).
 *
 * Browser context: most calls return safe defaults. Anything that genuinely
 * needs OS state (uptime over the OS, real network interfaces, etc.) throws
 * NotImplementedError so callers see the gap.
 */
import { NotImplementedError } from '@riftydev/io';

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
  signals: {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGBUS: 7,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGUSR1: 10,
    SIGSEGV: 11,
    SIGUSR2: 12,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
    SIGCHLD: 17,
    SIGCONT: 18,
    SIGSTOP: 19,
    SIGTSTP: 20,
    SIGTTIN: 21,
    SIGTTOU: 22,
    SIGURG: 23,
    SIGXCPU: 24,
    SIGXFSZ: 25,
    SIGVTALRM: 26,
    SIGPROF: 27,
    SIGWINCH: 28,
    SIGIO: 29,
    SIGPWR: 30,
    SIGSYS: 31,
  },
  errno: {
    EPERM: 1,
    ENOENT: 2,
    ESRCH: 3,
    EINTR: 4,
    EIO: 5,
    ENXIO: 6,
    E2BIG: 7,
    ENOEXEC: 8,
    EBADF: 9,
    ECHILD: 10,
    EAGAIN: 11,
    EWOULDBLOCK: 11,
    ENOMEM: 12,
    EACCES: 13,
    EFAULT: 14,
    EBUSY: 16,
    EEXIST: 17,
    EXDEV: 18,
    ENODEV: 19,
    ENOTDIR: 20,
    EISDIR: 21,
    EINVAL: 22,
    ENFILE: 23,
    EMFILE: 24,
    ENOTTY: 25,
    ETXTBSY: 26,
    EFBIG: 27,
    ENOSPC: 28,
    ESPIPE: 29,
    EROFS: 30,
    EMLINK: 31,
    EPIPE: 32,
    EDOM: 33,
    ERANGE: 34,
    EDEADLK: 35,
    ENAMETOOLONG: 36,
    ENOLCK: 37,
    ENOSYS: 38,
    ENOTEMPTY: 39,
    ELOOP: 40,
    ENOMSG: 42,
    EIDRM: 43,
    ENODATA: 61,
    ETIME: 62,
    ENOSR: 63,
    ENOLINK: 67,
    EPROTO: 71,
    EMULTIHOP: 72,
    EOVERFLOW: 75,
    EILSEQ: 84,
    ENOTSOCK: 88,
    EDESTADDRREQ: 89,
    EMSGSIZE: 90,
    EPROTOTYPE: 91,
    ENOPROTOOPT: 92,
    EPROTONOSUPPORT: 93,
    ENOTSUP: 95,
    EOPNOTSUPP: 95,
    EAFNOSUPPORT: 97,
    EADDRINUSE: 98,
    EADDRNOTAVAIL: 99,
    ENETDOWN: 100,
    ENETUNREACH: 101,
    ENETRESET: 102,
    ECONNABORTED: 103,
    ECONNRESET: 104,
    ENOBUFS: 105,
    EISCONN: 106,
    ENOTCONN: 107,
    ETIMEDOUT: 110,
    ECONNREFUSED: 111,
    EHOSTUNREACH: 113,
    EALREADY: 114,
    EINPROGRESS: 115,
    ESTALE: 116,
    EDQUOT: 122,
    ECANCELED: 125,
  },
  // Node's static scheduling-priority labels (Linux niceness). getPriority()
  // returns PRIORITY_NORMAL; setPriority() stays a loud NotImplementedError.
  priority: {
    PRIORITY_LOW: 19,
    PRIORITY_BELOW_NORMAL: 10,
    PRIORITY_NORMAL: 0,
    PRIORITY_ABOVE_NORMAL: -7,
    PRIORITY_HIGH: -14,
    PRIORITY_HIGHEST: -20,
  },
  dlopen: {
    RTLD_LAZY: 1,
    RTLD_NOW: 2,
    RTLD_GLOBAL: 256,
    RTLD_LOCAL: 0,
    RTLD_DEEPBIND: 8,
  },
  // Node exposes UV_UDP_REUSEADDR at the TOP level of os.constants (alongside the sub-tables);
  // node:constants flattens it in (ADR-0153).
  UV_UDP_REUSEADDR: 4,
} as const;

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
