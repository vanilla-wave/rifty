import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  DefaultResourceLoader,
  SettingsManager,
  loadProjectContextFiles,
} from '@earendil-works/pi-coding-agent';
import {
  type AgentCapabilities,
  type AgentFiles,
  type AgentSessionEvent,
  type AgentSessionOptions,
  createAgentSession,
} from '@riftydev/agent';
import { afterEach, expect, it } from 'vitest';
import { MemoryVfs } from '../../../packages/vfs/src/index.ts';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(
  tree: Record<string, string>,
  extra:
    | Record<string, unknown>
    | ((root: string, files: AgentFiles) => Record<string, unknown>) = {},
) {
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
    ...(typeof extra === 'function' ? extra(root, files) : extra),
  } as AgentSessionOptions);
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  cleanups.push(() => session.dispose());
  return {
    root,
    events,
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
    const nativeCaseInsensitive = await stat(join(f.root, candidate.toLowerCase())).then(
      () => true,
      () => false,
    );
    const selected = oracle.filter((entry) => entry.path.startsWith(`${f.root}/`));
    if (!nativeCaseInsensitive)
      expect(selected.map((entry) => entry.path)).toEqual([join(f.root, candidate)]);
    // VFS is case-sensitive. Always prove its spelling; native discovery is
    // directly comparable only on a case-sensitive backing filesystem.
    const reference = buildSystemPrompt({
      customPrompt: 'PROFILE',
      cwd: f.root,
      contextFiles: selected.map((entry) => ({ ...entry, path: join(f.root, candidate) })),
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
    'prompts/notes.txt',
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
  // Pi expands `/<name>` for each `.pi/prompts/<name>.md` (non-recursive): those names are
  // reported after one read whose content is discarded; other entries are not templates.
  const reported = report?.unsupported ?? [];
  expect(reported).toContainEqual({ kind: 'prompts', path: join(f.root, '.pi/prompts/review.md') });
  expect(reported.map((entry) => entry.path)).not.toContain(join(f.root, '.pi/prompts/notes.txt'));
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
    '.pi/skills/\uE000/SKILL.md': skill('unicode-collision'),
    '.pi/skills/\u{10000}/SKILL.md': skill('unicode-collision'),
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
  const flat = (list: readonly { type: string; message: string; path?: string }[]) =>
    list.map((d) => `${d.type}|${d.path}|${d.message}`).sort();
  expect(flat(report?.diagnostics as { type: string; message: string; path: string }[])).toEqual(
    flat(expected.diagnostics.filter((d) => d.path?.startsWith(f.root))),
  );
  expect(f.prompt()).toContain(
    oracle
      .formatSkillsForPrompt(expected.skills.filter((s) => s.filePath.startsWith(f.root)))
      .replace('Use the read tool', 'Use the read_file tool'),
  );
});

it('same tree as full pi CLI: reported .pi/prompts template names follow CLI discovery', async () => {
  const f = await fixture({
    'AGENTS.md': 'Templates.',
    '.pi/prompts/review.md': 'Review: $ARGUMENTS',
    '.pi/prompts/.hidden.md': 'Dotfile',
    '.pi/prompts/ignored.md': 'Ignored',
    '.pi/prompts/fdignored.md': 'Fdignored',
    '.pi/prompts/.gitignore': 'ignored.md\n',
    '.pi/prompts/.fdignore': 'fdignored.md\n',
    '.pi/prompts/notes.txt': 'Not a template',
    '.pi/prompts/nested/deep.md': 'Not recursive',
    '.pi/prompts/node_modules/pkg.md': 'Skipped',
    '.pi/prompts/bad.md': '---\ndescription: [broken\n---\nBody\n',
    '.pi/prompts/scalar.md': '---\nscalar\n---\nBody\n',
    '.pi/prompts/empty-frontmatter.md': '---\n---\nBody\n',
    '.pi/prompts/unterminated.md': '---\ndescription: [open\nBody\n',
    '.pi/prompts/bom.md': '\uFEFF---\ndescription: bom\n---\nBody\n',
  });
  const loader = new DefaultResourceLoader({
    cwd: f.root,
    agentDir: join(f.root, 'user'),
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
    noExtensions: true,
    noSkills: true,
    noThemes: true,
  });
  await loader.reload();
  const expected = loader
    .getPrompts()
    .prompts.filter((template) => template.filePath.startsWith(f.root))
    .map((template) => template.filePath)
    .sort();
  // Malformed frontmatter YAML is the only content rule: CLI loadTemplateFromFile drops it.
  expect(expected).toEqual(
    ['bom', 'empty-frontmatter', 'review', 'scalar', 'unterminated'].map((name) =>
      join(f.root, `.pi/prompts/${name}.md`),
    ),
  );
  await f.session.send('hello');
  const event = f.events.find((event) => event.type === 'resources');
  if (event?.type !== 'resources') throw new Error('Missing resource report');
  expect(
    event.report.unsupported
      .filter((entry) => entry.kind === 'prompts' && entry.path.endsWith('.md'))
      .map((entry) => entry.path)
      .sort(),
  ).toEqual(expected);
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

it.each(['contextFiles', 'skills'] as const)(
  'independent %s opt-out preserves the other block',
  async (option) => {
    const f = await fixture(
      { 'AGENTS.md': 'Root context.', '.pi/skills/deploy/SKILL.md': skill('deploy') },
      { [option]: false },
    );
    await f.session.send('hello');
    expect(f.prompt().includes('<project_context>')).toBe(option !== 'contextFiles');
    expect(f.prompt().includes('<available_skills>')).toBe(option !== 'skills');
  },
);

it('startup emits before send; reload returns the emitted snapshot and retains history', async () => {
  const f = await fixture({ 'AGENTS.md': 'Startup instructions.' });
  await expect.poll(() => f.events.some((event) => event.type === 'resources')).toBe(true);
  expect(f.provider.requests).toHaveLength(0);
  await f.session.send('first');
  await f.vfs.writeFile(join(f.root, 'AGENTS.md'), 'Reloaded instructions.');
  const report = await f.session.reload();
  expect(f.events.filter((event) => event.type === 'resources').at(-1)).toEqual({
    type: 'resources',
    report,
  });
  // Report consumers cannot rewrite the session's private snapshot.
  (report.contextFiles as { path: string; content: string }[])[0]!.content = 'Tampered report.';
  await f.session.send('second');
  expect(f.prompt(1)).toContain('Reloaded instructions.');
  expect(f.prompt(1)).not.toContain('Tampered report.');
  expect(
    f.provider.requests[1]?.body.messages.filter((message) => message.role === 'user'),
  ).toHaveLength(2);
  await f.session.dispose();
  await expect(f.session.reload()).rejects.toThrow('disposed');
});

it('no-file startup changes only after explicit reload when files become available', async () => {
  let capabilities: AgentCapabilities = {};
  const f = await fixture({ 'AGENTS.md': 'Now readable.' }, (root) => ({
    host: { root, capabilities: () => capabilities, async close() {} },
  }));
  await f.session.send('preview');
  expect(f.prompt()).toContain('Project resources were not read');
  capabilities = { files: f.files };
  await f.session.send('commands before reload');
  expect(f.prompt(1)).not.toContain('Now readable.');
  const report = await f.session.reload();
  expect(report.fileAccess).toBe('available');
  await f.session.send('commands after reload');
  expect(f.prompt(2)).toContain('Now readable.');
});

it('reload serializes with pending reads and send; active/disposed admission stays loud', async () => {
  let release!: () => void;
  let held: Promise<void> = Promise.resolve();
  const f = await fixture({ 'AGENTS.md': 'Snapshot.' }, (root, files) => ({
    host: {
      root,
      capabilities: () => ({
        files: {
          ...files,
          async read(path: string) {
            await held;
            return files.read(path);
          },
        },
      }),
      async close() {},
    },
  }));
  await f.session.send('initial');
  held = new Promise((resolve) => {
    release = resolve;
  });
  const reload = f.session.reload();
  await expect(f.session.reload()).rejects.toThrow('reload already in progress');
  const sending = f.session.send('during reload');
  await expect(f.session.reload()).rejects.toThrow('Stop the agent');
  expect(f.provider.requests).toHaveLength(1);
  release();
  await reload;
  await sending;
  expect(f.provider.requests).toHaveLength(2);
});

it('resource faults report unreadable context and invalid YAML without hiding later valid resources', async () => {
  const f = await fixture(
    {
      'AGENTS.override.md': 'Unreadable.',
      'AGENTS.md': 'Fallback context.',
      '.pi/skills/.gitignore': 'deploy/\n',
      '.pi/skills/broken/SKILL.md': '---\nname: [broken\n---',
      '.pi/skills/deploy/SKILL.md': skill('deploy'),
      '.pi/prompts/review.md': 'Review.',
      '.pi/prompts/denied.md': 'Unreadable.',
    },
    (root, files) => ({
      host: {
        root,
        capabilities: () => ({
          files: {
            ...files,
            async read(path: string) {
              if (path.endsWith('/AGENTS.override.md'))
                throw Object.assign(new Error('denied context'), { code: 'EACCES' });
              if (path.endsWith('/.gitignore') || path.endsWith('/denied.md'))
                throw Object.assign(new Error('denied ignore'), { code: 'EACCES' });
              return files.read(path);
            },
          },
        }),
        async close() {},
      },
    }),
  );
  await f.session.send('hello');
  expect(f.prompt()).toContain('Fallback context.');
  expect(f.prompt()).toContain('<name>deploy</name>');
  const event = f.events.find((event) => event.type === 'resources');
  expect(event?.type).toBe('resources');
  if (event?.type !== 'resources') throw new Error('Missing resource report');
  expect(event.report.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: join(f.root, 'AGENTS.override.md'),
        message: 'denied context',
      }),
      expect.objectContaining({
        path: join(f.root, '.pi/skills/broken/SKILL.md'),
        type: 'warning',
      }),
    ]),
  );
  // CLI addIgnoreRules swallows unreadable ignore files: no diagnostic, pattern unapplied.
  expect(event.report.diagnostics).not.toContainEqual(
    expect.objectContaining({ path: join(f.root, '.pi/skills/.gitignore') }),
  );
  // CLI loadTemplateFromFile returns null on a read failure: no template, no diagnostic.
  const templates = event.report.unsupported.filter((entry) => entry.path.endsWith('.md'));
  expect(templates).toEqual([{ kind: 'prompts', path: join(f.root, '.pi/prompts/review.md') }]);
  expect(event.report.diagnostics).not.toContainEqual(
    expect.objectContaining({ path: join(f.root, '.pi/prompts/denied.md') }),
  );
});

