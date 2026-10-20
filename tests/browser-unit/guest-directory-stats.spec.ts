import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness } from './fixtures.ts';

// Absolute directory link counts vary by host FS (APFS counts files too); ADR-0540 pins VFS counts separately.
const program = `
const fs=require('node:fs');
const root=process.argv[2] || '';
const paths=['/','/home','/home/project','/tmp','/home/rifty'];
const fields=['ino','nlink','mode','size','atimeMs','mtimeMs','ctimeMs','birthtimeMs'];
const facts=paths.map(path=>{
 const first=fs.statSync(root+path), second=fs.lstatSync(root+path);
 return {path, directory:first.isDirectory(), type:first.mode & 0o170000, links:first.nlink>=2,
  numeric:fields.every(field=>typeof first[field]==='number' && Number.isFinite(first[field])),
  stable:first.ino===second.ino};
});
console.log(JSON.stringify(facts));
`;

test('Node stat/lstat cover virtual and mounted Workbench directories', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'rifty-guest-stat-'));
  try {
    for (const path of ['/home/project', '/home/rifty', '/tmp'])
      mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, 'probe.cjs'), program);
    const expected = execFileSync(process.execPath, [join(root, 'probe.cjs'), root], {
      encoding: 'utf8',
    }).trim();
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'guest-directory-stat',
      persistence: 'ephemeral',
      publicProjectRoot: '/home/project',
      plan: {
        kind: 'node-cli',
        id: 'scratch',
        starterId: 'guest-stat',
        templateId: 'browser-unit:guest-stat',
        files: { '/package.json': '{"name":"guest-stat","private":true}', '/probe.cjs': program },
        firstMaterialization: { kind: 'install' },
        entryPath: '/probe.cjs',
      },
    });
    try {
      const result = await execLine(page, 'node probe.cjs');
      expect(result.exit, result.out).toBe(0);
      expect(result.out.trim()).toBe(expected);
    } finally {
      await closeOwner(page);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
