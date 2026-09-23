/** The process bound by the runtime, separate from guest-writable globalThis.process. */
const hostProcess = (globalThis as { process?: object }).process ?? null;
let activeProcess: object | null = hostProcess;

export function setProcessStdioOwner(process: object | null): void {
  activeProcess = process ?? hostProcess;
}

export function isProcessStdioDestination(destination: unknown): boolean {
  if (activeProcess === null) return false;
  const process = activeProcess as { stdout?: unknown; stderr?: unknown };
  return destination === process.stdout || destination === process.stderr;
}
