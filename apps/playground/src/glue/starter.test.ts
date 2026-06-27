import { Shell } from '@riftydev/shell';
import { asyncVfs, dirname } from '@riftydev/vfs';
import { createMemoryFs, installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { PRESETS, type Preset } from '../presets.ts';
import {
  EXPRESS_SQLITE_SERVER_SOURCE,
  EXPRESS_SQLITE_TEMPLATE,
} from '../templates/express-sqlite.ts';
import { SOCKET_LAB_TEMPLATE } from '../templates/socket-lab.ts';
import {
  GROUP_FOR_CATEGORY,
  amendStarterGeneratedBaseline,
  ensureStarterInitialCommit,
  seedFilesForStarter,
  starterById,
  starterFromPreset,
} from './starter.ts';

function presetById(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
}

describe('starterFromPreset (ADR-0165 §1/§6)', () => {
  it('maps every registered preset to a Starter with matching id/source', () => {
    for (const preset of PRESETS) {
      const starter = starterFromPreset(preset);
      expect(starter.id).toBe(preset.id);
      expect(starter.source).toBe(preset.source); // SHARED ref, not a copy
    }
  });

  it('PRESERVES the express-sqlite / socket-lab shared .source object identity (a test elsewhere pins equality)', () => {
    const ex = starterFromPreset(presetById('express-sqlite'));
    const so = starterFromPreset(presetById('socket-lab'));
    expect(ex.source).toBe(presetById('express-sqlite').source);
    expect(so.source).toBe(presetById('socket-lab').source);
  });
});

// reconciliation A: the launcher gallery groups Starters by preset
// category, and the Preset→Starter map must never deep-copy a template body — the
// `.source`/`.files` refs the preset shares with its template stay identical.
describe('starterFromPreset shared refs + GROUP_FOR_CATEGORY (ADR-0165 §1)', () => {
  it('preserves the shared source object ref vs the template entry (a test pins template equality)', () => {
    const ex = starterFromPreset(presetById('express-sqlite'));
    expect(ex.source).toBe(EXPRESS_SQLITE_TEMPLATE.entry.content); // same ref, not a copy
    const so = starterFromPreset(presetById('socket-lab'));
    expect(so.source).toBe(SOCKET_LAB_TEMPLATE.entry.content);
  });

  it('preserves the files array element refs (same array ref the preset holds)', () => {
    const ex = starterFromPreset(presetById('express-sqlite'));
    expect(ex.files).toBe(presetById('express-sqlite').files); // same array ref
  });

  it('maps preset.category to a launcher group', () => {
    expect(GROUP_FOR_CATEGORY['Live preview']).toBe('frontend');
    expect(GROUP_FOR_CATEGORY['Files + modules']).toBe('frontend');
    expect(GROUP_FOR_CATEGORY[presetById('express-sqlite').category]).toBe('frontend');
  });
});

describe('starterById', () => {
  it('resolves a known starter', () => {
    expect(starterById('project-files').id).toBe('project-files');
  });
  it('THROWS on an unknown starter (no silent fallback — ADR-0078)', () => {
    expect(() => starterById('nope')).toThrow(/unknown starter/i);
  });
});

// Canonical signature per Cross-Phase Reconciliation A: seedFilesForStarter(starter, root)
// — re-derives the FULL template seed (index.html/package.json/entry/extraFiles)
// for `root`, with the Preset source overlaid at the entry + Preset files[] under root.
describe('seedFilesForStarter (starter, root)', () => {
  it('initializes every Starter root as a git repository', () => {
    for (const preset of PRESETS) {
      const files = seedFilesForStarter(starterById(preset.id), '/scratch');
      expect(files['/scratch/.git/HEAD']).toBe('ref: refs/heads/main\n');
      expect(files['/scratch/.git/config']).toContain('repositoryformatversion = 0');
      expect(files['/scratch/.git/config']).toContain('bare = false');
    }
  });

  it('seeds every Starter as a working shell git repository', async () => {
    installMemoryFs();
    try {
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');

      for (const preset of PRESETS) {
        const root = `/projects/${preset.id}`;
        const files = seedFilesForStarter(starterById(preset.id), root);
        expect(files[`${root}/.gitignore`]).toContain('node_modules/');
        for (const [path, content] of Object.entries(files)) {
          await vfs.mkdir(dirname(path), { recursive: true });
          await vfs.writeFile(path, content);
        }
        await vfs.mkdir(`${root}/node_modules/pkg`, { recursive: true });
        await vfs.writeFile(`${root}/node_modules/pkg/index.js`, 'generated dependency\n');
        await vfs.mkdir(`${root}/dist`, { recursive: true });
        await vfs.writeFile(`${root}/dist/bundle.js`, 'generated build output\n');

        const sh = new Shell({ cwd: root });
        const status = await sh.run('git status --porcelain');
        expect(status.exitCode).toBe(0);
        expect(status.stderr).toBe('');
        expect(status.stdout).not.toContain('node_modules/');
        expect(status.stdout).not.toContain('dist/');

        const config = await sh.run('git config core.repositoryformatversion');
        expect(config.exitCode).toBe(0);
        expect(config.stdout).toBe('0\n');
      }
    } finally {
      resetSyncMirror();
    }
  });

  it('commits every Starter baseline as one clean initial commit', async () => {
    installMemoryFs();
    try {
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');

      for (const preset of PRESETS) {
        const root = `/projects/${preset.id}`;
        const files = seedFilesForStarter(starterById(preset.id), root);
        for (const [path, content] of Object.entries(files)) {
          await vfs.mkdir(dirname(path), { recursive: true });
          await vfs.writeFile(path, content);
        }
        await vfs.mkdir(`${root}/node_modules/pkg`, { recursive: true });
        await vfs.writeFile(`${root}/node_modules/pkg/index.js`, 'generated dependency\n');
        await vfs.mkdir(`${root}/dist`, { recursive: true });
        await vfs.writeFile(`${root}/dist/bundle.js`, 'generated build output\n');

        await ensureStarterInitialCommit(vfs, root);
        await ensureStarterInitialCommit(vfs, root);

        const sh = new Shell({ cwd: root });
        const status = await sh.run('git status --porcelain');
        expect(status).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });

        const log = await sh.run('git log --oneline');
        expect(log.exitCode).toBe(0);
        expect(log.stderr).toBe('');
        expect(log.stdout.trim().split('\n')).toHaveLength(1);
        expect(log.stdout).toMatch(/^[0-9a-f]{7} Initial commit\n$/);

        const editablePath = Object.keys(files).find(
          (path) => !path.includes('/.git/') && !path.includes('/node_modules/'),
        );
        if (!editablePath) throw new Error(`no editable path for ${preset.id}`);
        await vfs.writeFile(editablePath, `${files[editablePath] ?? ''}\n// user edit\n`);
        const dirty = await sh.run('git status --porcelain');
        expect(dirty.stdout).toContain(` M ${editablePath.slice(root.length + 1)}`);
        expect(dirty.stdout).not.toContain('node_modules/');
        expect(dirty.stdout).not.toContain('dist/');
      }
    } finally {
      resetSyncMirror();
    }
  });

  it('commits against the supplied VFS, not the ambient async mirror', async () => {
    installMemoryFs();
    try {
      const { vfs } = createMemoryFs();
      const root = '/projects/isolated';
      const files = seedFilesForStarter(starterById('project-files'), root);
      for (const [path, content] of Object.entries(files)) {
        await vfs.mkdir(dirname(path), { recursive: true });
        await vfs.writeFile(path, content);
      }

      await ensureStarterInitialCommit(vfs, root);

      const ref = await vfs.readFileText(`${root}/.git/refs/heads/main`);
      expect(ref).toMatch(/^[0-9a-f]{40}\n$/);
    } finally {
      resetSyncMirror();
    }
  });

  it('absorbs generated package-lock.json into the single Initial commit', async () => {
    installMemoryFs();
    try {
      const root = '/scratch';
      const vfs = asyncVfs();
      if (!vfs) throw new Error('no async vfs');
      const files = seedFilesForStarter(starterById('project-files'), root);
      for (const [path, content] of Object.entries(files)) {
        await vfs.mkdir(dirname(path), { recursive: true });
        await vfs.writeFile(path, content);
      }
      await ensureStarterInitialCommit(vfs, root);

      await vfs.writeFile(`${root}/package-lock.json`, '{"lockfileVersion":3}\n');
      await amendStarterGeneratedBaseline(vfs, root);

      const sh = new Shell({ cwd: root });
      const status = await sh.run('git status --porcelain');
      expect(status).toMatchObject({ exitCode: 0, stdout: '', stderr: '' });

      const log = await sh.run('git log --oneline');
      expect(log.exitCode).toBe(0);
      expect(log.stdout.trim().split('\n')).toHaveLength(1);
      expect(log.stdout).toMatch(/^[0-9a-f]{7} Initial commit\n$/);
    } finally {
      resetSyncMirror();
    }
  });

  it('emits the program source at the starter entry path + every preset file', () => {
    const files = seedFilesForStarter(starterById('express-sqlite'), '/scratch');
    // the program source is present under some path
    expect(Object.values(files)).toContain(presetById('express-sqlite').source);
    // each preset file content is present under the root
    for (const f of presetById('express-sqlite').files ?? []) {
      expect(files[`/scratch/${f.path}`]).toBe(f.content);
    }
  });

  it('maps a vite Starter to template seed files with the Preset source at the entry', () => {
    const files = seedFilesForStarter(starterById('project-files'), '/scratch');
    // template config seeds index.html + package.json
    expect(files['/scratch/index.html']).toContain('<div id="app">');
    const vitePkg = files['/scratch/package.json'];
    expect(vitePkg).toBeTypeOf('string');
    expect(JSON.parse(vitePkg ?? '').type).toBe('module');
    // the Preset's editor source overwrites the entry (not the template's stub entry)
    expect(files['/scratch/src/main.js']).toContain("getElementById('app')");
    // a Preset extra file lands under the root
    expect(files['/scratch/src/project.json']).toContain('Workspace anatomy');
    expect(files['/scratch/README.md']).toContain('Workspace anatomy');
  });

  it('maps a node-server Starter (express-sqlite) preserving the SHARED source ref + extraFiles', () => {
    const files = seedFilesForStarter(starterById('express-sqlite'), '/projects/p1');
    // node-server entry === the SHARED EXPRESS_SQLITE_SERVER_SOURCE object (equality pinned elsewhere)
    expect(files['/projects/p1/src/main.js']).toBe(EXPRESS_SQLITE_SERVER_SOURCE);
    // package.json declares the node-server dev script
    const nodePkg = files['/projects/p1/package.json'];
    expect(nodePkg).toBeTypeOf('string');
    expect(JSON.parse(nodePkg ?? '').scripts.dev).toContain('node ');
    // a worker-seeded extra file (public asset) lands under the root
    expect(files['/projects/p1/public/index.html']).toBeTypeOf('string');
    // NO index.html seeded at root for node-server (it would shadow the server)
    expect(files['/projects/p1/index.html']).toBeUndefined();
  });
});
