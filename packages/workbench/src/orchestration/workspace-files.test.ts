/**
 * Behavioral contract of the workspace files/archive core + the guarded owner
 * file reader (ADR-0197 slice 4) — replaces the App.test.ts source-greps for
 * editor-write routing, starter re-seed, single-file download and archive
 * export/import. Starter materialization is an injected package seam.
 */
import { describe, expect, it } from 'vitest';
import type { WorkbenchStarter } from '../project-catalog.ts';
import { createOwnerFileReader } from './owner-file-read.ts';
import { type FilesOwnerLike, createWorkspaceFiles } from './workspace-files.ts';

class FakeOwner implements FilesOwnerLike {
  alive = true;
  writes: Array<{ path: string; data: Uint8Array; ifAbsent?: boolean }> = [];
  files = new Map<string, Uint8Array>();
  archive = '{"files":{}}';
  imported: string[] = [];
  durabilityFlushes = 0;
  constructor(
    readonly root: string,
    readonly snapshotPort: unknown = 1,
  ) {}
  isAlive(): boolean {
    return this.alive;
  }
  async readFileBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT ${path}`);
    return bytes;
  }
  async writeFrameAcked(frame: {
    type: 'write';
    path: string;
    data: Uint8Array;
    ifAbsent?: boolean;
  }): Promise<void> {
    this.writes.push({ path: frame.path, data: frame.data, ifAbsent: frame.ifAbsent });
  }
  async flushDurable(): Promise<void> {
    this.durabilityFlushes += 1;
  }
  async exportArchive(): Promise<string> {
    return this.archive;
  }
  async importArchive(text: string): Promise<void> {
    this.imported.push(text);
  }
}

const REACT_STARTER: WorkbenchStarter = {
  id: 'real-vite',
  name: 'Real Vite',
  templateId: 'vite',
  files: [{ path: 'src/main.tsx', content: 'export {}' }],
};

class Harness {
  owner = new FakeOwner('/scratch');
  started = true;
  blocked = false;
  saveOk = true;
  saved: Array<{ name: string; mime: string; data: Uint8Array | string }> = [];
  pickOk = true;
  pickedCb: ((text: () => Promise<string>) => void) | null = null;
  written: Array<{ path: string; content: string }> = [];
  flushes = 0;
  snapshotRequests = 0;
  errors: string[] = [];
  successes: string[] = [];

  files() {
    const reader = createOwnerFileReader<FakeOwner>({
      currentOwner: () => this.owner,
      ownerUnavailable: (owner) => owner.snapshotPort === -1,
    });
    return createWorkspaceFiles<FakeOwner>({
      currentOwner: () => this.owner,
      reader,
      seedFiles: (starter, root) => ({
        [`${root}/package.json`]: '{}',
        [`${root}/index.html`]: '<div id="app"></div>',
        ...Object.fromEntries(
          starter.files.map((file) => [`${root}/${file.path.replace(/^\/+/, '')}`, file.content]),
        ),
      }),
      started: () => this.started,
      notifyFileWritten: (path, content) => this.written.push({ path, content }),
      flushEditorWrites: async () => {
        this.flushes += 1;
      },
      archiveBlocked: () => this.blocked,
      requestVfsSnapshot: () => {
        this.snapshotRequests += 1;
      },
      activeRoot: () => this.owner.root,
      saveFile: (name, mime, data) => {
        if (!this.saveOk) return false;
        this.saved.push({ name, mime, data });
        return true;
      },
      pickArchiveFile: (onPick) => {
        if (!this.pickOk) return false;
        this.pickedCb = onPick;
        return true;
      },
      showError: (message) => this.errors.push(message),
      showSuccess: (message) => this.successes.push(message),
    });
  }
}

describe('SSoT editor write (ADR-0148 owner-routed)', () => {
  it('routes the write to the owner acked, then notifies the dirty binding (§57)', async () => {
    const h = new Harness();
    await h.files().writeFile('/scratch/src/main.tsx', 'x');
    expect(h.owner.writes).toHaveLength(1);
    expect(h.owner.writes[0]?.path).toBe('/scratch/src/main.tsx');
    expect(new TextDecoder().decode(h.owner.writes[0]?.data)).toBe('x');
    expect(h.owner.durabilityFlushes).toBe(1);
    expect(h.written).toEqual([{ path: '/scratch/src/main.tsx', content: 'x' }]);
  });

  it('keeps the editor dirty binding untouched when the durability barrier fails', async () => {
    const h = new Harness();
    h.owner.flushDurable = async () => {
      throw new Error('OPFS quota exhausted');
    };
    await expect(h.files().writeFile('/scratch/src/main.tsx', 'x')).rejects.toThrow(
      'OPFS quota exhausted',
    );
    expect(h.written).toEqual([]);
  });

  it('flushes the same captured owner even when the active owner switches after the write', async () => {
    const h = new Harness();
    const first = h.owner;
    const second = new FakeOwner('/projects/replacement');
    first.writeFrameAcked = async (frame) => {
      first.writes.push({ path: frame.path, data: frame.data, ifAbsent: frame.ifAbsent });
      h.owner = second;
    };

    await h.files().writeFile('/scratch/src/main.tsx', 'x');

    expect(first.writes).toHaveLength(1);
    expect(first.durabilityFlushes).toBe(1);
    expect(second.durabilityFlushes).toBe(0);
    expect(h.written).toEqual([{ path: '/scratch/src/main.tsx', content: 'x' }]);
  });

  it('refuses loud before a project is chosen — no owner write, no dirty', async () => {
    const h = new Harness();
    h.started = false;
    await h.files().writeFile('/scratch/src/main.tsx', 'x');
    expect(h.owner.writes).toEqual([]);
    expect(h.written).toEqual([]);
    expect(h.errors).toEqual(['Choose a project before editing files']);
  });
});

describe('starter re-seed (owner realm, package.json install-owned)', () => {
  it('seeds every REAL starter file except the root package.json', async () => {
    const h = new Harness();
    await h.files().seedOwner(REACT_STARTER);
    expect(h.owner.writes.length).toBeGreaterThan(1);
    const paths = h.owner.writes.map((w) => w.path);
    expect(paths).not.toContain('/scratch/package.json'); // install-owned after boot
    expect(paths.every((p) => p.startsWith('/scratch/'))).toBe(true);
    expect(paths).toContain('/scratch/index.html'); // seed covers the HTML, not just the entry
    expect(h.owner.writes.every((w) => w.ifAbsent === undefined)).toBe(true);
  });

  it('ifAbsent (reload re-seed) never clobbers a persisted edit', async () => {
    const h = new Harness();
    await h.files().seedOwner(REACT_STARTER, true);
    expect(h.owner.writes.length).toBeGreaterThan(0);
    expect(h.owner.writes.every((w) => w.ifAbsent === true)).toBe(true);
  });

  it('captures one owner for the entire seed batch and its durability barrier', async () => {
    const h = new Harness();
    const first = h.owner;
    const second = new FakeOwner('/projects/replacement');
    first.writeFrameAcked = async (frame) => {
      first.writes.push({ path: frame.path, data: frame.data, ifAbsent: frame.ifAbsent });
      h.owner = second;
    };

    await h.files().seedOwner(REACT_STARTER);

    expect(first.writes.length).toBeGreaterThan(1);
    expect(second.writes).toEqual([]);
    expect(first.durabilityFlushes).toBe(1);
    expect(second.durabilityFlushes).toBe(0);
  });
});

describe('single-file download (fresh owner bytes)', () => {
  it('flushes pending editor writes, reads OWNER bytes, saves under the basename', async () => {
    const h = new Harness();
    h.owner.files.set('/scratch/src/a.txt', new TextEncoder().encode('bytes'));
    await h.files().downloadFile('/scratch/src/a.txt');
    expect(h.flushes).toBe(1);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]?.name).toBe('a.txt');
    expect(h.successes).toEqual(['a.txt downloaded']);
  });

  it('an owner death mid-read fails loud (guarded reader), no save', async () => {
    const h = new Harness();
    const owner = h.owner;
    owner.files.set('/scratch/src/a.txt', new TextEncoder().encode('bytes'));
    owner.readFileBytes = async () => {
      owner.alive = false; // the owner dies while the read is in flight
      return new TextEncoder().encode('stale');
    };
    await h.files().downloadFile('/scratch/src/a.txt');
    expect(h.saved).toEqual([]);
    expect(h.errors).toEqual([
      'Download failed: workspace owner is unavailable — cannot download a.txt',
    ]);
  });

  it('an owner RESPAWN mid-read fails loud — never serves the old owner bytes', async () => {
    const h = new Harness();
    const owner = h.owner;
    owner.files.set('/scratch/src/a.txt', new TextEncoder().encode('bytes'));
    owner.readFileBytes = async () => {
      h.owner = new FakeOwner('/projects/p1'); // switch swapped the live owner
      return new TextEncoder().encode('stale');
    };
    await h.files().downloadFile('/scratch/src/a.txt');
    expect(h.saved).toEqual([]);
    expect(h.errors).toEqual(['Download failed: workspace owner changed while downloading a.txt']);
  });

  it('no document → loud error, still no silent success', async () => {
    const h = new Harness();
    h.saveOk = false;
    h.owner.files.set('/scratch/a.txt', new Uint8Array([1]));
    await h.files().downloadFile('/scratch/a.txt');
    expect(h.errors).toEqual(['Download failed: file download is unavailable without a document']);
  });
});

describe('workspace archive export/import (owner tree, dev-server gate)', () => {
  it('exports the OWNER archive with the workspace mime under the fixed name', async () => {
    const h = new Harness();
    await h.files().downloadArchive();
    expect(h.saved).toEqual([
      {
        name: 'rifty-workspace.json',
        mime: 'application/vnd.rifty.workspace+json',
        data: '{"files":{}}',
      },
    ]);
    expect(h.successes).toEqual(['Workspace archive downloaded']);
  });

  it('export lands pending editor writes BEFORE serializing the owner tree', async () => {
    const h = new Harness();
    const owner = h.owner;
    let flushesAtExport = -1;
    owner.exportArchive = async () => {
      flushesAtExport = h.flushes; // a post-export flush would still read 0 here
      return owner.archive;
    };
    await h.files().downloadArchive();
    expect(flushesAtExport).toBe(1);
    expect(h.saved).toHaveLength(1);
  });

  it('import lands pending editor writes BEFORE applying — the archive content wins', async () => {
    const h = new Harness();
    const owner = h.owner;
    let flushesAtImport = -1;
    owner.importArchive = async (text: string) => {
      flushesAtImport = h.flushes; // a queued edit firing after would clobber the import
      owner.imported.push(text);
    };
    await h.files().importArchiveText('{"files":{"a":"1"}}');
    expect(flushesAtImport).toBe(1);
    expect(h.owner.imported).toEqual(['{"files":{"a":"1"}}']);
  });

  it('a running dev server blocks export AND import with the stop-first copy', async () => {
    const h = new Harness();
    h.blocked = true;
    const files = h.files();
    await files.downloadArchive();
    files.chooseArchive();
    expect(h.saved).toEqual([]);
    expect(h.pickedCb).toBeNull();
    expect(h.errors).toEqual([
      'Stop the dev server to archive the editable workspace',
      'Stop the dev server to import into the editable workspace',
    ]);
  });

  it('import applies into the OWNER tree then pulls a fresh snapshot', async () => {
    const h = new Harness();
    await h.files().importArchiveText('{"files":{"a":"1"}}');
    expect(h.owner.imported).toEqual(['{"files":{"a":"1"}}']);
    expect(h.snapshotRequests).toBe(1);
    expect(h.successes).toEqual(['Workspace archive imported']);
  });

  it('a failed import surfaces the owner error, never a silent half-apply', async () => {
    const h = new Harness();
    h.owner.importArchive = async () => {
      throw new Error('bad archive');
    };
    await h.files().importArchiveText('nope');
    expect(h.snapshotRequests).toBe(0);
    expect(h.errors).toEqual(['Import failed: bad archive']);
  });

  it('chooseArchive routes the picked file text into the import flow', async () => {
    const h = new Harness();
    const files = h.files();
    files.chooseArchive();
    expect(h.pickedCb).not.toBeNull();
    h.pickedCb?.(async () => '{"files":{}}');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.owner.imported).toEqual(['{"files":{}}']);
  });

  it('a picked file that fails to READ surfaces Import failed — never a silent unhandled rejection', async () => {
    const h = new Harness();
    h.files().chooseArchive();
    h.pickedCb?.(async () => {
      throw new Error('file unreadable');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.owner.imported).toEqual([]);
    expect(h.errors).toEqual(['Import failed: file unreadable']);
  });
});