it('a failed startup read rejects send once; reload retries and the next send carries resources', async () => {
  let calls = 0;
  const f = await fixture({ 'AGENTS.md': 'Recovered instructions.' }, (root, files) => ({
    host: {
      root,
      capabilities: () => {
        if (calls++ === 0) throw new Error('host warming up');
        return { files };
      },
      async close() {},
    },
  }));
  await f.session.send('first');
  expect(f.session.status()).toBe('error');
  expect(f.session.detail()).toBe('host warming up');
  expect(f.provider.requests).toHaveLength(0);
  const report = await f.session.reload();
  expect(report.fileAccess).toBe('available');
  await f.session.send('second');
  expect(f.session.status()).toBe('done');
  expect(f.prompt()).toContain('Recovered instructions.');
});

it('host list entries outside the listed directory are reported, never silently discovered', async () => {
  const f = await fixture({ 'AGENTS.md': 'Bare names.' }, (root, files) => ({
    host: {
      root,
      capabilities: () => ({
        files: {
          ...files,
          list: async (path: string) =>
            (await files.list(path)).map((entry) => ({ ...entry, path: basename(entry.path) })),
        },
      }),
      async close() {},
    },
  }));
  await f.session.send('hello');
  expect(f.prompt()).not.toContain('Bare names.');
  const event = f.events.find((event) => event.type === 'resources');
  if (event?.type !== 'resources') throw new Error('Missing resource report');
  expect(event.report.diagnostics).toContainEqual(
    expect.objectContaining({
      type: 'warning',
      path: 'AGENTS.md',
      message: expect.stringContaining(f.root),
    }),
  );
});

