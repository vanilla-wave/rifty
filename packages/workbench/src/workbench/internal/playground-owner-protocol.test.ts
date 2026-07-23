import { describe, expect, it } from 'vitest';
import { inspectPageToWorkbenchOwnerMessage } from '../owner-protocol.ts';
import {
  inspectPageToPlaygroundOwnerMessage,
  inspectPlaygroundOwnerToPageMessage,
  isPageToPlaygroundOwnerMessage,
  isPlaygroundOwnerToPageMessage,
} from './playground-owner-protocol.ts';
import {
  definePlaygroundProject,
  playgroundProjectDefinitionWire,
} from './playground-project-definition.ts';

const URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.test/app/',
  clientUrl: 'https://playground.test/app/index.html',
});

function wire() {
  return playgroundProjectDefinitionWire(
    definePlaygroundProject(
      {
        kind: 'vite',
        id: 'scratch',
        starterId: 'starter-a',
        templateId: 'vite-v1',
        files: { '/package.json': '{"scripts":{"dev":"vite"}}\n' },
        port: 5174,
        firstMaterialization: { kind: 'install' },
      },
      URL_CONTEXT,
    ),
  );
}

describe('Playground owner protocol', () => {
  it('admits the captured URL context only as an exact optional owner boot extension', () => {
    const initialized = inspectPageToWorkbenchOwnerMessage({
      type: 'workbench:initialize',
      config: {
        deployment: {
          workers: { kernel: '/kernel.js', node: '/node.js', devServer: '/dev-server.js' },
          wasm: { sqlite: '/sqlite.wasm', esbuild: '/esbuild.wasm' },
          previewProbeTimeoutMs: 1_000,
        },
        packageAcquisition: { registryUrl: '/registry' },
        storage: { persistence: 'ephemeral' },
        playgroundUrlContext: URL_CONTEXT,
      },
    });
    if (initialized.type !== 'workbench:initialize') throw new Error('expected initialize');
    expect(initialized.config.playgroundUrlContext).toEqual(URL_CONTEXT);
    expect(Object.isFrozen(initialized.config.playgroundUrlContext)).toBe(true);
  });

  it('exact-validates companion open and every catalog definition at one ingress', () => {
    const terminalEnv = { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' };
    const terminalState = { cwd: '/src', env: terminalEnv };
    const opened = inspectPageToPlaygroundOwnerMessage(
      {
        type: 'workbench:playground-open-project',
        opId: 'open-1',
        definition: wire(),
        initialTerminalState: terminalState,
      },
      URL_CONTEXT,
    );
    terminalState.cwd = '/mutated';
    terminalEnv.PATH = '/mutated';
    expect(opened.type).toBe('workbench:playground-open-project');
    expect(isPageToPlaygroundOwnerMessage(opened)).toBe(true);
    expect(opened).toMatchObject({
      initialTerminalState: {
        cwd: '/src',
        env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
      },
    });
    if (opened.type !== 'workbench:playground-open-project') {
      throw new Error('expected Playground open message');
    }
    expect(Object.isFrozen(opened.initialTerminalState)).toBe(true);
    expect(Object.isFrozen(opened.initialTerminalState?.env)).toBe(true);

    const created = inspectPageToPlaygroundOwnerMessage(
      {
        type: 'workbench:playground-catalog',
        opId: 'catalog-1',
        command: {
          kind: 'create-scratch',
          definition: wire(),
          preserveDirtySameStarter: true,
        },
      },
      URL_CONTEXT,
    );
    expect(created).toMatchObject({
      type: 'workbench:playground-catalog',
      command: { kind: 'create-scratch', preserveDirtySameStarter: true },
    });

    expect(() =>
      inspectPageToPlaygroundOwnerMessage(
        {
          type: 'workbench:playground-open-project',
          opId: 'open-2',
          definition: wire(),
          root: '/forged',
        },
        URL_CONTEXT,
      ),
    ).toThrow(TypeError);
    expect(() =>
      inspectPageToPlaygroundOwnerMessage(
        {
          type: 'workbench:playground-catalog',
          opId: 'catalog-2',
          command: { kind: 'rename', id: 'project-a', name: 'A', ownerToken: 'forged' },
        },
        URL_CONTEXT,
      ),
    ).toThrow(TypeError);
  });

  it('validates and freezes initial/update catalog values and operation completion', () => {
    const catalog = {
      active: { kind: 'project', id: 'project-a' },
      scratch: null,
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          starterId: 'starter-a',
          editedAt: '2026-07-16T12:00:00.000Z',
        },
      ],
    } as const;
    for (const value of [
      { type: 'workbench:playground-ready', catalog },
      { type: 'workbench:playground-catalog-updated', catalog },
    ]) {
      const inspected = inspectPlaygroundOwnerToPageMessage(value);
      expect(isPlaygroundOwnerToPageMessage(inspected)).toBe(true);
      if (!('catalog' in inspected)) throw new Error('expected catalog message');
      expect(Object.isFrozen(inspected.catalog)).toBe(true);
      expect(Object.isFrozen(inspected.catalog.projects)).toBe(true);
      expect(Object.isFrozen(inspected.catalog.projects[0])).toBe(true);
    }
    expect(
      inspectPlaygroundOwnerToPageMessage({
        type: 'workbench:playground-catalog-completed',
        opId: 'catalog-1',
      }),
    ).toEqual({ type: 'workbench:playground-catalog-completed', opId: 'catalog-1' });
  });

  it('admits only exact owner-born acquisition/runtime decisions', () => {
    const initialScmSnapshot = { history: [], changes: [] } as const;
    const opened = inspectPlaygroundOwnerToPageMessage({
      type: 'workbench:playground-project-opened',
      opId: 'open-1',
      projectToken: 'project-token',
      projectRoot: '/.rifty/workbench/v1/projects/scratch/tree',
      acquisition: {
        kind: 'install',
        snapshotFailures: [{ snapshotId: `sha256:${'a'.repeat(64)}`, reason: 'hash mismatch' }],
      },
      runtime: { kind: 'vite', port: 5174 },
      initialScmSnapshot,
      initialTerminalState: {
        cwd: '/',
        env: { RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
      },
    });
    expect(opened).toMatchObject({
      acquisition: { kind: 'install' },
      runtime: { kind: 'vite', port: 5174 },
      initialScmSnapshot,
      initialTerminalState: {
        cwd: '/',
        env: { RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
      },
    });
    if (opened.type !== 'workbench:playground-project-opened') {
      throw new Error('expected Playground project-opened message');
    }
    expect(Object.isFrozen(opened)).toBe(true);
    expect(Object.isFrozen(opened.initialTerminalState)).toBe(true);
    expect(Object.isFrozen(opened.initialTerminalState?.env)).toBe(true);
    expect(() =>
      inspectPlaygroundOwnerToPageMessage({
        ...opened,
        acquisition: { ...opened.acquisition, hiddenInstall: true },
      }),
    ).toThrow(TypeError);
    expect(() =>
      inspectPlaygroundOwnerToPageMessage({ ...opened, runtime: { kind: 'vite', port: 0 } }),
    ).toThrow(TypeError);
  });

  it('wraps exact session-tool frames in the active owner token', () => {
    expect(
      inspectPageToPlaygroundOwnerMessage(
        {
          type: 'workbench:playground-project-tools',
          projectToken: 'project-token',
          frame: {
            type: 'workbench:playground-session-tools-request',
            requestId: 'close-1',
            operation: { type: 'close' },
          },
        },
        URL_CONTEXT,
      ),
    ).toMatchObject({ projectToken: 'project-token', frame: { operation: { type: 'close' } } });
    expect(
      inspectPlaygroundOwnerToPageMessage({
        type: 'workbench:playground-project-tools',
        projectToken: 'project-token',
        frame: {
          type: 'workbench:playground-session-tools-response',
          requestId: 'close-1',
          response: { ok: true, result: { type: 'closed' } },
        },
      }),
    ).toMatchObject({ projectToken: 'project-token', frame: { response: { ok: true } } });
  });
});
