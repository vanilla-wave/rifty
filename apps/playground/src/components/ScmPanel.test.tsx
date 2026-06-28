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
        status: new Map([
          ['/workspace/src/main.ts', ' M'],
          ['/workspace/src/staged.ts', 'A '],
        ]),
        history,
        onOpenChange: () => {},
        onStage: () => Promise.resolve(),
        onUnstage: () => Promise.resolve(),
        onDiscard: () => Promise.resolve(),
        onCommit: () => Promise.resolve(),
      }),
    );

    expect(html).toContain('Source Control');
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
});
