import { describe, expect, it } from 'vitest';
import type { OwnerToPageFrame, PageToOwnerFrame } from '../glue/pty-protocol.ts';
import type { OwnerStorageSnapshot } from '../workers/owner-storage.ts';
import {
  createOwnerProjectToken,
  inspectPageToWorkbenchOwnerMessage,
  inspectWorkbenchOwnerToPageMessage,
} from './owner-protocol.ts';
import {
  defineNodeCliProject,
  defineNodeServerProject,
  inspectProjectDefinition,
  projectDefinitionWire,
  projects,
} from './project-definition.ts';

const TOKEN = createOwnerProjectToken(() => 'owner-project-token-1');

const REQUIRED_STORAGE = Object.freeze({
  policy: 'required' as const,
  backend: 'opfs' as const,
  durability: 'durable' as const,
});

const BOOT_CONFIG = Object.freeze({
  deployment: Object.freeze({
    workers: Object.freeze({
      kernel: 'https://workbench.invalid/kernel.js',
      node: 'https://workbench.invalid/node.js',
      devServer: 'https://workbench.invalid/dev-server.js',
    }),
    wasm: Object.freeze({
      sqlite: 'https://workbench.invalid/sqlite.wasm',
      esbuild: 'https://workbench.invalid/esbuild.wasm',
    }),
    previewProbeTimeoutMs: 3_000,
  }),
  packageAcquisition: Object.freeze({
    registryUrl: 'https://registry.invalid/',
    eddy: Object.freeze({
      resolverUrl: 'https://eddy.invalid/resolve',
      bundleBaseUrl: 'https://eddy.invalid/bundles/',
      presetPins: Object.freeze({ vite: '8.0.16' }),
    }),
  }),
  storage: Object.freeze({ persistence: 'ephemeral' as const }),
});

const PAGE_PTY_FRAMES = [
  { type: 'pty:open', sid: 's1', cwd: '/projects/a', env: { TERM: 'xterm' } },
  { type: 'pty:exec', sid: 's1', rid: 'r1', line: 'vite', cols: 80, rows: 24, isTTY: true },
  {
    type: 'pty:stdin',
    sid: 's1',
    rid: 'r1',
    opId: 'stdin-1',
    data: new Uint8Array([0, 255]),
  },
  { type: 'pty:stdin-eof', sid: 's1', rid: 'r1', opId: 'eof-1' },
  { type: 'pty:signal', sid: 's1', rid: 'r1', signal: 'SIGINT' },
  { type: 'pty:resize', sid: 's1', rid: 'r1', opId: 'resize-1', cols: 120, rows: 40 },
  { type: 'pty:session-resize', sid: 's1', opId: 'resize-2', cols: 120, rows: 40 },
  { type: 'pty:close', sid: 's1', opId: 'close-1' },
  { type: 'pty:dev-server-req' },
  {
    type: 'pty:dev-config',
    id: 'config-1',
    templateId: 'vite',
    slug: 'project-a',
    setup: 'instant',
  },
] satisfies readonly PageToOwnerFrame[];

const OWNER_PTY_FRAMES = [
  { type: 'pty:ready', sid: 's1' },
  { type: 'pty:ready', sid: 's1', error: 'open failed' },
  { type: 'pty:run-ready', sid: 's1', rid: 'r1' },
  {
    type: 'pty:chunk',
    sid: 's1',
    rid: 'r1',
    stream: 'stdout',
    seq: 0,
    data: new Uint8Array([0, 255]),
  },
  {
    type: 'pty:exit',
    sid: 's1',
    rid: 'r1',
    code: 0,
    exit: { code: 0, signal: null },
    cwd: '/projects/a',
    env: { TERM: 'xterm' },
  },
  {
    type: 'pty:exit',
    sid: 's1',
    rid: 'r1',
    code: 130,
    exit: { code: null, signal: 'SIGINT' },
    cwd: '/projects/a',
    env: {},
    error: 'interrupted',
  },
  { type: 'pty:resize-ack', sid: 's1', rid: 'r1', opId: 'resize-1', ok: true },
  {
    type: 'pty:resize-ack',
    sid: 's1',
    rid: 'r1',
    opId: 'resize-2',
    ok: false,
    error: 'stale',
  },
  { type: 'pty:session-resize-ack', sid: 's1', opId: 'resize-3', ok: true },
  { type: 'pty:stdin-ack', sid: 's1', rid: 'r1', opId: 'stdin-1', ok: true },
  { type: 'pty:close-ack', sid: 's1', opId: 'close-1', ok: true },
  { type: 'pty:dev-server', status: 'starting', sid: 'child-1', cwd: '/projects/a' },
  {
    type: 'pty:dev-server',
    status: 'running',
    sid: 'child-1',
    cwd: '/projects/a',
    port: 5173,
    previewScope: 'scope-1',
    url: '/preview/5173/',
  },
  { type: 'pty:dev-server', status: 'stopped', error: 'exited' },
  { type: 'pty:dev-config-ready', id: 'config-1' },
  { type: 'pty:dev-config-ready', id: 'config-2', error: 'invalid' },
] satisfies readonly OwnerToPageFrame[];

