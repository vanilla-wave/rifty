import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DefaultResourceLoader,
  SettingsManager,
  loadProjectContextFiles,
} from '@earendil-works/pi-coding-agent';
import { type AgentFiles, type AgentSessionOptions, createAgentSession } from '@riftydev/agent';
import { afterEach, expect, it } from 'vitest';
import { MemoryVfs } from '../../../packages/vfs/src/index.ts';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(tree: Record<string, string>, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rifty-pi-resources-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.git'));
  const vfs = new MemoryVfs();
  await vfs.mkdir(root, { recursive: true });
  for (const [path, content] of Object.entries(tree)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
    await vfs.mkdir(dirname(join(root, path)), { recursive: true });
    await vfs.writeFile(join(root, path), content);
  }
  const files: AgentFiles = {
    read: (path) => vfs.readFileText(path),
    list: async (path) =>
      (await vfs.readdir(path)).map((entry) => ({
        path: join(path, entry.name),
        kind: entry.isDirectory ? 'dir' : 'file',
      })),
    async change(path, transform) {
      const next = transform((await vfs.exists(path)) ? await vfs.readFileText(path) : null);
      if (next === null) await vfs.rm(path);
      else {
        await vfs.mkdir(dirname(path), { recursive: true });
        await vfs.writeFile(path, next);
      }
    },
  };
  const provider = scriptedProvider(Array.from({ length: 10 }, () => 'Arrr.'));
  const session = createAgentSession({
    host: { root, capabilities: () => ({ files }), async close() {} },
    settings: { baseUrl: 'https://scripted.invalid/v1', model: 'scripted' },
    fetch: provider.fetch,
    ...extra,
  } as AgentSessionOptions);
  cleanups.push(() => session.dispose());
  return {
    root,
    vfs,
    session,
    files,
    provider,
    prompt: (index = 0) =>
      String(
        provider.requests[index]?.body.messages.find((message) => message.role === 'system')
          ?.content,
      ),
  };
}

it.each(['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'])(
  'pi context selection and byte-identical block: %s',
  async (candidate) => {
    const f = await fixture(
      {
        [candidate]: '\uFEFFAnswer in pirate speak.\n',
        'sub/CLAUDE.md': 'Descendant must not load.',
      },
      { instructions: ['Consumer append.'] },
    );
    await f.session.send('deploy this');
    const oracle = loadProjectContextFiles({ cwd: f.root, agentDir: join(f.root, 'absent-user') });
    const { buildSystemPrompt } = await import(
      new URL(
        '../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js',
        import.meta.url,
      ).href
    );
    const reference = buildSystemPrompt({
      customPrompt: 'PROFILE',
      cwd: f.root,
      contextFiles: oracle,
    });
    const block = reference.slice(
      reference.indexOf('<project_context>'),
      reference.lastIndexOf('\nCurrent working directory:'),
    );
    expect(f.prompt()).toContain(block);
    expect(f.prompt()).not.toContain('Descendant must not load.');
    expect(f.prompt().indexOf('Consumer append.')).toBeLessThan(
      f.prompt().indexOf('<project_context>'),
    );
    expect(f.prompt()).toMatch(new RegExp(`Current working directory: ${f.root}\\n?$`));
  },
);

it('first candidate wins; user context precedes project; default session emits resources', async () => {
  const f = await fixture(
    { 'AGENTS.md': 'Winner.', 'CLAUDE.md': 'Loser.' },
    { userContextFiles: [{ path: '/provided/AGENTS.md', content: 'User global.' }] },
  );
  await f.session.send('hello');
  expect(f.prompt()).toContain('Winner.');
  expect(f.prompt()).not.toContain('Loser.');
  expect(f.prompt().indexOf('User global.')).toBeGreaterThan(0);
  expect(f.prompt().indexOf('User global.')).toBeLessThan(f.prompt().indexOf('Winner.'));
  expect((await f.session.exportTrace()).events).toContainEqual(
    expect.objectContaining({
      event: expect.objectContaining({
        type: 'resources',
        report: expect.objectContaining({
          contextFiles: expect.arrayContaining([
            expect.objectContaining({ path: join(f.root, 'AGENTS.md') }),
          ]),
        }),
      }),
    }),
  );
});

it('cached instructions change only on explicit reload; report includes all unsupported resources', async () => {
  const unsupported = [
    'extensions/foo.ts',
    'prompts/review.md',
    'SYSTEM.md',
    'APPEND_SYSTEM.md',
    'settings.json',
    'npm/example/package.json',
  ];
  const f = await fixture({
    'AGENTS.md': 'Old instructions.',
    ...Object.fromEntries(unsupported.map((path) => [`.pi/${path}`, '{}'])),
  });
  await f.session.send('first');
  expect(f.prompt()).toContain('Old instructions.');
  await f.vfs.writeFile(join(f.root, 'AGENTS.md'), 'New instructions.');
  await f.session.send('second');
  expect(f.prompt(1)).toContain('Old instructions.');
  // Optional access makes pre-implementation RED an assertion, never a missing-method crash.
  const report = await (
    f.session as typeof f.session & { reload?: () => Promise<unknown> }
  ).reload?.();
  expect(report).toEqual(
    expect.objectContaining({
      unsupported: expect.arrayContaining(
        ['extensions', 'prompts', 'SYSTEM.md', 'APPEND_SYSTEM.md', 'settings.json', 'npm'].map(
          (name) => expect.objectContaining({ path: join(f.root, '.pi', name) }),
        ),
      ),
    }),
  );
  await f.session.send('third');
  expect(f.prompt(2)).toContain('New instructions.');
  expect(f.prompt(2)).not.toContain('Old instructions.');
});

