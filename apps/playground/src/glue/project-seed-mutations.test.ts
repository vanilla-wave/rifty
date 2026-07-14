import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { projectSeedMutationIntents } from './project-seed-mutations.ts';

const enc = new TextEncoder();

describe('projectSeedMutationIntents', () => {
  it('does not demote an existing manifest that seeding will leave untouched', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/app/.rifty', { recursive: true });
    for (const path of ['/app/package.json', '/app/README.md', '/app/vite.config.js']) {
      fs.writeFileSync(path, enc.encode('existing'));
    }

    const intents = projectSeedMutationIntents(fs, {
      root: '/app',
      seedFiles: {
        '/app/package.json': '{}',
        '/app/vite.config.js': 'export default {}',
        '/app/node_modules/@seed/types.d.ts': 'derived',
      },
      baselineFiles: {},
      freshRoot: false,
    });

    expect(intents).toEqual([
      { kind: 'write', path: '/app/.rifty/vite-config.seeded' },
      { kind: 'write', path: '/app/vite.config.js' },
    ]);
  });

  it('includes a missing manifest before seed bytes can land', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/app', { recursive: true });
    fs.writeFileSync('/app/README.md', enc.encode('existing'));

    expect(
      projectSeedMutationIntents(fs, {
        root: '/app',
        seedFiles: { '/app/package.json': '{}' },
        baselineFiles: {},
        freshRoot: false,
      }),
    ).toContainEqual({ kind: 'write', path: '/app/package.json' });
  });

  it('covers every fresh baseline file except derived node_modules', () => {
    const fs = new MemoryFsSync();

    const intents = projectSeedMutationIntents(fs, {
      root: '/app',
      seedFiles: { '/app/package.json': '{}' },
      baselineFiles: {
        '/app/src/index.ts': 'source',
        '/app/node_modules/pkg/index.js': 'derived',
      },
      freshRoot: true,
    });

    expect(intents).toContainEqual({ kind: 'write', path: '/app/src/index.ts' });
    expect(intents).not.toContainEqual({ kind: 'write', path: '/app/node_modules/pkg/index.js' });
  });
});