function definitionWire() {
  return projectDefinitionWire(
    inspectProjectDefinition(
      projects.vite({ id: 'protocol-project', files: { '/index.html': '<main />' } }),
    ),
  );
}

function nodeServerDefinitionWire() {
  return projectDefinitionWire(
    inspectProjectDefinition(
      defineNodeServerProject({
        id: 'protocol-node-server',
        files: {
          '/src/main.mjs': 'console.log("main");\n',
          '/src/other.mjs': 'console.log("other");\n',
        },
        entryPath: '/src/main.mjs',
        port: 4321,
      }),
    ),
  );
}

function nodeCliDefinitionWire() {
  return projectDefinitionWire(
    inspectProjectDefinition(
      defineNodeCliProject({
        id: 'protocol-node-cli',
        files: {
          '/src/main.mjs': 'console.log("main");\n',
          '/src/other.mjs': 'console.log("other");\n',
        },
        entryPath: '/src/main.mjs',
        args: ['--format', 'json'],
      }),
    ),
  );
}

function pageMessage(value: unknown): unknown {
  return inspectPageToWorkbenchOwnerMessage(structuredClone(value));
}

function ownerMessage(value: unknown): unknown {
  return inspectWorkbenchOwnerToPageMessage(structuredClone(value));
}

describe('Workbench owner protocol', () => {
  it('carries clone-safe typed boot control instead of process env binding', () => {
    expect(pageMessage({ type: 'workbench:initialize', config: BOOT_CONFIG })).toEqual({
      type: 'workbench:initialize',
      config: BOOT_CONFIG,
    });
    expect(pageMessage({ type: 'workbench:shutdown' })).toEqual({ type: 'workbench:shutdown' });

    expect(() =>
      pageMessage({
        type: 'workbench:initialize',
        config: {
          ...BOOT_CONFIG,
          deployment: {
            ...BOOT_CONFIG.deployment,
            workers: { ...BOOT_CONFIG.deployment.workers, owner: 'page-selected-owner.js' },
          },
        },
      }),
    ).toThrow(TypeError);
  });

  it('admits owner-ready storage, correlated lifecycle replies, and exact failures', () => {
    const storageCases: readonly OwnerStorageSnapshot[] = [
      REQUIRED_STORAGE,
      { policy: 'preferred', backend: 'opfs', durability: 'durable' },
      {
        policy: 'preferred',
        backend: 'memory',
        durability: 'ephemeral',
        fallback: { reason: 'OPFS unavailable' },
      },
      { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
    ];
    for (const storage of storageCases) {
      expect(ownerMessage({ type: 'workbench:owner-ready', storage })).toEqual({
        type: 'workbench:owner-ready',
        storage,
      });
    }

    expect(
      ownerMessage({
        type: 'workbench:project-opened',
        opId: 'open-1',
        projectToken: TOKEN,
        projectRoot: '/projects/protocol-project',
      }),
    ).toEqual({
      type: 'workbench:project-opened',
      opId: 'open-1',
      projectToken: TOKEN,
      projectRoot: '/projects/protocol-project',
    });
    expect(
      ownerMessage({
        type: 'workbench:project-closed',
        opId: 'close-1',
        projectToken: TOKEN,
      }),
    ).toEqual({ type: 'workbench:project-closed', opId: 'close-1', projectToken: TOKEN });
    expect(
      ownerMessage({ type: 'workbench:project-deleted', opId: 'delete-1', id: 'project-a' }),
    ).toEqual({ type: 'workbench:project-deleted', opId: 'delete-1', id: 'project-a' });
    expect(
      ownerMessage({
        type: 'workbench:failure',
        opId: 'open-2',
        error: { name: 'ProjectDefinitionMismatchError', message: 'different definition' },
      }),
    ).toEqual({
      type: 'workbench:failure',
      opId: 'open-2',
      error: { name: 'ProjectDefinitionMismatchError', message: 'different definition' },
    });
    expect(
      ownerMessage({
        type: 'workbench:failure',
        error: { name: 'QuotaExceededError', message: 'owner storage open failed' },
      }),
    ).toEqual({
      type: 'workbench:failure',
      error: { name: 'QuotaExceededError', message: 'owner storage open failed' },
    });
  });

  it('admits clone-safe open, close, and delete commands without a page-selected project token', () => {
    const open = pageMessage({
      type: 'workbench:open-project',
      opId: 'open-1',
      definition: definitionWire(),
    }) as { readonly definition: { readonly files: Readonly<Record<string, Uint8Array>> } };
    expect(open.definition.files['/index.html']).toBeInstanceOf(Uint8Array);

    expect(
      pageMessage({ type: 'workbench:close-project', opId: 'close-1', projectToken: TOKEN }),
    ).toEqual({ type: 'workbench:close-project', opId: 'close-1', projectToken: TOKEN });
    expect(
      pageMessage({ type: 'workbench:delete-project', opId: 'delete-1', id: 'project-a' }),
    ).toEqual({ type: 'workbench:delete-project', opId: 'delete-1', id: 'project-a' });

    expect(() =>
      pageMessage({
        type: 'workbench:open-project',
        opId: 'open-forged',
        definition: definitionWire(),
        projectToken: 'page-selected',
      }),
    ).toThrow(TypeError);
  });

  it('admits exact clone-safe Node server and CLI definitions on the project-open ingress', () => {
    const cases = [
      ['server', nodeServerDefinitionWire()],
      ['CLI', nodeCliDefinitionWire()],
    ] as const;

    for (const [label, definition] of cases) {
      const message = pageMessage({
        type: 'workbench:open-project',
        opId: `open-${label}`,
        definition,
      }) as {
        readonly definition: {
          readonly kind: string;
          readonly files: Readonly<Record<string, Uint8Array>>;
          readonly args?: readonly string[];
        };
      };

      expect(message.definition).toEqual(definition);
      expect(Object.isFrozen(message.definition)).toBe(true);
      expect(Object.isFrozen(message.definition.files)).toBe(true);
      if (message.definition.kind === 'node-cli') {
        expect(Object.isFrozen(message.definition.args)).toBe(true);
      }
    }
  });

  it('rejects additive Node wire fields and metadata tamper before opening a project', () => {
    const serverWire = structuredClone(nodeServerDefinitionWire()) as unknown as Record<
      string,
      unknown
    >;
    const cliWire = structuredClone(nodeCliDefinitionWire()) as unknown as Record<string, unknown>;

    expect(() =>
      pageMessage({
        type: 'workbench:open-project',
        opId: 'open-extra-server',
        definition: { ...serverWire, extra: true },
      }),
    ).toThrow(TypeError);
    expect(() =>
      pageMessage({
        type: 'workbench:open-project',
        opId: 'open-extra-cli',
        definition: { ...cliWire, extra: true },
      }),
    ).toThrow(TypeError);
    expect(() =>
      pageMessage({
        type: 'workbench:open-project',
        opId: 'open-tampered-server',
        definition: { ...serverWire, port: 4322 },
      }),
    ).toThrow(/identity/i);
    expect(() =>
      pageMessage({
        type: 'workbench:open-project',
        opId: 'open-tampered-cli',
        definition: { ...cliWire, args: ['--changed'] },
      }),
    ).toThrow(/identity/i);
  });

  it.each(PAGE_PTY_FRAMES)('round-trips exact token-wrapped page PTY frame $type', (frame) => {
    expect(pageMessage({ type: 'workbench:project-pty', projectToken: TOKEN, frame })).toEqual({
      type: 'workbench:project-pty',
      projectToken: TOKEN,
      frame,
    });
  });

  it.each(OWNER_PTY_FRAMES)('round-trips exact token-wrapped owner PTY frame $type', (frame) => {
    expect(ownerMessage({ type: 'workbench:project-pty', projectToken: TOKEN, frame })).toEqual({
      type: 'workbench:project-pty',
      projectToken: TOKEN,
      frame,
    });
  });

  it('routes preview request/snapshots only through the token-wrapped preview channel', () => {
    const request = { type: 'pty:preview-req' } as const;
    const snapshot = {
      type: 'pty:preview',
      ports: [
        {
          port: 5173,
          url: '/preview/5173/',
          label: 'vite',
          source: 'dev-server',
          sid: 'child-1',
          previewScope: 'preview-scope-1',
          ptySid: 's1',
          ptyRid: 'r1',
        },
      ],
    } as const;

    expect(
      pageMessage({ type: 'workbench:project-preview', projectToken: TOKEN, frame: request }),
    ).toEqual({ type: 'workbench:project-preview', projectToken: TOKEN, frame: request });
    expect(
      ownerMessage({ type: 'workbench:project-preview', projectToken: TOKEN, frame: snapshot }),
    ).toEqual({ type: 'workbench:project-preview', projectToken: TOKEN, frame: snapshot });

    expect(() =>
      pageMessage({ type: 'workbench:project-pty', projectToken: TOKEN, frame: request }),
    ).toThrow(TypeError);
    expect(() =>
      ownerMessage({ type: 'workbench:project-pty', projectToken: TOKEN, frame: snapshot }),
    ).toThrow(TypeError);
  });

  // Fault class: corrupt-input. Every sibling message variant goes through the
  // same exact-key boundary, so an additive forged field cannot drift by case.
  it.each([
    { type: 'workbench:initialize', config: BOOT_CONFIG },
    { type: 'workbench:open-project', opId: 'open-1', definition: definitionWire() },
    { type: 'workbench:project-pty', projectToken: TOKEN, frame: PAGE_PTY_FRAMES[0] },
    { type: 'workbench:project-preview', projectToken: TOKEN, frame: { type: 'pty:preview-req' } },
    { type: 'workbench:close-project', opId: 'close-1', projectToken: TOKEN },
    { type: 'workbench:delete-project', opId: 'delete-1', id: 'project-a' },
    { type: 'workbench:shutdown' },
  ])('rejects extra page command fields for $type', (message) => {
    expect(() => pageMessage({ ...message, extra: true })).toThrow(TypeError);
  });

  it.each([
    { type: 'workbench:owner-ready', storage: REQUIRED_STORAGE },
    {
      type: 'workbench:project-opened',
      opId: 'open-1',
      projectToken: TOKEN,
      projectRoot: '/projects/project-a',
    },
    { type: 'workbench:project-pty', projectToken: TOKEN, frame: OWNER_PTY_FRAMES[0] },
    {
      type: 'workbench:project-preview',
      projectToken: TOKEN,
      frame: { type: 'pty:preview', ports: [] },
    },
    { type: 'workbench:project-closed', opId: 'close-1', projectToken: TOKEN },
    { type: 'workbench:project-deleted', opId: 'delete-1', id: 'project-a' },
    { type: 'workbench:failure', opId: 'open-2', error: { name: 'Error', message: 'failed' } },
  ])('rejects extra owner reply fields for $type', (message) => {
    expect(() => ownerMessage({ ...message, extra: true })).toThrow(TypeError);
  });

  it.each(PAGE_PTY_FRAMES)('rejects extra nested page PTY fields for $type', (frame) => {
    expect(() =>
      pageMessage({
        type: 'workbench:project-pty',
        projectToken: TOKEN,
        frame: { ...frame, extra: true },
      }),
    ).toThrow(TypeError);
  });

  it.each(OWNER_PTY_FRAMES)('rejects extra nested owner PTY fields for $type', (frame) => {
    expect(() =>
      ownerMessage({
        type: 'workbench:project-pty',
        projectToken: TOKEN,
        frame: { ...frame, extra: true },
      }),
    ).toThrow(TypeError);
  });

  it.each([
    [
      'invalid storage policy in boot config',
      {
        type: 'workbench:initialize',
        config: { ...BOOT_CONFIG, storage: { persistence: 'sometimes' } },
      },
    ],
    [
      'non-positive proof timeout in boot config',
      {
        type: 'workbench:initialize',
        config: {
          ...BOOT_CONFIG,
          deployment: { ...BOOT_CONFIG.deployment, previewProbeTimeoutMs: 0 },
        },
      },
    ],
    [
      'non-string Eddy pin in boot config',
      {
        type: 'workbench:initialize',
        config: {
          ...BOOT_CONFIG,
          packageAcquisition: {
            ...BOOT_CONFIG.packageAcquisition,
            eddy: { ...BOOT_CONFIG.packageAcquisition.eddy, presetPins: { vite: 8 } },
          },
        },
      },
    ],
    [
      'Map masquerading as an empty Eddy pin record',
      {
        type: 'workbench:initialize',
        config: {
          ...BOOT_CONFIG,
          packageAcquisition: {
            ...BOOT_CONFIG.packageAcquisition,
            eddy: { ...BOOT_CONFIG.packageAcquisition.eddy, presetPins: new Map() },
          },
        },
      },
    ],
    ['empty operation id', { type: 'workbench:delete-project', opId: '', id: 'project-a' }],
    ['empty project token', { type: 'workbench:close-project', opId: 'close-1', projectToken: '' }],
    ['empty project id', { type: 'workbench:delete-project', opId: 'delete-1', id: '' }],
    [
      'malformed PTY dimensions',
      {
        type: 'workbench:project-pty',
        projectToken: TOKEN,
        frame: { type: 'pty:session-resize', sid: 's1', opId: 'resize-1', cols: 0, rows: 24 },
      },
    ],
    [
      'Map masquerading as an empty PTY env record',
      {
        type: 'workbench:project-pty',
        projectToken: TOKEN,
        frame: { type: 'pty:open', sid: 's1', env: new Map() },
      },
    ],
  ])('rejects malformed page command: %s', (_label, message) => {
    expect(() => pageMessage(message)).toThrow(TypeError);
  });

  it.each([
    [
      'impossible required-memory storage',
      {
        type: 'workbench:owner-ready',
        storage: { policy: 'required', backend: 'memory', durability: 'ephemeral' },
      },
    ],
    [
      'fallback without reason',
      {
        type: 'workbench:owner-ready',
        storage: { policy: 'preferred', backend: 'memory', durability: 'ephemeral' },
      },
    ],
    [
      'extra serialized-error field',
      {
        type: 'workbench:failure',
        opId: 'open-1',
        error: { name: 'Error', message: 'failed', stack: 'not in v1' },
      },
    ],
    [
      'preview entry with a torn PTY provenance pair',
      {
        type: 'workbench:project-preview',
        projectToken: TOKEN,
        frame: {
          type: 'pty:preview',
          ports: [
            {
              port: 5173,
              url: '/preview/5173/',
              label: 'vite',
              source: 'dev-server',
              sid: 'child-1',
              ptySid: 's1',
            },
          ],
        },
      },
    ],
  ])('rejects malformed owner reply: %s', (_label, message) => {
    expect(() => ownerMessage(message)).toThrow(TypeError);
  });

  it.each([
    ['missing root', undefined],
    ['relative root', 'projects/project-a'],
    ['owner VFS root', '/'],
    ['trailing separator', '/projects/project-a/'],
    ['empty segment', '/projects//project-a'],
    ['dot segment', '/projects/./project-a'],
    ['traversal segment', '/projects/../project-a'],
    ['NUL', '/projects/project-a\0suffix'],
  ])('rejects malformed owner-born project root: %s', (_label, projectRoot) => {
    const message: Record<string, unknown> = {
      type: 'workbench:project-opened',
      opId: 'open-1',
      projectToken: TOKEN,
    };
    if (projectRoot !== undefined) message.projectRoot = projectRoot;

    expect(() => ownerMessage(message)).toThrow(TypeError);
  });

  it('rejects empty owner token generation instead of falling back to host/env identity', () => {
    expect(() => createOwnerProjectToken(() => '')).toThrow(TypeError);
  });
});
