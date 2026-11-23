/**
 * The frozen GNU bash 3.2.57 capture (fixtures/bash, ADR-0093 frozen tier) and
 * rifty's contract per case: bash-identical, a named loud gap, or bash's
 * syntax error.
 */
import { readFileSync } from 'node:fs';

export interface BashCase {
  readonly id: string;
  readonly command: string;
  readonly setup: Readonly<Record<string, string>>;
  readonly bash: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exit: number;
    readonly files: Readonly<Record<string, string>>;
  };
}

export const bashCases = (
  JSON.parse(
    readFileSync(
      new URL('../fixtures/bash/command-lists-bash-3.2.57.json', import.meta.url),
      'utf8',
    ),
  ) as { readonly cases: readonly BashCase[] }
).cases;

export type Expectation = 'conform' | 'syntax-error' | `shell.${string}`;

export function expectation(id: string): Expectation {
  if (id.startsWith('syntax-')) return 'syntax-error';
  if (id.startsWith('fd-')) return 'shell.fd-redirect';
  if (id.startsWith('process-substitution-')) return 'shell.process-substitution';
  // Run in a no-background host (no-COI commands); the COI job path has its own tests.
  if (id.startsWith('background-')) return 'shell.background';
  if (id === 'heredoc-operator-quoted') return 'conform';
  if (id.startsWith('heredoc-')) return 'shell.heredoc';
  if (id.startsWith('here-string')) return 'shell.here-string';
  if (id.startsWith('reserved-word')) return 'conform';
  if (id.startsWith('compound-') || id.startsWith('reserved-')) return 'shell.compound-command';
  return 'conform';
}
