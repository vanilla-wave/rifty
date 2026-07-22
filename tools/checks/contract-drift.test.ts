import { describe, expect, it } from 'vitest';
import { evaluate, statusOf } from './contract-drift.mjs';

const item = (status: string) => `---\narea: playground\nstatus: ${status}\ntitle: T\n---\n\nbody`;

const read = (base: string | null, head: string | null) => (_path: string, side: 'base' | 'head') =>
  side === 'base' ? base : head;

describe('statusOf', () => {
  it('reads frontmatter status, null without one', () => {
    expect(statusOf(item('ready'))).toBe('ready');
    expect(statusOf('no frontmatter')).toBeNull();
    expect(statusOf(null as unknown as string)).toBeNull();
  });
});

describe('evaluate', () => {
  const src = { status: 'M', path: 'packages/vfs/src/index.ts' };
  const contract = { status: 'M', path: 'docs/backlog/playground/x.md' };

  it('flags an in-place ready-contract edit alongside source changes', () => {
    const v = evaluate([src, contract], read(item('ready'), item('ready')));
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('docs/backlog/playground/x.md');
  });

  it('flags a ready→draft demotion alongside source changes', () => {
    expect(evaluate([src, contract], read(item('ready'), item('draft')))).toHaveLength(1);
  });

  it('passes draft edits, docs-only diffs, adds, and deletes', () => {
    expect(evaluate([src, contract], read(item('draft'), item('draft')))).toHaveLength(0);
    expect(evaluate([contract], read(item('ready'), item('ready')))).toHaveLength(0);
    expect(evaluate([src, { ...contract, status: 'A' }], read(null, item('ready')))).toHaveLength(
      0,
    );
    expect(evaluate([src, { ...contract, status: 'D' }], read(item('ready'), null))).toHaveLength(
      0,
    );
  });

  it('guards in-progress epics, skips README/TEMPLATE', () => {
    const epic = { status: 'M', path: 'docs/backlog/epics/e.md' };
    expect(evaluate([src, epic], read(item('in-progress'), item('in-progress')))).toHaveLength(1);
    const readme = { status: 'M', path: 'docs/backlog/README.md' };
    expect(evaluate([src, readme], read(item('ready'), item('ready')))).toHaveLength(0);
  });
});