it('empty resources retain profile and emit no resource blocks with cwd last', async () => {
  const f = await fixture({}, { instructions: ['Consumer append.'] });
  await f.session.send('hello');
  expect(f.prompt()).not.toContain('<project_context>');
  expect(f.prompt()).not.toContain('<available_skills>');
  expect(f.prompt()).toMatch(
    new RegExp(`Consumer append\.\nCurrent working directory: ${f.root}\n$`),
  );
});

it('pi context identity prevents the same global/project file appearing twice', async () => {
  const f = await fixture({ 'AGENTS.md': 'Shared instructions.' }, (root) => ({
    userContextFiles: [{ path: join(root, 'AGENTS.md'), content: 'Shared instructions.' }],
  }));
  const oracle = loadProjectContextFiles({ cwd: f.root, agentDir: f.root }).filter((file) =>
    file.path.startsWith(f.root),
  );
  await f.session.send('hello');
  const event = f.events.find((event) => event.type === 'resources');
  expect(event?.type === 'resources' ? event.report.contextFiles : undefined).toEqual(oracle);
  expect(f.prompt().match(/<project_instructions /g)).toHaveLength(oracle.length);
});

it.each(['startup', 'reload'] as const)(
  'expired run budget never dispatches after waiting for %s resources',
  async (phase) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let blocked = phase === 'startup';
    const f = await fixture({ 'AGENTS.md': 'Slow resources.' }, (root, files) => ({
      runTimeoutMs: 10,
      host: {
        root,
        capabilities: () => ({
          files: {
            ...files,
            async read(path: string) {
              if (blocked) await held;
              return files.read(path);
            },
          },
        }),
        async close() {},
      },
    }));
    try {
      if (phase === 'reload')
        await expect.poll(() => f.events.some((event) => event.type === 'resources')).toBe(true);
      blocked = true;
      const reloading = phase === 'reload' ? f.session.reload() : Promise.resolve();
      const sending = f.session.send('do not send after the deadline');
      await new Promise((resolve) => setTimeout(resolve, 40));
      release();
      await Promise.all([sending, reloading]);
      expect(f.session.status()).toBe('budget-exceeded');
      expect(f.provider.requests).toHaveLength(0);
    } finally {
      release();
      await f.session.dispose();
    }
  },
);

it.each(['stop', 'dispose'] as const)(
  '%s during startup read settles before host close without model dispatch',
  async (action) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false;
    const f = await fixture({ 'AGENTS.md': 'Slow resources.' }, (root, files) => ({
      host: {
        root,
        capabilities: () => ({
          files: {
            ...files,
            async read(path: string) {
              await held;
              return files.read(path);
            },
          },
        }),
        async close() {
          closed = true;
        },
      },
    }));
    try {
      const sending = f.session.send('cancel before dispatch');
      const cancelling = f.session[action]();
      expect(closed).toBe(false);
      release();
      await Promise.all([sending, cancelling]);
      expect(f.session.status()).toBe('aborted');
      expect(f.provider.requests).toHaveLength(0);
      expect(closed).toBe(action === 'dispose');
    } finally {
      release();
      await f.session.dispose();
    }
  },
);
