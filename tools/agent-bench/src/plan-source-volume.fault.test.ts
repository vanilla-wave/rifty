import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-plan-source-volume-'));
  const repository = process.cwd();
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  git(['init', '-q']);
  git(['config', 'user.name', 'Source volume control']);
  git(['config', 'user.email', 'source-volume@example.invalid']);
  await writeFile(join(directory, 'evidence.bin'), randomBytes(2 * 1024 * 1024));
  git(['add', 'evidence.bin']);
  git(['commit', '-qm', 'Retain source volume baseline']);
  await writeFile(join(directory, 'evidence.bin'), randomBytes(2 * 1024 * 1024));
  const probe = async (configuration = '') => {
    const script = join(directory, 'probe.mts');
    await writeFile(
      script,
      `import {resolve} from 'node:path';
import {loadConfig} from ${JSON.stringify(resolve('tools/agent-bench/src/config.ts'))};
import {loadCorpus} from ${JSON.stringify(resolve('tools/agent-bench/src/corpus.ts'))};
import {resolvePlan} from ${JSON.stringify(resolve('tools/agent-bench/src/plan.ts'))};
const config=await loadConfig(${JSON.stringify(resolve('tools/agent-bench/configs/pilot-comparison.json'))});
${configuration}
const task=(await loadCorpus('eval-v16'))[0];
task.judgeFiles=task.judgeFiles.map(path=>resolve(path));
process.chdir(${JSON.stringify(directory)});
const plan=await resolvePlan(config,[task],['local-reference']);
console.log(JSON.stringify({sourceDirty:plan.sourceDirty,sourceDiffSha256:plan.sourceDiffSha256}));
`,
    );
    return spawnSync(process.execPath, ['--import', 'tsx', script], {
      cwd: repository,
      encoding: 'utf8',
      timeout: 30000,
    });
  };
  const external = async (body: string) => {
    const path = join(directory, 'driver.mjs');
    await writeFile(path, body);
    await writeFile(join(directory, '.gitattributes'), 'evidence.bin diff=source-volume\n');
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    git(['config', 'diff.source-volume.command', `${quote(process.execPath)} ${quote(path)}`]);
  };
  return { directory, git, probe, external };
}

it('hashes the complete real Git binary diff beyond the synchronous capture limit', async () => {
  const f = await fixture();
  try {
    const reference = f.git(['diff', 'HEAD', '--binary']);
    expect(Buffer.byteLength(reference)).toBeGreaterThan(1024 * 1024);
    const result = await f.probe();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      sourceDirty: true,
      sourceDiffSha256: createHash('sha256').update(reference).digest('hex'),
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60000);

it('streams a large real status inventory through the same source owner', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5000; i++)
      await writeFile(join(f.directory, `${'x'.repeat(245)}${String(i).padStart(6, '0')}`), '');
    expect(Buffer.byteLength(f.git(['status', '--porcelain']))).toBeGreaterThan(1024 * 1024);
    const result = await f.probe();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      sourceDirty: true,
      sourceDiffSha256: createHash('sha256')
        .update(f.git(['diff', 'HEAD', '--binary']))
        .digest('hex'),
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60000);

it('rejects partial output from a failed real Git producer', async () => {
  const f = await fixture();
  try {
    await f.external("process.stdout.write('partial diff\\n',()=>process.exit(7));");
    const reference = spawnSync('git', ['diff', 'HEAD', '--binary'], {
      cwd: f.directory,
      encoding: 'utf8',
    });
    expect(reference.status).not.toBe(0);
    expect(reference.stdout).toContain('partial diff');
    const result = await f.probe();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Git source command failed');
    expect(result.stdout).not.toContain('sourceDiffSha256');
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60000);

it('settles a stalled real Git producer at the declared source-command deadline', async () => {
  const f = await fixture();
  try {
    const pidFile = join(f.directory, 'driver.pid');
    await f.external(`import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
process.stdout.write('unfinished diff\\n');setTimeout(()=>process.exit(0),10000);`);
    const result = await f.probe('config.limits.runTimeoutMs=5000;');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Git source command timed out: diff HEAD --binary');
    expect(result.stdout).not.toContain('sourceDiffSha256');
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
}, 60000);
