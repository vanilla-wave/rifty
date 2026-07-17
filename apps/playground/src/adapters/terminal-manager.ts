/** Shared presentation snapshot for the live companion terminal adapter. */
export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly status: 'idle' | 'running';
  readonly exitCode?: number;
}
