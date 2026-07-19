import { Shell } from '@riftydev/shell';
import { asyncVfs, dirname } from '@riftydev/vfs';
import { installMemoryFs, resetSyncMirror } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { PRESETS, type Preset } from '../presets.ts';
import { EXPRESS_SQLITE_SERVER_SOURCE } from '../templates/express-sqlite.ts';
import { resolveProjectSpec } from '../templates/registry.ts';
import {
  GROUP_FOR_CATEGORY,
  groupForPreset,
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
  it('keeps starter contents as one ordinary file bundle with no separate source overlay', () => {
    for (const preset of PRESETS) {
      const starter = starterFromPreset(preset);
      const spec = resolveProjectSpec(preset.templateId ?? 'vite');
      const entryPath = spec.entry.relativePath.replace(/^\/+/, '');
      const entryFile = starter.files.find((file) => file.path === entryPath);

      expect('source' in starter).toBe(false);
      expect(entryFile).toBeDefined();
      expect(seedFilesForStarter(starter, '/scratch')[`/scratch/${entryPath}`]).toBe(
        entryFile?.content,
      );
    }
  });

  it('throws loudly when a starter omits the template entry file from files[]', () => {
    expect(() =>
      seedFilesForStarter(
        {
          id: 'broken',
          name: 'Broken',
          starter: 'broken',
          templateId: 'vite',
          files: [{ path: 'README.md', content: 'not the entry\n' }],
        },
        '/scratch',
      ),
    ).toThrow('starter broken is missing entry file src/main.js');
  });

  it('maps every registered preset to a Starter with matching id and file bundle', () => {
    for (const preset of PRESETS) {
      const starter = starterFromPreset(preset);
      expect(starter.id).toBe(preset.id);
      expect(starter.files).toBe(preset.files); // same array ref
    }
  });
});

// reconciliation A: the launcher gallery groups Starters by preset
// category, and the Preset→Starter map must never deep-copy the file bundle.
describe('starterFromPreset shared refs + GROUP_FOR_CATEGORY (ADR-0165 §1)', () => {
  it('preserves the files array element refs (same array ref the preset holds)', () => {
    const ex = starterFromPreset(presetById('express-sqlite'));
    expect(ex.files).toBe(presetById('express-sqlite').files); // same array ref
  });

  it('maps preset.category to a launcher group', () => {
    expect(GROUP_FOR_CATEGORY['Live preview']).toBe('frontend');
    expect(GROUP_FOR_CATEGORY['Files + modules']).toBe('frontend');
    expect(GROUP_FOR_CATEGORY[presetById('express-sqlite').category]).toBe('frontend');
  });

  it('groupForPreset routes node-runtime starters to SERVER, Vite apps to FRONT-END', () => {
    // Derived from the resolved template runtime, not the display category — so
    // a node-server / node-cli starter is never mislabelled under the Vite group.
    expect(groupForPreset(presetById('hono-api'))).toBe('server'); // node-server
    expect(groupForPreset(presetById('koa-api'))).toBe('server');
    expect(groupForPreset(presetById('markdown-ssg'))).toBe('server');
    expect(groupForPreset(presetById('cli-report'))).toBe('server'); // node-cli
    expect(groupForPreset(presetById('express-sqlite'))).toBe('server'); // Express is a node server
    expect(groupForPreset(presetById('socket-lab'))).toBe('server');
    // Vite/front-end presets stay on FRONT-END.
    expect(groupForPreset(presetById('real-vite'))).toBe('frontend');
    expect(groupForPreset(presetById('project-files'))).toBe('frontend');
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
// for `root`, with the Preset files[] overlaid under root.
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

  it('emits every preset file under the root', () => {
    const files = seedFilesForStarter(starterById('express-sqlite'), '/scratch');
    for (const f of presetById('express-sqlite').files ?? []) {
      expect(files[`/scratch/${f.path}`]).toBe(f.content);
    }
  });

  it('maps a vite Starter to template seed files with preset files overlaid', () => {
    const files = seedFilesForStarter(starterById('project-files'), '/scratch');
    // template config seeds index.html + package.json
    expect(files['/scratch/index.html']).toContain('<div id="app">');
    const vitePkg = files['/scratch/package.json'];
    expect(vitePkg).toBeTypeOf('string');
    expect(JSON.parse(vitePkg ?? '').type).toBe('module');
    // the preset file bundle overwrites the template entry like any other path
    expect(files['/scratch/src/main.js']).toContain("getElementById('app')");
    expect(files['/scratch/src/project.json']).toContain('Workspace anatomy');
    expect(files['/scratch/README.md']).toContain('Workspace anatomy');
  });

  it('maps a node-server Starter (express-sqlite) preserving entry file + extraFiles', () => {
    const files = seedFilesForStarter(starterById('express-sqlite'), '/projects/p1');
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