it('opt-outs omit both supplied and project context; no-file host explicitly reports unread resources', async () => {
  const f = await fixture(
    { 'AGENTS.md': 'Do not load.' },
    {
      contextFiles: false,
      skills: false,
      userContextFiles: [{ path: '/user/AGENTS.md', content: 'Neither this.' }],
    },
  );
  await f.session.send('hello');
  expect(f.prompt()).not.toContain('<project_context>');
  const absent = await fixture(
    {},
    { host: { root: '/', capabilities: () => ({}), async close() {} } },
  );
  await absent.session.send('hello');
  expect(absent.prompt()).toContain('Project resources were not read');
});

const skill = (name: string, extra = '') => `---
name: ${name}
description: "${name} <deploy> & verify"
${extra}---
Read and deploy.
`;

it('same tree as full pi CLI: skills discovery, collision winners, hidden entries, diagnostics and block bytes', async () => {
  const f = await fixture({
    '.pi/skills/deploy/SKILL.md': skill('deploy'),
    '.pi/skills/hidden/SKILL.md': skill('hidden', 'disable-model-invocation: true\n'),
    '.pi/skills/bom/SKILL.md': `\uFEFF${skill('bom')}`,
    '.pi/skills/Z/SKILL.md': skill('collision'),
    '.pi/skills/a/SKILL.md': skill('collision'),
    '.pi/skills/standalone.md': skill('standalone'),
    '.pi/skills/nested/plain.md': skill('pi-nested-excluded'),
    '.pi/skills/nested/deeper/SKILL.md': skill('deep'),
    '.pi/skills/deploy/nested/SKILL.md': skill('shadowed'),
    '.pi/skills/.hidden/SKILL.md': skill('dot-hidden'),
    '.pi/skills/node_modules/SKILL.md': skill('node-modules'),
    '.pi/skills/.gitignore': 'ignored/\n',
    '.pi/skills/ignored/SKILL.md': skill('ignored'),
    '.pi/skills/broken/SKILL.md': '---\nname: broken\n---\nNo description',
    '.agents/skills/root.md': skill('agents-root-excluded'),
    '.agents/skills/nested/plain.md': skill('agents-nested'),
    '.agents/skills/deploy/SKILL.md': skill('deploy'),
    '.agents/skills/valid/SKILL.md': skill('agents-valid'),
  });
  const loader = new DefaultResourceLoader({
    cwd: f.root,
    agentDir: join(f.root, 'user'),
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const expected = loader.getSkills();
  const oracle = await import(
    new URL('../node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js', import.meta.url)
      .href
  );
  await f.session.send('deploy this');
  const report = (await f.session.exportTrace()).events
    .map(
      ({ event }) =>
        event as unknown as {
          type: string;
          report?: { skills: unknown[]; diagnostics: unknown[] };
        },
    )
    .find((event) => event.type === 'resources')?.report;
  expect(report).toBeDefined();
  expect(report?.skills).toEqual(
    expected.skills
      .filter((s) => s.filePath.startsWith(f.root))
      .map((s) =>
        expect.objectContaining({
          name: s.name,
          description: s.description,
          filePath: s.filePath,
          disableModelInvocation: s.disableModelInvocation,
        }),
      ),
  );
  expect(report?.diagnostics).toEqual(
    expect.arrayContaining(
      expected.diagnostics
        .filter((d) => d.path.startsWith(f.root))
        .map((d) => expect.objectContaining({ type: d.type, message: d.message, path: d.path })),
    ),
  );
  expect(f.prompt()).toContain(
    oracle
      .formatSkillsForPrompt(expected.skills.filter((s) => s.filePath.startsWith(f.root)))
      .replace('Use the read tool', 'Use the read_file tool'),
  );
});

it('supplied skills occupy global slot; project collision wins; skills opt-out hides all', async () => {
  const userSkills = [
    { name: 'deploy', description: 'user loses', filePath: '/user/deploy/SKILL.md' },
    { name: 'global', description: 'user global', filePath: '/user/global/SKILL.md' },
  ];
  const f = await fixture({ '.pi/skills/deploy/SKILL.md': skill('deploy') }, { userSkills });
  await f.session.send('hello');
  expect(f.prompt()).toContain('<name>global</name>');
  expect(f.prompt()).not.toContain('user loses');
  expect(f.prompt().indexOf('<name>deploy</name>')).toBeLessThan(
    f.prompt().indexOf('<name>global</name>'),
  );
  const off = await fixture(
    { '.pi/skills/deploy/SKILL.md': skill('deploy') },
    { userSkills, skills: false },
  );
  await off.session.send('hello');
  expect(off.prompt()).not.toContain('<available_skills>');
});
