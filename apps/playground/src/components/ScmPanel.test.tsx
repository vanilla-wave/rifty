import type { LogEntry } from '@riftydev/git';
import { renderToString } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { ScmPanel } from './ScmPanel.tsx';

const author = {
  name: 'Ada',
  email: 'ada@example.test',
  timestamp: 1_700_000_000,
  timezoneOffset: 0,
};

const history: readonly LogEntry[] = [
  {
    oid: '0123456789abcdef0123456789abcdef01234567',
    message: 'Tighten project file manager',
    author,
    committer: author,
    tree: 'tree',
    parents: [],
  },
];

describe('ScmPanel', () => {
  it('renders owner-acked staged/changes controls, branch, commit form, and history', () => {
    const html = renderToString(() =>
      ScmPanel({
        root: '/workspace',
        branch: 'main',
        changes: [
          { path: '/workspace/src/main.ts', code: ' M', area: 'working' },
          { path: '/workspace/src/staged.ts', code: 'A ', area: 'staged' },
        ],
        history,
        onOpenChange: () => {},
        onStage: () => Promise.resolve(),
        onUnstage: () => Promise.resolve(),
        onDiscard: () => Promise.resolve(),
        onCommit: () => Promise.resolve(),
      }),
    );

    expect(html).toContain('GIT');
    expect(html).toContain('aria-label="Git"');
    expect(html).toContain('main');
    expect(html).toContain('Staged Changes');
    expect(html).toContain('Changes');
    expect(html).toContain('aria-label="Commit message"');
    expect(html).toContain('Commit');
    expect(html).toContain('aria-label="Stage src/main.ts"');
    expect(html).toContain('aria-label="Discard src/main.ts"');
    expect(html).toContain('aria-label="Unstage src/staged.ts"');
    expect(html).toContain('src/staged.ts');
    expect(html).toContain('src/main.ts');
    expect(html).toContain('0123456');
    expect(html).toContain('Tighten project file manager');
    expect(html).not.toContain('Blame');
    expect(html).not.toContain('Merge');
    expect(html).not.toContain('Timeline');
  });

  it('marks an unsupported status path without exposing mutating or diff controls', () => {
    const html = renderToString(() =>
      ScmPanel({
        root: '/workspace',
        branch: 'main',
        changes: [
          { path: '/workspace/src/known.ts', code: ' M', area: 'working' },
          {
            path: '/workspace/src/future.ts',
            rawStatusMatrixCode: '999',
          },
        ],
        history,
        onOpenChange: () => {},
        onStage: () => Promise.resolve(),
        onUnstage: () => Promise.resolve(),
        onDiscard: () => Promise.resolve(),
        onCommit: () => Promise.resolve(),
      }),
    );

    expect(html).toContain('src/future.ts');
    expect(html).toContain('Unsupported Git status matrix 999');
    expect(html).toContain('data-code="!"');
    expect(html).not.toContain('aria-label="Open changes for src/future.ts"');
    expect(html).not.toContain('aria-label="Stage src/future.ts"');
    expect(html).not.toContain('aria-label="Discard src/future.ts"');
    expect(html).toContain('aria-label="Stage src/known.ts"');
  });
});
