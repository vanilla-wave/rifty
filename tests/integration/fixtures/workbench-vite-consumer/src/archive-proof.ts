import {
  type AgentHost,
  type AgentSessionOptions,
  createAgentSession,
  createSandboxAgentHost,
  createWorkbenchAgentHost,
} from '@riftydev/agent';
import { createSandbox } from '@riftydev/sdk';
import { OpfsVfs } from '@riftydev/vfs';
import { type WorkbenchOptions, openWorkbench, projects } from '@riftydev/workbench';
import { modelCatalog } from './agent-catalog';
import { type ScriptedReply, scriptedProvider } from './agent-scripted-provider';

const namespace = 'packed-conversations';
const settings = () => ({
  baseUrl: new URL('/mock-model/v1', location.href).href,
  model: 'scripted',
});
async function records() {
  const fs = new OpfsVfs();
  const path = `/.rifty-agent-archives/${namespace}`;
  if (!(await fs.exists(path))) return [];
  return Promise.all(
    (await fs.readdir(path)).map(async (entry) => ({
      name: entry.name,
      text: await fs.readFile(`${path}/${entry.name}`, 'utf8'),
    })),
  );
}
function recallingModel(project: string) {
  const replies: ScriptedReply[] = [];
  const provider = scriptedProvider(replies);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = (await request.clone().json()) as {
      messages: { role: string; content: string }[];
    };
    const last = body.messages.filter((message) => message.role === 'tool').at(-1);
    if (!last) replies.push([{ name: 'archive_search', args: { query: project } }]);
    else {
      const text = last.content;
      const result = JSON.parse(text.slice(text.indexOf('\n') + 1));
      if ('matches' in result) {
        if (!result.matches.length) throw new Error('No archived shop conversation found');
        replies.push([{ name: 'archive_read', args: { sessionId: result.matches[0].sessionId } }]);
      } else if (result.nextOffset !== null) {
        replies.push([
          {
            name: 'archive_read',
            args: { sessionId: result.sessionId, offset: result.nextOffset },
          },
        ]);
      } else replies.push('Read the original archived decision.');
    }
    return provider.fetch(request);
  };
  return modelCatalog(settings(), fetch);
}

export function archiveProof(options: WorkbenchOptions) {
  return async (
    kind: 'sdk' | 'workbench',
    action: 'save' | 'recall',
    marker?: string,
    model?: { baseUrl: string; model: string },
  ) => {
    const source = `${kind}-shop`;
    const id = action === 'save' ? source : `${kind}-blog`;
    const name = action === 'save' ? `магазин ${kind}` : `блог ${kind}`;
    let host: AgentHost;
    let close: () => Promise<void>;
    let remove: () => Promise<void>;
    if (kind === 'sdk') {
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        storage: { persistence: 'required', namespace: 'archive-sdk-projects' },
        toolchain: { workerUrl: new URL('/rifty/no-coi-toolchain-worker.js', location.href).href },
      });
      await sandbox.fs.writeFile(`/${id}/seed.txt`, 'project files only');
      host = createSandboxAgentHost({
        sandbox,
        project: { root: `/${id}` },
        mode: () => 'commands',
      });
      remove = async () => {
        await sandbox.fs.rename(`/${id}`, `/${id}-renamed`);
        await sandbox.fs.rm(`/${id}-renamed`, { recursive: true });
      };
      close = async () => {
        sandbox.dispose();
      };
    } else {
      const workbench = await openWorkbench({
        ...options,
        storage: { persistence: 'required', namespace: 'archive-workbench-projects' },
      });
      const project = await workbench.openProject(
        projects.nodeCli({
          id,
          entryPath: '/main.cjs',
          files: { '/main.cjs': 'console.log("archive host")' },
        }),
      );
      host = createWorkbenchAgentHost({ session: project });
      remove = async () => {
        await project.close();
        await workbench.deleteProject(id);
      };
      close = async () => {
        await project.close();
        await workbench.close();
      };
    }
    const seedProvider = scriptedProvider([
      [{ name: 'write_file', args: { path: 'decision.txt', content: marker ?? '' } }],
      'Решение сохранено.',
    ]);
    const agent = createAgentSession({
      host,
      archive: { namespace, project: { id, name } },
      ...(action === 'save'
        ? modelCatalog(settings(), seedProvider.fetch)
        : model
          ? modelCatalog(model)
          : recallingModel(`магазин ${kind}`)),
      compaction: { enabled: false },
    } satisfies AgentSessionOptions);
    try {
      await agent.send(
        action === 'save'
          ? `Для магазина мы решили: авторизация cookie; проверочная фраза ${marker}. ${'Сохрани исходное обсуждение. '.repeat(900)}`
          : `Найди наше прежнее решение по авторизации в проекте «магазин ${kind}». Прочитай исходный разговор, назови проверочную фразу. Не спрашивай имя файла.`,
      );
      const trace = await agent.exportTrace();
      if (trace.status !== 'done') throw new Error(`Archive ${kind}/${action}: ${agent.detail()}`);
      await agent.dispose();
      const before = await records();
      if (action === 'save') await remove();
      const after = await records();
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error('Project deletion changed shared archive');
      return { trace, files: after };
    } finally {
      await agent.dispose();
      await close();
    }
  };
}

/** Existing public companion lifecycle must never move the shared archive. */
export async function archiveProjectLifecycle(
  options: import('@riftydev/workbench/playground').PlaygroundWorkbenchOptions,
) {
  const { openPlaygroundWorkbench } = await import('@riftydev/workbench/playground');
  const workbench = await openPlaygroundWorkbench({
    ...options,
    storage: { persistence: 'required', namespace: 'archive-lifecycle-projects' },
  });
  const define = (id: string) =>
    workbench.playground.define({
      kind: 'node-cli',
      id,
      starterId: 'archive-proof',
      templateId: 'archive-proof',
      entryPath: '/main.cjs',
      files: { '/main.cjs': 'console.log("archive lifecycle")' },
      firstMaterialization: { kind: 'install' },
    });
  const scratch = define('scratch');
  await workbench.playground.catalog.createScratch({ definition: scratch });
  const initial = await workbench.openProject(scratch);
  await initial.close();
  await workbench.playground.catalog.saveScratch({
    id: 'shop',
    name: 'Shop',
    definition: define('shop'),
  });
  const project = await workbench.openProject(define('shop'));
  try {
    const provider = scriptedProvider(['Original decision.']);
    const agent = createAgentSession({
      host: createWorkbenchAgentHost({ session: project }),
      archive: { namespace, project: { id: 'lifecycle-shop', name: 'Shop' } },
      ...modelCatalog(settings(), provider.fetch),
    });
    await agent.send('Retain this conversation through rename, export/import and delete.');
    if (agent.status() !== 'done') throw new Error(agent.detail());
    await agent.dispose();
    const before = await records();
    await workbench.playground.catalog.rename('shop', 'Renamed shop');
    const companion = workbench.playground.forSession(project);
    const exported = await companion.archive.export();
    if (
      JSON.parse(exported).files.some((file: { path: string }) =>
        file.path.includes('.rifty-agent-archives'),
      )
    )
      throw new Error('Project export included shared conversation archive');
    await companion.archive.import(exported);
    await companion.awaitDurability();
    await project.close();
    await workbench.playground.catalog.delete('shop');
    const after = await records();
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Project lifecycle changed shared archive bytes');
    return { renamed: true, deleted: true, exported, files: after };
  } finally {
    await project.close();
    await workbench.close();
  }
}
