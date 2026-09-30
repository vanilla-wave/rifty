import { type AgentSessionOptions, createAgentSession } from '@riftydev/agent';
import { MemoryVfs, OpfsVfs } from '@riftydev/vfs';
import { modelCatalog } from '../../integration/fixtures/workbench-vite-consumer/src/agent-catalog.ts';
import {
  type ScriptedReply,
  scriptedProvider,
} from '../../integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';

export const namespace = 'archive-proof';
export const directory = `/.rifty-agent-archives/${namespace}`;
const files = new MemoryVfs();
const host = {
  root: '/',
  capabilities: () => ({
    files: {
      read: (path: string) => files.readFile(path, 'utf8'),
      list: async (path: string) =>
        (await files.readdir(path)).map((entry) => ({
          path: `/${entry.name}`,
          kind: entry.isFile ? ('file' as const) : ('dir' as const),
        })),
      async change(path: string, transform: (text: string | null) => string | null) {
        const next = transform(
          (await files.exists(path)) ? await files.readFile(path, 'utf8') : null,
        );
        if (next === null) await files.rm(path);
        else await files.writeFile(path, next);
      },
    },
  }),
  async close() {},
};
export function session(
  replies: readonly ScriptedReply[],
  project = 'shop',
  overrides: Partial<AgentSessionOptions> = {},
) {
  const provider = scriptedProvider(replies);
  const options = {
    host,
    ...modelCatalog(
      { baseUrl: new URL('/model', location.href).href, model: 'scripted' },
      provider.fetch,
    ),
    archive: { namespace, project: { id: project, name: project } },
    compaction: { enabled: false },
    ...overrides,
  };
  return createAgentSession(options as AgentSessionOptions);
}
export async function save(reset = false) {
  const agent = session([
    [{ name: 'write_file', args: { path: '/auth.txt', content: 'cookie-saffron' } }],
    'Use cookie-saffron.',
    'Second conversation.',
  ]);
  const events: unknown[] = [];
  agent.subscribe((event) => events.push(event));
  await agent.send(`Shop authentication decision ${'old-context '.repeat(2500)}cookie-saffron`);
  const firstStatus = agent.status();
  if (reset) {
    agent.reset();
    await agent.send('A different conversation');
  }
  await agent.dispose();
  return { firstStatus, events };
}
export async function saved() {
  const fs = new OpfsVfs();
  if (!(await fs.exists(directory))) return [];
  return Promise.all(
    (await fs.readdir(directory)).map(async (entry) => ({
      name: entry.name,
      text: await fs.readFile(`${directory}/${entry.name}`, 'utf8'),
    })),
  );
}
/** Host restore (ADR-0466) of the single archived conversation, then one more turn. */
export async function resume() {
  const [record, ...rest] = await saved();
  if (!record || rest.length) throw new Error('Expected exactly one archived conversation');
  const initialMessages = JSON.parse(JSON.parse(record.text).payload).messages;
  const agent = session(['Continued.'], 'shop', { initialMessages });
  await agent.send('Continue with the same auth');
  const status = agent.status();
  await agent.dispose();
  return { status, restored: initialMessages.length as number };
}
export async function search(query: string, offset = 0) {
  const agent = session([[{ name: 'archive_search', args: { query, offset } }], 'Found.'], 'blog');
  await agent.send(`Find earlier conversations about ${query}`);
  const trace = await agent.exportTrace();
  await agent.dispose();
  return trace;
}
export async function read(sessionId: string, offset = 0) {
  const agent = session([[{ name: 'archive_read', args: { sessionId, offset } }], 'Read.'], 'blog');
  await agent.send('Read past decision');
  const trace = await agent.exportTrace();
  await agent.dispose();
  return trace;
}

export async function compact() {
  const agent = session(
    [
      {
        text: 'original-reply '.repeat(500),
        usage: { prompt_tokens: 125000, completion_tokens: 10, total_tokens: 125010 },
      },
      'Summary of shop auth.',
    ],
    'shop',
    { compaction: { enabled: true, keepRecentTokens: 1 } },
  );
  await agent.send('original-user '.repeat(3000));
  const trace = await agent.exportTrace();
  await agent.dispose();
  return trace;
}
export async function interrupt() {
  const agent = session(['Acknowledged answer', 'Unfinished answer']);
  await agent.send('acknowledged-original');
  const original = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    const writer = await original.call(this, options);
    const write = writer.write.bind(writer);
    let block = false;
    writer.write = async (data) => {
      const text = data instanceof Uint8Array ? new TextDecoder().decode(data) : String(data);
      block = text.includes('unacknowledged-tail');
      await write(data);
    };
    const close = writer.close.bind(writer);
    writer.close = async () => {
      if (block) {
        document.body.dataset.archiveWriteBlocked = 'yes';
        await new Promise(() => {});
      }
      await close();
    };
    return writer;
  };
  void agent.send('unacknowledged-tail');
}

export async function saveImage() {
  const { createModels, createOpenAIProvider } = await import('@riftydev/agent');
  const provider = scriptedProvider(['Image recorded']);
  const models = createModels();
  models.setProvider(
    createOpenAIProvider({
      id: 'vision',
      apiKey: 'provider-secret-must-not-be-archived',
      fetch: provider.fetch,
      models: [
        {
          id: 'vision',
          name: 'vision',
          provider: 'vision',
          api: 'openai-completions',
          baseUrl: new URL('/model', location.href).href,
          input: ['text', 'image'],
          contextWindow: 128000,
          maxTokens: 8192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    }),
  );
  const image = {
    type: 'image' as const,
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  };
  const agent = session([], 'shop', { models, model: 'vision' });
  await agent.send('Keep this original image', [image]);
  await agent.dispose();
  return image;
}

export async function acknowledgement() {
  const agent = session(['Saved']);
  const events: { type: string }[] = [];
  agent.subscribe((event) => events.push(event));
  const original = FileSystemFileHandle.prototype.createWritable;
  let enter = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  FileSystemFileHandle.prototype.createWritable = async function (options) {
    const writer = await original.call(this, options);
    const close = writer.close.bind(writer);
    writer.close = async () => {
      if (first) {
        first = false;
        enter();
        await released;
      }
      await close();
    };
    return writer;
  };
  const run = agent.send('Confirm after close');
  await entered;
  const before = events.filter((event) => event.type === 'archive').length;
  release();
  await run;
  FileSystemFileHandle.prototype.createWritable = original;
  await agent.dispose();
  return { before, events };
}
